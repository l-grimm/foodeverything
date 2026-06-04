import Link from "next/link";
import { AddForm } from "./add-form";
import { AddTabs, type AddTab } from "./add-tabs";
import { AddIngredient } from "./add-ingredient";

// Substack/URL ingestion = fetch + GPT-4o parse; routinely 10–30s. Default
// serverless timeout (10s on Vercel Hobby) is not enough. 60s is the cap
// on Hobby and the default on Pro — safe either way.
export const maxDuration = 60;

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: AddTab = sp.tab === "ingredient" ? "ingredient" : "recipe";

  return (
    <div className="space-y-6 max-w-xl">
      <Link
        href="/"
        className="-ml-2 inline-flex items-center px-2 py-1 text-sm text-muted-foreground rounded-md hover:bg-card hover:text-foreground"
      >
        ← All recipes
      </Link>
      <header className="space-y-3">
        <h1 className="font-display uppercase text-3xl sm:text-4xl leading-[0.95] text-foreground">
          Add
        </h1>
      </header>

      <AddTabs current={tab} sp={sp} />

      {tab === "recipe" ? (
        <>
          <p className="text-muted-foreground text-sm">
            TikTok, Instagram, Substack, NYT Cooking, or any food blog.
            iOS Shortcuts still work too — this is the same backend.
          </p>
          <AddForm />
        </>
      ) : (
        <AddIngredient />
      )}
    </div>
  );
}
