"use client";

import { useEffect, useState } from "react";

// URL-encoded name of the iOS Shortcut the user has installed.
const SHORTCUT_NAME = "Add To Pantry";
const SHORTCUT_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

export function AddIngredient() {
  // null while detecting (avoids hydration flash); true/false after mount.
  const [isIOS, setIsIOS] = useState<boolean | null>(null);

  useEffect(() => {
    // One-time client-side platform detection. Hydration starts as null
    // (matches server), then this effect resolves it once on mount. The
    // rule is for cascading effects; this is the canonical pattern for
    // "read a browser API at mount".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);

  if (isIOS === null) {
    return <div className="h-24" aria-hidden />;
  }

  if (!isIOS) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Open <span className="font-mono">foodeverything.xyz</span> on your
          phone to add ingredients.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <a
        href={SHORTCUT_URL}
        className="inline-flex h-8 items-center rounded-full bg-primary text-primary-foreground font-mono uppercase tracking-wider text-[0.7rem] px-4 hover:bg-primary/90"
      >
        Open camera
      </a>
      <p className="text-xs text-muted-foreground">
        Launches your &quot;{SHORTCUT_NAME}&quot; iOS Shortcut. Snap a photo of
        your groceries — items land in the pantry automatically.
      </p>
    </div>
  );
}
