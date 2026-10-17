"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reExtractRecipe } from "./actions";

type Phase = "idle" | "confirming" | "error";

export function ReExtractButton({
  recipeId,
  onSuccess,
}: {
  recipeId: string;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await reExtractRecipe(recipeId);
      if ("error" in res) {
        setPhase("error");
        setErrorMsg(res.error);
      } else {
        setPhase("idle");
        onSuccess();
      }
    });
  }

  if (isPending) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        className="font-mono uppercase tracking-wider text-[0.7rem]"
      >
        Fetching…
      </Button>
    );
  }

  if (phase === "confirming") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Overwrite?
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={run}
          className="h-7 px-2 font-mono uppercase tracking-wider text-[0.7rem] text-destructive border-destructive hover:bg-destructive/10"
        >
          Yes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPhase("idle")}
          className="h-7 px-2 font-mono uppercase tracking-wider text-[0.7rem]"
        >
          No
        </Button>
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="flex items-center gap-2 flex-wrap justify-end">
        <span className="font-mono text-[0.65rem] text-destructive">{errorMsg}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPhase("idle")}
          className="h-7 px-2 font-mono uppercase tracking-wider text-[0.7rem]"
        >
          Dismiss
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setPhase("confirming")}
      className="font-mono uppercase tracking-wider text-[0.7rem]"
    >
      Re-fetch
    </Button>
  );
}
