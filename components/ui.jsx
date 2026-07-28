import { num, pct, prettyDate } from "../lib/db";

export function Pill({ status }) {
  return <span className={`pill p-${status ?? "unknown"}`}>{(status ?? "unknown").replace(/_/g, " ")}</span>;
}

export function Tile({ label, value, note, tone, hero }) {
  return (
    <div className={hero ? "tile hero" : "tile"}>
      <div className="lbl">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ""}`}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
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
