import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile only this dependency-free route to exercise its real Request/Response
// behavior without a Next server, providers, or new test dependencies.
const source = await readFile(new URL("../src/app/api/cooking/[operation]/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const originalFetch = globalThis.fetch;
let oldBase, oldToken, upstreamCalls;
beforeEach(() => {
  oldBase = process.env.WEBHOOK_BASE_URL;
  oldToken = process.env.WEBHOOK_TOKEN;
  process.env.WEBHOOK_BASE_URL = "http://fixture.invalid";
  process.env.WEBHOOK_TOKEN = "test-backend-secret";
  upstreamCalls = [];
  globalThis.fetch = async (...args) => {
    upstreamCalls.push(args);
    return Response.json({ reply: "Fixture response" });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (oldBase === undefined) delete process.env.WEBHOOK_BASE_URL; else process.env.WEBHOOK_BASE_URL = oldBase;
  if (oldToken === undefined) delete process.env.WEBHOOK_TOKEN; else process.env.WEBHOOK_TOKEN = oldToken;
});
function request(headers = {}, body = "{}") {
  return new Request("http://localhost:3000/api/cooking/turn", {
    method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "content-type": "application/json", ...headers }, body,
  });
}
const context = operation => ({ params: Promise.resolve({ operation }) });

test("same-origin requests work when Next's internal hostname differs", async () => {
  const response = await POST(request(), context("turn"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(upstreamCalls[0][0], "http://fixture.invalid/voice/turn");
  assert.equal(upstreamCalls[0][1].headers.Authorization, "Bearer test-backend-secret");
  assert.doesNotMatch(await response.text(), /test-backend-secret/);
});
test("cross-origin and malformed origins never reach the paid backend", async () => {
  for (const origin of ["https://attacker.invalid", "null", "not a URL"]) {
    assert.equal((await POST(request({ origin }), context("turn"))).status, 403);
  }
  assert.equal(upstreamCalls.length, 0);
});
test("missing origin is rejected", async () => {
  const req = request(); req.headers.delete("origin");
  assert.equal((await POST(req, context("turn"))).status, 403);
});
test("unknown operations cannot proxy arbitrary backend endpoints", async () => {
  assert.equal((await POST(request(), context("delete"))).status, 404);
  assert.equal(upstreamCalls.length, 0);
});
test("missing backend configuration produces a recoverable error", async () => {
  delete process.env.WEBHOOK_TOKEN;
  assert.equal((await POST(request(), context("turn"))).status, 503);
  assert.equal(upstreamCalls.length, 0);
});
test("size is bounded even without Content-Length", async () => {
  assert.equal((await POST(request({}, "x".repeat(400_001)), context("turn"))).status, 413);
  assert.equal(upstreamCalls.length, 0);
});
test("upstream exception bodies and secrets never reach the browser", async () => {
  globalThis.fetch = async () => new Response("private error with test-backend-secret", { status: 500 });
  const response = await POST(request(), context("turn"));
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private error|test-backend-secret/);
});
test("connection failures return JSON recovery instructions", async () => {
  globalThis.fetch = async () => { throw new Error("private connection details"); };
  const response = await POST(request(), context("speech"));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /try again/);
});
