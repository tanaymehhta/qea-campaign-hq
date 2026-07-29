import { num, pct, prettyDate, prettyWhen, personHref, PAGE_SIZES } from "../lib/db";

export function Pill({ status }) {
  return <span className={`pill p-${status ?? "unknown"}`}>{(status ?? "unknown").replace(/_/g, " ")}</span>;
}

/**
 * A person's name, opening their hub. The email is the key, so a row without
 * one stays inert text rather than linking somewhere that cannot resolve.
 */
export function PersonLink({ email, name, fallback = "—" }) {
  const href = personHref(email);
  const label = name || email || fallback;
  return href ? <a href={href}>{label}</a> : <span>{label}</span>;
}

/** A segmented control. Options are links, so every state is a real URL. */
export function Seg({ options, current, hrefFor }) {
  return (
    <div className="seg">
      {options.map(([k, label]) => (
        <a key={k} href={hrefFor(k)} className={String(current) === String(k) ? "on" : ""}>{label}</a>
      ))}
    </div>
  );
}

/**
 * The rep picker. Selecting a rep scopes the page to the campaign groups they
 * own — group level is the only place the data records an owner, so it is the
 * only honest thing to filter by.
 */
export function Reps({ reps, current, hrefFor, big, subtitleFor }) {
  const all = { id: "all", name: "All reps", initials: "ALL", role: "Everyone", tint: "var(--tint-n)", ink: "var(--ink-1)" };
  return (
    <div className={big ? "reps big" : "reps"}>
      {[all, ...reps].map((r, i) => (
        <a
          key={r.id}
          href={hrefFor(r.id)}
          className={current === r.id ? "on" : ""}
          style={{ animationDelay: `${0.04 + i * 0.03}s` }}
        >
          <span
            className="glyph"
            style={{ background: r.tint, color: r.ink, fontSize: r.id === "all" ? (big ? 12.5 : 11.5) : undefined }}
          >
            {r.initials}
          </span>
          <span className="who">
            {r.id === "all" ? "All reps" : r.name.split(" ")[0]}
            {big && r.id !== "all" ? <><br />{r.name.split(" ").slice(1).join(" ")}</> : null}
          </span>
          <span className="role">{subtitleFor ? subtitleFor(r) : r.role}</span>
        </a>
      ))}
    </div>
  );
}

/** A number. Give it an href and it becomes the way into the people behind it. */
export function Tile({ label, value, raw, note, tone, hero, plus, href }) {
  const inner = (
    <>
      <div className="lbl">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ""}`} data-count={raw != null ? raw : undefined}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
      {href ? <div className="drill">see who &rarr;</div> : null}
    </>
  );
  const cls = `tile${hero ? " hero" : ""}${plus ? " plus" : ""}`;
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

export function RangePicker({ base, current, day, note }) {
  const q = (s) => (base.includes("?") ? `${base}&${s}` : `${base}?${s}`);
  const opts = [
    ["today", "Today"],
    ["7", "7 days"],
    ["30", "30 days"],
    ["90", "90 days"],
    ["all", "All time"],
  ];
  return (
    <div className="segrow">
      <Seg options={opts} current={current} hrefFor={(k) => q(`range=${k}`)} />
      {day ? (
        <div className="seg">
          <a href={q(`d=${day.prev}`)}>&larr;</a>
          <a href={q(`d=${day.current}`)} className={current === "day" ? "on" : ""}>{prettyDate(day.current)}</a>
          <a href={q(`d=${day.next}`)}>&rarr;</a>
        </div>
      ) : null}
      {note ? <span className="note">{note}</span> : null}
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
      <div className="segrow">
        <span className="note">Show</span>
        <Seg
          options={PAGE_SIZES.map((s) => [s, s])}
          current={size}
          hrefFor={(s) => hrefFor({ size: s, page: 1 })}
        />
        <span className="note">of {num(count)}</span>
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
                <td className="name"><PersonLink email={r.email} name={r.name} /></td>
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
        <div className="range" style={{ marginTop: 12 }}>
          {page > 1 ? <a href={hrefFor({ size, page: page - 1 })}>&larr;</a> : null}
          <span className="count">
            {num(offset + 1)}–{num(Math.min(offset + size, count))} of {num(count)}
          </span>
          {page < pages ? <a href={hrefFor({ size, page: page + 1 })}>&rarr;</a> : null}
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
        {days.map((d, i) => {
          const total = d.instantly + d.lemlist;
          return (
            <div className="bcol" key={d.date} title={`${prettyDate(d.date)} — ${num(total)} sent (${num(d.instantly)} Instantly, ${num(d.lemlist)} lemlist)`}>
              <div className={total ? "bval" : "bval dim"}>{total ? num(total) : "—"}</div>
              <div
                className="bstack"
                style={{ height: `${(total / max) * 100}%`, animationDelay: `${0.1 + i * 0.03}s` }}
              >
                {d.instantly ? <span className="bar" style={{ flex: d.instantly }} /> : null}
                {d.lemlist ? (
                  <span className={d.instantly ? "bar lem" : "bar lem only"} style={{ flex: d.lemlist }} />
                ) : null}
                {!total ? <span className="bar off" style={{ height: 3 }} /> : null}
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
