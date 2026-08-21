"use client";

import { useEffect, useState } from "react";

/**
 * A clock counting up from when this phase began.
 *
 * The point is not the number, it is that the number moves: a page where
 * nothing changes for two minutes reads as a page that has hung, and this is
 * the cheapest possible proof that it has not.
 *
 * Starts empty and fills in after mount, because the server and the browser
 * would otherwise disagree about "now" and React would call that a hydration
 * error — the same reason the count never appears in the HTML.
 */
export default function Elapsed({ since }) {
  const [secs, setSecs] = useState(null);

  useEffect(() => {
    const from = new Date(since).getTime();
    const tick = () => setSecs(Math.max(0, Math.round((Date.now() - from) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since]);

  if (secs === null) return null;
  const m = Math.floor(secs / 60);
  return <span className="tick">{m ? `${m}m ${secs % 60}s` : `${secs}s`}</span>;
}
