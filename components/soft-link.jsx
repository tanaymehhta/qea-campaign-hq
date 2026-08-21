"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * A link that changes the page without throwing the reader back to the top.
 *
 * Every segmented control here is a real URL, which is the point — a range is
 * shareable and the back button works. But `<a href>` is a *document*
 * navigation: the browser tears the page down, Next re-runs ten queries, and
 * scroll resets to 0. Picking "All time" from beside the chart landed you at
 * the masthead and you scrolled back down every time. The lower picker's
 * `anchor="chart"` was a patch on exactly that.
 *
 * This is the same href, taken through the router instead, with scroll left
 * where it is. Still an `<a>`, so middle-click, cmd-click and copy-link are
 * untouched, and with JS off it is an ordinary link again.
 *
 * While the server is answering, `data-busy` on <html> dims the tiles — see
 * globals.css. Without it a click looks like nothing happened for a second.
 */
export default function SoftLink({ href, className, children, ...rest }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    const root = document.documentElement;
    if (pending) root.dataset.busy = "1";
    else delete root.dataset.busy;
  }, [pending]);

  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        // A new tab should still be a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        start(() => router.push(href, { scroll: false }));
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
