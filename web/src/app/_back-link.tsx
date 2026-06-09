"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// "← All recipes" that returns the user to wherever they came from in
// history — preserving scroll position and the home page's URL state
// (tab choice, active filters, search) automatically. Falls back to a
// plain forward navigation to / if there's no history to step back to
// (deep links, refreshed tabs). Link is still used for the right-click
// "Open in new tab" / middle-click experience and as the SSR href.
export function BackToRecipes() {
  const router = useRouter();

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <Link
      href="/"
      onClick={onClick}
      className="-ml-2 inline-flex items-center px-2 py-1 text-sm text-muted-foreground rounded-md hover:bg-card hover:text-foreground"
    >
      ← All recipes
    </Link>
  );
}
