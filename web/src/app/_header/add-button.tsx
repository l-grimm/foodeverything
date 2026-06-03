"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Hides itself when already on /add — no point linking to the page
// you're already on, and it visually clutters the header.
export function HeaderAddButton() {
  const pathname = usePathname();
  if (pathname === "/add") return null;
  return (
    <Link
      href="/add"
      className="rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider hover:opacity-90"
    >
      + Add
    </Link>
  );
}
