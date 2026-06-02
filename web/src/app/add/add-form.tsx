"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addUrl, type AddUrlState } from "./actions";

const initial: AddUrlState = {};

export function AddForm() {
  const [state, action, pending] = useActionState(addUrl, initial);

  return (
    <form action={action} className="space-y-3">
      <Label htmlFor="url">Recipe URL</Label>
      <Input
        id="url"
        name="url"
        type="url"
        placeholder="https://anything — TikTok, Instagram, Substack, NYT Cooking, blog post…"
        required
        className="text-base"
        disabled={pending}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Ingesting…" : "Add recipe"}
      </Button>
      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive whitespace-pre-wrap">
          {state.error}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Most recipe sites publish schema.org/Recipe JSON-LD, which we prefer.
        Article text is the fallback. Ingestion typically takes 10–30s.
      </p>
    </form>
  );
}
