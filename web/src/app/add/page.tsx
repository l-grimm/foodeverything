import Link from "next/link";
import { AddForm } from "./add-form";

// Substack/URL ingestion = fetch + GPT-4o parse; routinely 10–30s. Default
// serverless timeout (10s on Vercel Hobby) is not enough. 60s is the cap
// on Hobby and the default on Pro — safe either way.
export const maxDuration = 60;

export default function AddPage() {
  return (
    <div className="space-y-8 max-w-xl">
      <Link
        href="/"
        className="-ml-3 inline-flex items-center px-3 py-2 text-sm text-muted-foreground rounded-md hover:bg-card hover:text-foreground"
      >
        ← All recipes
      </Link>
      <header className="space-y-3 border-t border-border pt-4">
        <div className="label-mono">Add a recipe</div>
        <h1 className="font-display uppercase text-3xl sm:text-4xl leading-[0.95] text-foreground">
          Paste a URL
        </h1>
        <p className="text-muted-foreground text-sm">
          TikTok, Instagram, Substack, NYT Cooking, or any food blog.
          iOS Shortcuts still work too — this is the same backend.
        </p>
      </header>

      <AddForm />
    </div>
  );
}
