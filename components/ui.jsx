import { num, pct, prettyDate, prettyWhen, PAGE_SIZES } from "../lib/db";

export function Pill({ status }) {
  return <span className={`pill p-${status ?? "unknown"}`}>{(status ?? "unknown").replace(/_/g, " ")}</span>;
}

/** A number. Give it an href and it becomes the way into the people behind it. */
export function Tile({ label, value, note, tone, hero, href }) {
  const inner = (
    <>
      <div className="lbl">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ""}`}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
      {href ? <div className="drill">see who &rarr;</div> : null}
    </>
  );
  const cls = `tile${hero ? " hero" : ""}${href ? " clickable" : ""}`;
  return href ? <a className={cls} href={href}>{inner}</a> : <div className={cls}>{inner}</div>;
}

/** Bounce rate coloured against the runbook: <2% fine, 2–5% watch, >5% stop. */
export function BounceCell({ bounced, base }) {
  const p = pct(bounced, base);
  if (p === null) return <td className="zero">—</td>;
  const cls = p > 5 ? "bad" : p >= 2 ? "mid" : "";
  return <td className={cls}>{p}%</td>;
}

export function Num({ v, zeroDim = true }) {
  return <td className={zeroDim && !v ? "zero" : ""}>{num(v)}</td>;
}

/** A table number that opens the list of people behind it. Zero stays inert. */
export function DrillCell({ v, href }) {
  if (!v) return <td className="zero">{num(v)}</td>;
  return <td><a className="drilled" href={href}>{num(v)}</a></td>;
}

export function RangePicker({ base, current, day }) {
  const q = (s) => (base.includes("?") ? `${base}&${s}` : `${base}?${s}`);
  const opts = [
    ["today", "Today"],
    ["7", "7 days"],
    ["30", "30 days"],
    ["90", "90 days"],
    ["all", "All time"],
  ];
  return (
    <div className="range">
      {opts.map(([k, label]) => (
        <a key={k} href={q(`range=${k}`)} className={current === k ? "on" : ""}>{label}</a>
      ))}
      {day ? (
        <>
          <a className="step" href={q(`d=${day.prev}`)}>&larr;</a>
          <a className={current === "day" ? "on" : ""} href={q(`d=${day.current}`)}>{prettyDate(day.current)}</a>
          <a className="step" href={q(`d=${day.next}`)}>&rarr;</a>
        </>
      ) : null}
    </div>
  );
}

/**
 * The people in a campaign, paged. 25/50/100 rather than everyone at once —
 * a group can run to a couple of thousand rows.
 *
 * `hrefFor({size, page})` builds the link back into whichever page is hosting
 * this, so the same table works for a group and for a single sub-campaign.
 */
export function PeopleTable({ rows, count, size, page, hrefFor, campaignOf }) {
  const pages = Math.max(1, Math.ceil(count / size));
  const offset = (page - 1) * size;
  return (
    <>
      <div className="range">
        <span className="dim" style={{ fontSize: 12.5, alignSelf: "center", marginRight: 4 }}>Show</span>
        {PAGE_SIZES.map((s) => (
          <a key={s} href={hrefFor({ size: s, page: 1 })} className={size === s ? "on" : ""}>{s}</a>
        ))}
        <span className="dim" style={{ fontSize: 12.5, alignSelf: "center", marginLeft: 8 }}>
          of {num(count)}
        </span>
      </div>

      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Company</th>
              {campaignOf ? <th style={{ textAlign: "left" }}>Sub-campaign</th> : null}
              <th>Status</th><th>Opens</th><th>Clicks</th><th>Replies</th><th>Last contacted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="name">{r.name || "—"}</td>
                <td className="dim" style={{ textAlign: "left" }}>{r.email}</td>
                <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                {campaignOf ? (
                  <td style={{ textAlign: "left" }} className="dim">{campaignOf.get(r.campaign_id) ?? "—"}</td>
                ) : null}
                <td><Pill status={r.status} /></td>
                <td className={r.opened_count ? "" : "zero"}>{num(r.opened_count)}</td>
                <td className={r.clicked_count ? "" : "zero"}>{num(r.clicked_count)}</td>
                <td className={r.replied_count ? "" : "zero"}>{num(r.replied_count)}</td>
                <td className="dim">{r.last_contacted_at ? prettyWhen(r.last_contacted_at) : "—"}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><td colSpan={9} className="empty">
                No people synced for this campaign yet.
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="range">
          {page > 1 ? <a className="step" href={hrefFor({ size, page: page - 1 })}>&larr;</a> : null}
          <span className="dim" style={{ alignSelf: "center", fontSize: 12.5 }}>
            {num(offset + 1)}–{num(Math.min(offset + size, count))} of {num(count)}
          </span>
          {page < pages ? <a className="step" href={hrefFor({ size, page: page + 1 })}>&rarr;</a> : null}
        </div>
      ) : null}
    </>
  );
}

/** Stacked daily bars, Instantly over lemlist. No library — it's two divs. */
export function DailyBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.instantly + d.lemlist));
  return (
    <div className="card">
      <div className="legend">
        <span><i style={{ background: "var(--s1)" }} />Instantly</span>
        <span><i style={{ background: "var(--s2)" }} />lemlist</span>
        <span className="dim">emails sent per day</span>
      </div>
      <div className="bars">
        {days.map((d) => {
          const total = d.instantly + d.lemlist;
          return (
            <div className="bcol" key={d.date} title={`${prettyDate(d.date)} — ${num(total)} sent (${num(d.instantly)} Instantly, ${num(d.lemlist)} lemlist)`}>
              <div className="bval">{total ? num(total) : <span className="dim">—</span>}</div>
              <div className="bstack" style={{ height: `${(total / max) * 100}%` }}>
                {d.instantly ? <span className="bar" style={{ flex: d.instantly }} /> : null}
                {d.lemlist ? <span className="bar lem" style={{ flex: d.lemlist }} /> : null}
                {!total ? <span className="bar off" style={{ height: 2 }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bx">
        {days.map((d) => <span key={d.date}>{prettyDate(d.date).replace(/,/, "")}</span>)}
      </div>
    </div>
  );
}
