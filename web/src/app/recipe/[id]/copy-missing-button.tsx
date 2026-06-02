"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyMissingButton({ missing }: { missing: string[] }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const text = missing.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: clipboard API blocked (older browsers, insecure origins).
      window.prompt("Copy this shopping list:", text);
    }
  }

  return (
    <Button type="button" onClick={onClick} variant="outline" size="sm">
      {copied ? "Copied ✓" : `Copy missing list (${missing.length})`}
    </Button>
  );
}
