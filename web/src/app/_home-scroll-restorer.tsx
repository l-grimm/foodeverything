"use client";

import { useEffect } from "react";

const SCROLL_KEY = "home-scroll-y";

// Save the home page's window.scrollY on the way out, restore it on
// the way in. Next App Router unmounts the home page when the user taps
// into /recipe/[id] and re-mounts it on back navigation — neither side
// of that round-trip preserves window scroll natively. This is the
// belt-and-suspenders fix.
//
// useEffect cleanup runs at unmount (navigation away) → save scrollY.
// useEffect setup runs at mount (navigation in) → read + restore.
// Empty deps array so it only fires on real mount/unmount, not on the
// many re-renders from filter or tab changes.
export function HomeScrollRestorer() {
  useEffect(() => {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (raw) {
      const y = Number(raw);
      if (Number.isFinite(y) && y > 0) {
        // Defer one frame so the browser has the home page's full layout
        // before we ask it to jump. Otherwise on a fresh un-hide the
        // scroll lands at 0 because layout hasn't settled.
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    }
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };
  }, []);
  return null;
}
