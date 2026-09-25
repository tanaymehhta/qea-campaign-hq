"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  ["/", "Overview"],
  ["/chat", "Chat"],
  ["/calls", "Calls"],
  ["/inbound", "Inbound"],
  ["/campaigns", "Campaigns"],
  ["/leads", "Leads"],
  ["/inboxes", "Inboxes"],
  ["/conflicts", "Conflicts"],
  ["/health", "Health"],
  ["/feedback", "Feedback"],
];

/**
 * The nav, and the theme switch that lives in it.
 *
 * Theme is applied to <html> so every token flips at once, and remembered in
 * localStorage. Until someone picks one, `data-theme` is absent and the OS
 * preference wins — see the media query in globals.css.
 */
export default function Nav({ synced, stale, conflicts, review, who }) {
  const path = usePathname();
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme"));
  }, []);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("qea-hq-theme", next); } catch {}
    setTheme(next);
  };

  return (
    <nav className="top">
      <a className="brand" href="/">QEA Campaign HQ</a>
      {LINKS.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className={href === "/" ? (path === "/" ? "on" : "") : path.startsWith(href) ? "on" : ""}
        >
          {label}
          {label === "Conflicts" && conflicts ? <span className="badge">{conflicts}</span> : null}
        </a>
      ))}
      <span className="spacer" />
      {/* Changes finished and waiting on a yes or a no. It sits in the nav on
          every page because the moment you find out something is ready should
          not depend on remembering to go and look. */}
      {review ? (
        <a className="ready" href="/feedback?f=review">
          <span className="pulse" aria-hidden="true" />
          {review} to review
        </a>
      ) : null}
      <span className="sync">
        <span className={stale ? "dot stale" : "dot"} />
        {synced ? <>synced <b>{synced}</b></> : "never synced"}
      </span>
      {/* Who the writes will be signed as. The email is the title rather than
          the label because the two Marks are told apart by their addresses and
          nothing else, and a call logged as the wrong Mark is invisible. A
          person with no rep_name is shown in muted type: they can read
          everything and sign nothing. */}
      {who ? (
        <form method="post" action="/auth/signout"
              style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span title={who.email}
                style={{ fontSize: 12, color: who.rep_name ? "var(--ink-2)" : "var(--ink-3)" }}>
            {who.display_name}{who.rep_name ? "" : " (no rep name)"}
          </span>
          <button type="submit" className="theme" title={`Sign out of ${who.email}`}
                  aria-label="Sign out" style={{ fontSize: 11 }}>
            ⏻
          </button>
        </form>
      ) : null}
      <button
        className="theme"
        onClick={flip}
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        aria-label="Switch theme"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </nav>
  );
}
