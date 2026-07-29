"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  ["/", "Overview"],
  ["/meetings", "Meetings"],
  ["/campaigns", "Campaigns"],
  ["/leads", "Leads"],
  ["/replies", "Replies"],
  ["/conflicts", "Conflicts"],
  ["/health", "Health"],
];

/**
 * The nav, and the theme switch that lives in it.
 *
 * Theme is applied to <html> so every token flips at once, and remembered in
 * localStorage. Until someone picks one, `data-theme` is absent and the OS
 * preference wins — see the media query in globals.css.
 */
export default function Nav({ synced, stale, conflicts }) {
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
      <span className="sync">
        <span className={stale ? "dot stale" : "dot"} />
        {synced ? <>synced <b>{synced}</b></> : "never synced"}
      </span>
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
