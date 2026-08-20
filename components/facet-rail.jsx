"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * The Leads rail, as a client component — for the navigation, not the logic.
 *
 * Every facet was a plain <a href>. A plain anchor is a document navigation:
 * the browser discards the page, re-parses the stylesheet, re-runs every
 * fadeUp animation and scrolls you back to the top — for a filter change
 * three-quarters of the way down the page. The server render is ~400ms; the
 * reload around it was what made it feel sketchy.
 *
 * So the rows are router pushes inside a transition instead:
 *
 *   The page is not thrown away.  React keeps the DOM, so the tiles do not
 *   flash and the rail does not re-enter.
 *
 *   Your scroll stays.  `scroll: false` — you are looking at the rail, and
 *   the rail is where you should still be looking afterwards.
 *
 *   The tick moves on the click, not on the response.  The row you pressed
 *   shows its new state immediately and the table dims while the real answer
 *   is on its way, so nothing is silent for 400ms.
 *
 * All the counting still happens on the server. This file holds no filter
 * logic — it receives finished rows and pushes URLs.
 */
export default function FacetRail({ sections, filtered }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The href being navigated to, so the row you pressed can tick before the
  // server answers. Cleared when the transition ends and the real state lands.
  const [going, setGoing] = useState(null);

  useEffect(() => {
    if (!pending) setGoing(null);
  }, [pending]);

  // The table and the count above it belong to the old answer while a new one
  // is loading. Dimming them is the whole feedback: <html data-busy> is read by
  // one rule in globals.css, so nothing outside this file needs to know.
  useEffect(() => {
    const el = document.documentElement;
    if (pending) el.setAttribute("data-busy", "1");
    else el.removeAttribute("data-busy");
    return () => el.removeAttribute("data-busy");
  }, [pending]);

  const go = (e, href) => {
    // Let ⌘-click, middle-click and "open in new tab" do what they always do.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setGoing(href);
    startTransition(() => router.push(href, { scroll: false }));
  };

  return (
    <details className="rail" open>
      <summary>Filters {filtered ? "· on" : ""}</summary>
      <div className="railbody">
        {sections.map((s) => (
          <div className="facet" key={s.key}>
            <h4>
              <span title={s.hint}>{s.title}</span>
              {s.clearHref ? (
                <a className="rst" href={s.clearHref} onClick={(e) => go(e, s.clearHref)}>clear</a>
              ) : null}
            </h4>
            {s.rows.map((r) => {
              // Optimistic: the row you pressed flips now. If it was on it goes
              // off, because its href is the one that clears it.
              const on = going === r.href ? !r.on : r.on;
              return (
                <a
                  key={r.key}
                  href={r.href}
                  onClick={(e) => go(e, r.href)}
                  className={[
                    "frow",
                    on ? "on" : "",
                    r.violet ? "v" : "",
                    r.n ? "" : "nil",
                    going === r.href ? "waiting" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <span className="box">{on ? "✓" : ""}</span>
                  {r.swatch ? <span className="sw" style={{ background: r.swatch }} /> : null}
                  <span className="lbl">{r.label}</span>
                  <span className="n">{r.n}</span>
                </a>
              );
            })}
            {s.foot ? (
              <div className="frow nil" style={{ paddingTop: 6 }}>
                <span className="lbl" style={{ fontSize: 11.5 }}>{s.foot.label}</span>
                <span className="n">{s.foot.n}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Pagination and "clear all" — the same push, so no control on this page is a
 * document reload while its neighbours are not.
 */
export function SoftLink({ href, className, style, children }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        startTransition(() => router.push(href, { scroll: false }));
      }}
    >
      {children}
    </a>
  );
}

/**
 * Search. It was a GET form, which is a document load — the one control on the
 * page still throwing the page away while its neighbours no longer do. Same
 * push as the rail, so pressing Enter behaves like ticking a box. Typing is
 * never intercepted: the input is uncontrolled and only submit navigates.
 */
export function LeadSearch({ base, defaultValue }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <form
      className="searchbox"
      style={{ width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        // `base` is the current URL with every other filter already on it —
        // a string, because a function cannot cross the server boundary.
        const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        const u = new URL(base, window.location.origin);
        if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
        u.searchParams.delete("page");
        startTransition(() => router.push(`${u.pathname}${u.search}`, { scroll: false }));
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input type="search" name="q" defaultValue={defaultValue}
        placeholder="Search name, email, company, or phone…" />
    </form>
  );
}
