"use client";

import { useState, useRef, useTransition } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deletePantryItem, updatePantryItemName } from "./actions";

const LONG_PRESS_MS = 500;

export function EditablePantryChip({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  function startLongPress() {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setConfirming(true);
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  function handleClick() {
    if (didLongPress.current) return;
    setEditing(true);
  }

  function commitEdit() {
    setError(null);
    if (value.trim().toLowerCase() === name) { setEditing(false); return; }
    startTransition(async () => {
      const res = await updatePantryItemName(id, value);
      if (res.error) setError(res.error);
      else setEditing(false);
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
      <span className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-background px-2 py-1">
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
        <Button size="sm" variant="ghost" onClick={commitEdit} disabled={pending}
          className="h-7 px-2 font-mono text-[0.7rem] uppercase tracking-wider">Save</Button>
        <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}
          className="h-7 px-2 font-mono text-[0.7rem] uppercase tracking-wider">Cancel</Button>
        {error && <span className="text-xs text-destructive ml-1">{error}</span>}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onClick={handleClick}
        className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:border-primary hover:text-primary select-none"
        title="Tap to edit · hold to remove"
      >
        {name}
      </button>

      {confirming && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onPointerDown={() => setConfirming(false)}
        >
          <div
            className="mx-4 w-full max-w-xs rounded-lg border border-border bg-card p-5 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-sm font-medium text-foreground">
              Remove <span className="text-primary">{name}</span>?
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 font-mono uppercase tracking-wider text-[0.7rem]"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                No
              </Button>
              <Button
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono uppercase tracking-wider text-[0.7rem]"
                onClick={remove}
                disabled={pending}
              >
                {pending ? "…" : "Yes"}
              </Button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
