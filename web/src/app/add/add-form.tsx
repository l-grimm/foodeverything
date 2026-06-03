"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addUrl, type AddUrlState } from "./actions";

const initial: AddUrlState = {};

export function AddForm() {
  const [state, action, pending] = useActionState(addUrl, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="url" className="label-mono">Recipe URL</label>
        <Input
          id="url"
          name="url"
          type="url"
          placeholder="https://…"
          required
          className="text-base"
          disabled={pending}
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary text-primary-foreground font-mono uppercase tracking-wider text-[0.7rem] px-4 hover:bg-primary/90"
      >
        {pending ? "Ingesting…" : "Add recipe"}
      </Button>
      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-wrap">
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
