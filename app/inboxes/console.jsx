"use client";

import { useMemo, useState } from "react";

/**
 * The mailbox console: every mailbox in one sortable, filterable, searchable
 * table. The one client component on this page — sort, filter and search are
 * live interactions over rows the server already joined, so nothing here fetches
 * or writes. Health that InboxKit hasn't reported yet shows "—" rather than a
 * guess; warmup is on for every mailbox by standing instruction.
 */

const COLS = [
  ["email", "Mailbox", "left"],
  ["owner", "Rep", "left"],
  ["domain", "Domain", "left"],
  ["campaign", "Campaign", "left"],
  ["health", "Health", "right"],
  ["warmup", "Warmup", "right"],
  ["dailyLimit", "Limit", "right"],
  ["active", "Status", "right"],
];

const healthColor = (h) => (h == null ? "var(--ink-3)" : h >= 95 ? "var(--good)" : h >= 85 ? "var(--warn)" : "var(--serious)");

function mark(text, q) {
  if (!q) return text;
  const t = String(text);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return t;
  return (
    <>
      {t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}
    </>
  );
}

export default function InboxesConsole({ rows, campaignOrder }) {
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("all");
  const [camp, setCamp] = useState("all");
  const [sortKey, setSortKey] = useState("domain");
  const [dir, setDir] = useState(1);

  const query = q.toLowerCase().trim();

  const owners = useMemo(() => {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.owner)) seen.set(r.owner, { name: r.owner, ...r.ownerStyle });
    return [...seen.values()];
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows.filter((r) => {
      if (owner !== "all" && r.owner !== owner) return false;
      if (camp === "__none" && r.campaigns.length) return false;
      if (camp !== "all" && camp !== "__none" && !r.campaigns.some((c) => c.name === camp)) return false;
      if (query) {
        const hay = `${r.email} ${r.domain} ${r.owner} ${r.campaigns.map((c) => c.name).join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    const val = (r) => {
      if (sortKey === "campaign") return r.campaigns[0]?.name ?? "";
      if (sortKey === "health") return r.health ?? -1;
      if (sortKey === "warmup") return 1; // all warming
      if (sortKey === "active") return r.active ? 1 : 0;
      return r[sortKey];
    };
    out.sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === "string") return x.localeCompare(y) * dir;
      return (x - y) * dir;
    });
    return out;
  }, [rows, owner, camp, query, sortKey, dir]);

  const click = (k) => {
    if (sortKey === k) setDir((d) => -d);
    else { setSortKey(k); setDir(1); }
  };

  return (
    <div className="ibxc">
      <div className="ibxc-controls">
        <div className="ibxc-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search"
                 placeholder="Search mailbox, domain, rep, or campaign…" autoComplete="off" aria-label="Search mailboxes" />
        </div>
      </div>

      <div className="ibxc-filters">
        <div className="ibxc-fg">
          <span className="flab">Rep</span>
          <button className={`ibxc-chip${owner === "all" ? " on" : ""}`} onClick={() => setOwner("all")}>All</button>
          {owners.map((o) => (
            <button key={o.name} className={`ibxc-chip${owner === o.name ? " on" : ""}`} onClick={() => setOwner(o.name)}>
              <span className="dot" style={{ background: o.ink }} />{o.short}
            </button>
          ))}
        </div>
        <div className="ibxc-fg">
          <span className="flab">Campaign</span>
          <button className={`ibxc-chip${camp === "all" ? " on" : ""}`} onClick={() => setCamp("all")}>All</button>
          {campaignOrder.map((c) => (
            <button key={c} className={`ibxc-chip${camp === c ? " on" : ""}`} onClick={() => setCamp(c)}>{c}</button>
          ))}
          <button className={`ibxc-chip${camp === "__none" ? " on" : ""}`} onClick={() => setCamp("__none")}>Unassigned</button>
        </div>
      </div>

      <div className="card tw ibxc-tablewrap">
        <table>
          <thead>
            <tr>
              {COLS.map(([k, label, align]) => (
                <th key={k} onClick={() => click(k)} className={sortKey === k ? "srt" : ""}
                    style={{ textAlign: align, cursor: "pointer" }}>
                  {label}<span className="ar">{sortKey === k ? (dir > 0 ? " ▲" : " ▼") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} style={{ animationDelay: `${Math.min(i, 30) * 0.012}s` }}>
                <td className="name" style={{ textAlign: "left" }}>{mark(r.email, query)}</td>
                <td style={{ textAlign: "left" }}>
                  <span className="ibxc-owner">
                    <span className="av" style={{ background: r.ownerStyle.tint, color: r.ownerStyle.ink }}>{r.ownerStyle.initials}</span>
                    {r.ownerStyle.short}
                  </span>
                </td>
                <td className="dim mono" style={{ textAlign: "left" }}>{mark(r.domain, query)}</td>
                <td style={{ textAlign: "left" }}>
                  {r.campaigns.length ? (
                    <span className="ibxc-cmps">
                      {r.campaigns.map((c) => (
                        <span key={c.name} className="ibxc-cmp" style={{ background: c.tint, color: c.ink }}>{mark(c.name, query)}</span>
                      ))}
                    </span>
                  ) : <span className="ibxc-cmp none">Unassigned</span>}
                </td>
                <td>
                  <span className="ibxc-health">
                    <span className="bar"><span className="bf" style={{ width: r.health == null ? 0 : `${r.health}%`, background: healthColor(r.health) }} /></span>
                    <b>{r.health == null ? "—" : r.health}{r.health != null && !r.healthReal ? <span className="sup">·</span> : null}</b>
                  </span>
                </td>
                <td><span className="ibxc-wu on">warming</span></td>
                <td className="dim">{r.dailyLimit}/day</td>
                <td>
                  <span className={`ibxc-st ${r.active ? "on" : "off"}`}><span className="d" />{r.active ? "Active" : "Inactive"}</span>
                </td>
              </tr>
            ))}
            {!filtered.length ? <tr><td colSpan={COLS.length} className="empty">Nothing matches these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="ibxc-count">{filtered.length} of {rows.length} mailboxes</p>
    </div>
  );
}
