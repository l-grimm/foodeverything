"use client";

import { useEffect } from "react";

const SCROLL_KEY = "home-scroll-y";

// Save the home page's window.scrollY continuously while the user is on
// /, restore it when they come back from /recipe/[id].
//
// Why this is harder than it looks:
// 1. Relying on useEffect cleanup to save the scroll on unmount is
//    unreliable in App Router — concurrent rendering means the cleanup
//    may not fire in the order we expect, and on a popstate-triggered
//    transition the old page may unmount after the new page's effects
//    have already fired. So we save on every scroll event instead
//    (debounced via rAF) — whatever the latest position is, it's in
//    sessionStorage.
// 2. Next's router fires an auto-scroll-to-top on navigation completion,
//    which can clobber our restoration. We retry across several frames
//    until window.scrollY actually equals the target.
// 3. The page may not be fully laid out on the first paint after mount
//    (especially when React hydrates the streamed tree); the retry loop
//    also covers that case — once document.body.scrollHeight is tall
//    enough, the scrollTo call sticks.
export function HomeScrollRestorer() {
  useEffect(() => {
    let scrollSaveScheduled = false;
    let isRestoring = false;

    const saveScroll = () => {
      scrollSaveScheduled = false;
      if (isRestoring) return;
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };

    const handleScroll = () => {
      if (scrollSaveScheduled) return;
      scrollSaveScheduled = true;
      requestAnimationFrame(saveScroll);
    };

    // Restore on mount with retries — Next's auto-scroll-to-top and
    // late hydration can both knock us off target.
    const raw = sessionStorage.getItem(SCROLL_KEY);
    const target = raw ? Number(raw) : 0;
    if (Number.isFinite(target) && target > 0) {
      isRestoring = true;
      let attempts = 0;
      const maxAttempts = 30; // ~500ms at 60fps — enough to outlast nav
      const restore = () => {
        window.scrollTo(0, target);
        attempts++;
        if (attempts < maxAttempts && Math.abs(window.scrollY - target) > 2) {
          requestAnimationFrame(restore);
        } else {
          isRestoring = false;
        }
      };
      requestAnimationFrame(restore);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return null;
}
