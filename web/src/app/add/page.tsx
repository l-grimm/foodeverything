import { AddForm } from "./add-form";

// Substack/URL ingestion = fetch + GPT-4o parse; routinely 10–30s. Default
// serverless timeout (10s on Vercel Hobby) is not enough. 60s is the cap
// on Hobby and the default on Pro — safe either way.
export const maxDuration = 60;

export default function AddPage() {
  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Add a recipe</h1>
        <p className="text-muted-foreground text-sm">
          Paste any recipe URL — TikTok, Instagram, Substack, or a regular
          food blog. iOS Shortcuts still work too; this is the same backend.
        </p>
      </div>

      <AddForm />
    </div>
  );
}
