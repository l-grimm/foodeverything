"use client";

import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

// Filters that need to be preserved when the user submits a new search
// query — otherwise typing in the box would clear their active filters.
const PRESERVED_KEYS = [
  "course",
  "season",
  "cuisine",
  "holiday",
  "tags",
  "author",
] as const;

export function SearchBar() {
  const sp = useSearchParams();
  return (
    <form action="/" className="flex w-full gap-2">
      <Input
        name="q"
        defaultValue={sp.get("q") ?? ""}
        placeholder="Search recipes…"
        className="text-base"
        aria-label="Search recipes"
      />
      {PRESERVED_KEYS.map((key) => {
        const v = sp.get(key);
        if (!v) return null;
        return <input key={key} type="hidden" name={key} value={v} />;
      })}
    </form>
  );
}
