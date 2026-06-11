"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Hides itself when already on /add — no point linking to the page
// you're already on, and it visually clutters the header. Also hides
// while the user is editing a recipe (`/recipe/[id]?edit=1`) so the
// edit form's Cancel/Save buttons are the only top-right actions.
export function HeaderAddButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === "/add") return null;
  if (
    pathname.startsWith("/recipe/") &&
    searchParams.get("edit") === "1"
  ) {
    return null;
  }
  return (
    <Link
      href="/add"
      className="rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider hover:opacity-90"
    >
      + Add
    </Link>
  );
}
