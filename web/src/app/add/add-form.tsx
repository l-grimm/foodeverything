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
      <Input
        id="url"
        name="url"
        type="url"
        placeholder="https://…"
        required
        className="text-base"
        disabled={pending}
        aria-label="Recipe URL"
      />
      <Button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary text-primary-foreground font-mono uppercase tracking-wider text-[0.7rem] px-4 hover:bg-primary/90"
      >
        {pending ? "Ingesting…" : "Add"}
      </Button>
      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-wrap">
          {state.error}
        </div>
      )}
    </form>
  );
}
