"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-render the server page on a timer, for as long as this is mounted.
 *
 * /feedback only mounts it while a run is actually in flight, so the polling
 * stops on its own the moment the last card turns into a pull request — there
 * is no interval left running behind a finished page.
 *
 * router.refresh() rather than location.reload(): it re-fetches the server
 * components in place, so the page does not flash, scroll position holds, and
 * an open <details> stays open while someone is typing into it.
 */
export default function RefreshWhile({ every = 8000 }) {
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);

  return null;
}
