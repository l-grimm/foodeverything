"use client";

import { createContext, useContext, useState } from "react";

// Search query lives in client state only — it's not in the URL, doesn't
// trigger server re-renders, and isn't debounced. The home page already
// receives every recipe it needs in its initial server payload (filtered
// by course/season/etc.), so SearchBar just narrows that list in-place
// via SectionList/RecentStrip reading this context.
//
// Why no URL: pushing on every keystroke pollutes history, causes Vercel
// serverless cold-start latency per character, and previously caused
// PostgREST URL-length overflows on the downstream id=in.(…) filter.
// All gone now that filtering is local.
type SearchContextValue = {
  query: string;
  setQuery: (q: string) => void;
};

const SearchContext = createContext<SearchContextValue>({
  query: "",
  setQuery: () => {},
});

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchQuery(): SearchContextValue {
  return useContext(SearchContext);
}

// Pure helper for filtering a recipe list by the current search query.
// Empty query is a passthrough. Splits the query on whitespace so
// "garlic tomato" matches recipes whose search_text contains both
// substrings in any order.
export function filterBySearchQuery<T extends { search_text?: string; title: string }>(
  recipes: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return recipes;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return recipes;
  return recipes.filter((r) => {
    const haystack = r.search_text ?? r.title.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}
