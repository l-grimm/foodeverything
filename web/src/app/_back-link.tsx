"use client";

import Link from "next/link";

// "← All recipes" that returns the user to wherever they came from in
// history — preserving scroll position and the home page's URL state
// (tab choice, active filters, search) automatically. Falls back to a
// plain forward navigation to / if there's no history to step back to
// (deep links, refreshed tabs). Link is still used for the right-click
// "Open in new tab" / middle-click experience and as the SSR href.
export function BackToRecipes() {
  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (typeof window === "undefined") return;
    // Only intercept when we came from our own home page. Otherwise let
    // the Link navigate forward to "/" normally (deep links, refreshed
    // tabs, opens from share sheet).
    const cameFromOurHome =
      document.referrer.startsWith(window.location.origin) &&
      window.history.length > 1;
    if (!cameFromOurHome) return;
    e.preventDefault();
    // Use the browser's native back navigation — Next's router.back()
    // re-fetches the server component and discards scroll position; the
    // browser's own popstate handler restores scroll from history.
    window.history.back();
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
