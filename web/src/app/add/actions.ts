"use server";

import { redirect } from "next/navigation";

export type AddUrlState = { error?: string };

function pickEndpoint(base: string, url: string): string {
  if (url.includes("tiktok.com")) return `${base}/webhook/tiktok`;
  if (url.includes("instagram.com")) return `${base}/webhook/instagram`;
  return `${base}/webhook/url`;
}

export async function addUrl(
  _prev: AddUrlState,
  formData: FormData,
): Promise<AddUrlState> {
  const url = String(formData.get("url") || "").trim();
  if (!url) return { error: "Paste a recipe URL." };

  // Trim defensively — a stray trailing space in a Vercel env var produces
  // "Failed to parse URL" from fetch, which is opaque to debug from the UI.
  const base = process.env.WEBHOOK_BASE_URL!.trim();
  const token = process.env.WEBHOOK_TOKEN!.trim();
  const endpoint = pickEndpoint(base, url);

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
  } catch (e) {
    return {
      error: `Couldn't reach the ingestion service: ${(e as Error).message}`,
    };
  }

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Ingestion failed (${resp.status}): ${text.slice(0, 300)}` };
  }

  const json = (await resp.json()) as { recipe_id?: string };
  if (json.recipe_id) redirect(`/recipe/${json.recipe_id}`);
  redirect("/");
}
