"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The slide-over that holds a person while the rep is on the phone to them.
 *
 * The only client component on this page, and it holds no data: `children` is
 * server-rendered HTML — the same <PersonPanel> the list row renders, forms and
 * server actions included. All this adds is the open/close animation, the scrim
 * and the Esc key.
 *
 * Open means `?open=<contact_id>` is in the URL, which is what log_call's
 * redirect already sets. So a write reopens the drawer on the same person for
 * free, and closing is a router.replace that drops the param — replace, not
 * push, for the same reason the action redirects with "replace": a rep should
 * not collect one history entry per person they looked at.
 */
export function Drawer({ open, title, subtitle, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      const q = new URLSearchParams(params);
      q.delete("open");
      q.delete("editCall");
      router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the drawer is over it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, pathname, params, router]);

  if (!open) return null;

  const closeHref = (() => {
    const q = new URLSearchParams(params);
    q.delete("open");
    q.delete("editCall");
    return `${pathname}${q.size ? `?${q}` : ""}`;
  })();

  return (
    <>
      {/* A link, not an onClick, so closing works before hydration too. */}
      <a className="scrim" href={closeHref} aria-label="Close" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="note">{subtitle}</p> : null}
          </div>
          <a className="choice" href={closeHref}>
            Close <span className="kbd">esc</span>
          </a>
        </header>
        <div className="drawerbody">{children}</div>
      </aside>
    </>
  );
}
