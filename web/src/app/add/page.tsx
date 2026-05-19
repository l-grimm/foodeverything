import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

async function addUrl(formData: FormData) {
  "use server";
  const url = String(formData.get("url") || "").trim();
  if (!url) return;

  const base = process.env.WEBHOOK_BASE_URL!;
  const token = process.env.WEBHOOK_TOKEN!;
  // Dispatch by hostname. Generic web URL falls back to /webhook/instagram
  // for now (TODO: build /webhook/url that uses the JSON-LD ingester).
  let endpoint = `${base}/webhook/instagram`;
  if (url.includes("tiktok.com")) endpoint = `${base}/webhook/tiktok`;
  else if (url.includes("instagram.com")) endpoint = `${base}/webhook/instagram`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Webhook ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { recipe_id?: string };
  if (json.recipe_id) redirect(`/recipe/${json.recipe_id}`);
  redirect("/");
}

export default function AddPage() {
  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Add a recipe</h1>
        <p className="text-muted-foreground text-sm">
          Paste a TikTok or Instagram URL. iOS Shortcuts still work too — this
          is the same backend.
        </p>
      </div>

      <form action={addUrl} className="space-y-3">
        <Label htmlFor="url">Recipe URL</Label>
        <Input
          id="url"
          name="url"
          type="url"
          placeholder="https://www.tiktok.com/@... or https://www.instagram.com/reels/..."
          required
          className="text-base"
        />
        <Button type="submit">Add recipe</Button>
        <p className="text-xs text-muted-foreground">
          Generic web URLs (Substack, blogs) aren&apos;t wired up yet — coming
          next. For now, TikTok and Instagram URLs only.
        </p>
      </form>
    </div>
  );
}
