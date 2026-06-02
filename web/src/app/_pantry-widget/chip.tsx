"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deletePantryItem, updatePantryItemName } from "./actions";

export function EditablePantryChip({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commitEdit() {
    setError(null);
    if (value.trim().toLowerCase() === name) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await updatePantryItemName(id, value);
      if (res.error) {
        setError(res.error);
      } else {
        setEditing(false);
      }
    });
  }

  function cancel() {
    setValue(name);
    setError(null);
    setEditing(false);
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deletePantryItem(id);
      if (res.error) setError(res.error);
    });
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-full border bg-background px-2 py-1">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") cancel();
          }}
          className="h-7 w-40 text-sm"
          disabled={pending}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={commitEdit}
          disabled={pending}
          className="h-7 px-2 text-xs"
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={cancel}
          disabled={pending}
          className="h-7 px-2 text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={remove}
          disabled={pending}
          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
        >
          Delete
        </Button>
        {error && <span className="text-xs text-destructive ml-1">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="rounded-full border bg-background px-3 py-1 text-xs hover:bg-accent"
      title="Tap to edit or delete"
    >
      {name}
    </button>
  );
}
