"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

// Debounce window for live search — long enough to coalesce a few quick
// keystrokes into one URL change, short enough to feel reactive.
const DEBOUNCE_MS = 250;

export function SearchBar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const urlQ = sp.get("q") ?? "";
  const [value, setValue] = useState(urlQ);
  const [lastSyncedUrlQ, setLastSyncedUrlQ] = useState(urlQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the input from URL changes that didn't originate here — e.g.
  // browser back, a filter click that landed without a query, or the
  // user hitting the FOOD EVERYTHING home link. Render-time conditional
  // setState (the React-recommended pattern for "reset state when a
  // prop changes") avoids the cascading-render lint trap that the
  // equivalent useEffect would hit.
  if (urlQ !== lastSyncedUrlQ) {
    setLastSyncedUrlQ(urlQ);
    setValue(urlQ);
  }

  // Cancel any pending debounce when the URL's q changes, so a stale
  // in-flight keystroke push doesn't overwrite the freshly-changed URL.
  // Also runs on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [urlQ]);

  // Hide on focused / detail pages where search would be visual noise.
  if (pathname === "/add") return null;
  if (pathname.startsWith("/recipe/")) return null;

  function pushQuery(q: string) {
    // Clone the current URL so every other filter (course, cuisine,
    // tags, needsReview, family, etc.) survives. Reset page since a
    // new query invalidates the prior page offset.
    const next = new URLSearchParams(sp.toString());
    if (q) next.set("q", q);
    else next.delete("q");
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/?${qs}` : "/");
    });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushQuery(next);
    }, DEBOUNCE_MS);
  }

  // Enter still submits — fires the URL update immediately rather than
  // waiting out the debounce. Useful if the user pauses, types one
  // more character, then hits Enter.
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushQuery(value);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full gap-2">
      <Input
        name="q"
        value={value}
        onChange={onChange}
        placeholder="Search recipes…"
        className={`text-base transition-opacity ${
          isPending ? "opacity-70" : "opacity-100"
        }`}
        aria-label="Search recipes"
      />
    </form>
  );
}
