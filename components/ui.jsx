import { num, pct, prettyDate, prettyWhen, personHref, PAGE_SIZES } from "../lib/db";

export function Pill({ status }) {
  return <span className={`pill p-${status ?? "unknown"}`}>{(status ?? "unknown").replace(/_/g, " ")}</span>;
}

/**
 * The funnel as a strip: New → Attempted → Connected → Meeting → Proposal →
 * Closed, with every rung the contact has reached filled in and dated, the
 * current rung ringed, and the rest waiting. The stage is derived (stageOf),
 * so this only draws what the touches already prove — it is never out of step
 * with the timeline below it. A Closed node reads green for Won, crimson for
 * Lost, carried on the strip's data-variant.
 */
export function StageStrip({ stage }) {
  if (!stage) return null;
  return (
    <ol className="ststrip" data-variant={stage.variant ?? ""}>
      {stage.steps.map((s) => (
        <li key={s.key} className={`ststep${s.done ? " done" : ""}${s.current ? " now" : ""}`}>
          <span className="stdot" aria-hidden="true" />
          <span className="stlbl">{s.label}</span>
          <span className="stdate">{s.date ? prettyDate(s.date) : ""}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The disclosure chevron. An SVG rather than the "⌄" glyph it replaced: the
 * glyph carried its ink high in its line box, so beside a label like "Detail"
 * it rode above the text and never looked centred. The SVG is symmetric about
 * its own box, so it sits on the text's midline and rotates cleanly to point up
 * when the surrounding <details> is open (`details[open] .chev` flips it).
 */
export function Chev() {
  return (
    <svg className="chev" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

/**
 * Which of the four hues each class wears, pinned by name so `bounced` is the
 * same crimson on the campaign page as on the drill-down, and a filter that
 * drops a class never repaints the ones that survive.
 *
 * The two poles are anchored to meaning, because in this dashboard a colour is
 * supposed to carry a decision: green is the outcome you want, crimson is the
 * one that ends the conversation. Blue and orange are the classes still in
 * motion, and they are told apart by position rather than by sentiment.
 *
 * Four is the ceiling and it is a measured one: --cat-1…4 were validated as a
 * set, every pair against every other, in both themes. A fifth could not be
 * added without two of them becoming confusable under deuteranopia — so the
 * fifth slice and the folded tail wear the neutral instead.
 */
const CAT_OF = {
  // 4 — the outcome you want
  replied: 4, interested: 4, booked: 4, won: 4, sent: 4,
  // 1 — the outcome that stops the conversation
  bounced: 1, not_interested: 1, no_email: 1, cancelled: 1, no_show: 1, lost: 1, unsubscribed: 1,
  // 2 and 3 — still moving, and in that order
  active: 2, assigned: 2, referral: 2, draft: 2,
  contacted: 3, prospect: 3, not_now: 3,
  // everything else, including auto_reply and unclassified, wears the neutral:
  // a colour that meant nothing in particular would be decoration.
};

const catVar = (label) => (CAT_OF[label] ? `var(--cat-${CAT_OF[label]})` : "var(--cat-n)");

/**
 * What a long table is made of, before you read it.
 *
 * Colour carries identity here — which class a slice is — so the hues come from
 * the validated four in `globals.css` and are pinned to the class by name,
 * never handed out by rank. A filter that drops a class does not repaint the
 * ones that survive.
 *
 * The legend repeats every label beside its count, so identity is never colour
 * alone, and the table underneath is the same data in full. A 2px gap in the
 * surface colour separates neighbours: the one pair sitting in the CVD floor
 * band, green against orange, is legal only with a secondary cue, and the gap
 * and the labelled legend are it.
 *
 * Under three classes there is nothing to divide, and a two-slice pie is a
 * worse way of writing one number, so it renders nothing.
 */
export function ShareDonut({ title, items, note, max = 5 }) {
  const rows = [...(items ?? [])].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length < 3) return null;

  // Beyond the fifth the slices stop being readable, so the tail becomes one.
  const head = rows.slice(0, max);
  const tail = rows.slice(max);
  const shown = tail.length
    ? [...head, { label: `${tail.length} more`, value: tail.reduce((t, r) => t + r.value, 0), rest: true }]
    : head;

  const total = shown.reduce((t, r) => t + r.value, 0);
  const R = 52, C = 2 * Math.PI * R, GAP = 2;
  let at = 0;

  return (
    <div className="card donut">
      <svg viewBox="0 0 130 130" role="img" aria-label={`${title}: ${shown.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {shown.map((s, i) => {
          const len = (s.value / total) * C;
          const seg = Math.max(len - GAP, 1);
          const dash = `${seg} ${C - seg}`;
          const offset = -at;
          at += len;
          return (
            <circle
              key={s.label} cx="65" cy="65" r={R} fill="none" strokeWidth="15"
              stroke={s.rest ? "var(--cat-n)" : catVar(s.label)}
              strokeDasharray={dash} strokeDashoffset={offset}
              style={{ animationDelay: `${0.08 + i * 0.05}s` }}
            />
          );
        })}
        <text x="65" y="62" className="dnum">{num(total)}</text>
        <text x="65" y="77" className="dcap">{title}</text>
      </svg>

      <ul className="dlegend">
        {shown.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.rest ? "var(--cat-n)" : catVar(s.label) }} />
            <span className="dlabel">{s.label.replace(/_/g, " ")}</span>
            <span className="dval">{num(s.value)}</span>
            <span className="dpct">{Math.round((1000 * s.value) / total) / 10}%</span>
          </li>
        ))}
        {note ? <li className="dnote">{note}</li> : null}
      </ul>
    </div>
  );
}

/** Count rows by a field, for the donut. */
export function tally(rows, field) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = r[field] ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value }));
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

export function RangePicker({ base, current, day, note, anchor }) {
  const hash = anchor ? `#${anchor}` : "";
  const q = (s) => (base.includes("?") ? `${base}&${s}${hash}` : `${base}?${s}${hash}`);
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
              <th>#</th>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Company</th>
              {campaignOf ? <th style={{ textAlign: "left" }}>Sub-campaign</th> : null}
              <th>Status</th><th>Opens</th><th>Clicks</th><th>Replies</th><th>Last contacted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{offset + i + 1}</td>
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
              <tr><td colSpan={campaignOf ? 11 : 10} className="empty">
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

/** "Wed 6 Aug" without the weekday, for tight axis labels. */
const shortDate = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
    .format(new Date(`${iso}T12:00:00Z`));

/**
 * Stacked daily bars, Instantly over lemlist. No library — it's two divs.
 * Long windows scroll inside the card (newest day in view first) instead of
 * overflowing the page; every column keeps enough width for its date label,
 * and each colored segment carries its own hover tooltip.
 */
export function DailyBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.instantly + d.lemlist));
  const wide = days.length > 16;
  return (
    <div className="card">
      <div className="legend">
        <span><i style={{ background: "var(--s1)" }} />Instantly</span>
        <span><i style={{ background: "var(--s2)" }} />lemlist</span>
        <span className="dim">emails sent per day{wide ? " · scroll for older days" : ""}</span>
      </div>
      <div className="bscroll">
        <div className="binner" style={wide ? { minWidth: days.length * 46 } : undefined}>
          <div className="bars">
            {days.map((d, i) => {
              const total = d.instantly + d.lemlist;
              const when = prettyDate(d.date);
              return (
                <div className="bcol" key={d.date}
                  title={`${when} — ${num(total)} sent (${num(d.instantly)} Instantly, ${num(d.lemlist)} lemlist)`}>
                  <div className={total ? "bval" : "bval dim"}>{total ? num(total) : "—"}</div>
                  <div
                    className="bstack"
                    style={{ height: `${(total / max) * 100}%`, animationDelay: `${0.1 + Math.min(i, 20) * 0.03}s` }}
                  >
                    {d.instantly ? (
                      <span className="bar" style={{ flex: d.instantly }}
                        title={`${when} — ${num(d.instantly)} Instantly`} />
                    ) : null}
                    {d.lemlist ? (
                      <span className={d.instantly ? "bar lem" : "bar lem only"} style={{ flex: d.lemlist }}
                        title={`${when} — ${num(d.lemlist)} lemlist`} />
                    ) : null}
                    {!total ? <span className="bar off" style={{ height: 3 }} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bx">
            {days.map((d) => (
              <span key={d.date} title={prettyDate(d.date)}>
                {wide ? shortDate(d.date) : prettyDate(d.date).replace(/,/, "")}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
