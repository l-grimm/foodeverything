// All provider credentials stay in the existing authenticated backend.
const OPERATIONS = new Set(["turn", "transcribe", "speech", "connect"]);
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  const { operation } = await params;
  if (!OPERATIONS.has(operation)) return new Response(null, { status: 404 });
  // This personal app has no account/session system. Match existing access
  // boundaries while rejecting cross-origin browser requests to paid endpoints.
  const origin = request.headers.get("origin");
  // Next's internal request URL may use localhost behind a proxy even when
  // the browser uses 127.0.0.1 or the deployment's public hostname.
  if (!origin || !URL.canParse(origin) || new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "Open the assistant from this application." }, { status: 403 });
  }
  const base = process.env.WEBHOOK_BASE_URL?.trim();
  const token = process.env.WEBHOOK_TOKEN?.trim();
  if (!base || !token) {
    return Response.json({ error: "Cooking assistant backend is not configured." }, { status: 503 });
  }
  const limit = operation === "transcribe" ? 8 * 1024 * 1024 + 4096 : 400_000;
  if (Number(request.headers.get("content-length")) > limit) {
    return Response.json({ error: "That recording or session is too large." }, { status: 413 });
  }
  try {
    // Bound streamed bodies too, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Missing request body." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return Response.json({ error: "That recording or session is too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    const upstream = await fetch(`${base.replace(/\/$/, "")}/voice/${operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": request.headers.get("content-type") ?? "application/json",
      },
      body: Buffer.concat(chunks),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
    });
    if (!upstream.ok) {
      // Never relay arbitrary backend exception bodies (which may include secrets).
      const messages: Record<number, string> = {
        400: "This turn couldn't be processed. Try again, or close and restart the session.",
        413: "That recording is too large. Please record a shorter turn.",
        415: "This recording format isn't supported. You can type your response below.",
        429: "The assistant is busy. Please try again shortly.",
      };
      return Response.json({ error: messages[upstream.status] ?? "Cooking assistant unavailable. Please try again." }, { status: upstream.status >= 500 ? 502 : upstream.status });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Couldn't reach the cooking assistant. Please try again." }, { status: 502 });
  }
}
