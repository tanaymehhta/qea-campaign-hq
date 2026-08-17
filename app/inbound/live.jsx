"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Reload this page while a stage is running, and stop when it is not.
 *
 * The pipeline runs on a GitHub runner and writes to Supabase; nothing pushes
 * to the browser. So a rep who presses Restart is looking at a page that will
 * be wrong within thirty seconds and has no way to know it. This asks the
 * server again every four seconds, which is the whole mechanism — no socket,
 * no polling endpoint, no state to keep in sync.
 *
 * `router.refresh()` rather than `location.reload()`: it re-renders the server
 * components in place, so the scroll position, the open <details> folds and the
 * page's identity survive. A full reload of a page you are reading, every four
 * seconds, is worse than no live update at all.
 *
 * Rendered only when something is actually running — the interval exists for as
 * long as the work does, and no longer.
 */
export function Live({ every = 4000 }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
