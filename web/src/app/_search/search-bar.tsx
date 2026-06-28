"use client";

import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { useSearchQuery } from "./search-context";

// Pure client-side search input. Writes to SearchContext on every
// keystroke; SectionList / RecentStrip subscribe and filter the already-
// rendered recipe list against the precomputed search_text. No URL
// state, no debounce, no server round-trip — keystrokes are instant.
export function SearchBar() {
  const pathname = usePathname();
  const { query, setQuery } = useSearchQuery();

  // Hide on focused / detail pages where search would be visual noise.
  if (pathname === "/add") return null;
  if (pathname.startsWith("/recipe/")) return null;

  return (
    <Input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search recipes…"
      className="text-base"
      aria-label="Search recipes"
    />
  );
}
