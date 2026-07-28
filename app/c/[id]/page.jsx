import { db, num, pct, prettyDate, prettyWhen } from "../../../lib/db";
import { Pill } from "../../../components/ui";

export const dynamic = "force-dynamic";

const PLACEHOLDER = /\[\s*PLACEHOLDER|\bTODO\b|\{\{\s*\}\}|\[swap for real/i;

function stripHtml(html) {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function Campaign({ params }) {
  const { data: c } = await db
    .from("v_campaign_summary").select("*").eq("campaign_id", params.id).single();
  if (!c) return <><h1>Not found</h1></>;

  const [{ data: steps }, { data: stepStats }, { data: replies }] = await Promise.all([
    db.from("template_versions").select("*").eq("campaign_id", params.id)
      .order("step_index").order("last_seen", { ascending: false }),
    db.from("step_metrics").select("*").eq("campaign_id", params.id).order("step_index"),
    db.from("replies").select("*").eq("campaign_id", params.id).order("received_at", { ascending: false }).limit(20),
  ]);

  // latest version per step, plus how many versions have existed
  const latest = new Map();
  const versionCount = new Map();
  for (const s of steps ?? []) {
    const k = `${s.step_index}|${s.variant}`;
    versionCount.set(k, (versionCount.get(k) ?? 0) + 1);
    if (!latest.has(k)) latest.set(k, s);
  }
  const statOf = new Map((stepStats ?? []).map((s) => [`${s.step_index}|${s.variant}`, s]));
  const ordered = [...latest.entries()].sort((a, b) => {
    const [ai, av] = a[0].split("|"), [bi, bv] = b[0].split("|");
    return Number(ai) - Number(bi) || av.localeCompare(bv);
  });

  const flagged = ordered.filter(([, s]) => PLACEHOLDER.test(`${s.subject} ${s.body}`));

  return (
    <>
      <p className="dim" style={{ fontSize: 13, marginBottom: 6 }}>
        <a href={`/campaigns/${c.group_slug}`}>&larr; {c.group_name}</a>
      </p>
      <h1>{c.sub_campaign_label || c.name}</h1>
      <p className="sub">
        <Pill status={c.status} /> &nbsp; {c.source}
        {c.daily_limit ? ` · cap ${c.daily_limit}/day` : ""}
        {c.started_on ? ` · started ${prettyDate(c.started_on)}` : ""}
        {c.open_tracking === false ? " · open tracking off" : ""}
        {c.text_only ? " · plain text (no open pixel)" : ""}
      </p>

      {flagged.length ? (
        <div className="warnbox">
          <b>Unfilled placeholder in {flagged.length === 1 ? "step" : "steps"}{" "}
          {flagged.map(([k]) => Number(k.split("|")[0]) + 1).join(", ")}.</b>{" "}
          This copy will go to prospects as written.
        </div>
      ) : null}

      <div className="grid g4">
        <div className="tile"><div className="lbl">Leads</div><div className="val">{num(c.leads)}</div></div>
        <div className="tile"><div className="lbl">Sent</div><div className="val">{num(c.sent)}</div>
          <div className="note">{num(c.bounced)} bounced{c.sent ? ` · ${pct(c.bounced, c.sent)}%` : ""}</div></div>
        <div className="tile"><div className="lbl">Replies</div>
          <div className={c.replied ? "val" : "val muted"}>{num(c.replied)}</div>
          <div className="note">{c.leads ? `${pct(c.replied, c.leads)}% of leads` : "—"}</div></div>
        <div className="tile"><div className="lbl">Meetings</div>
          <div className={c.meetings ? "val" : "val muted"}>{num(c.meetings)}</div></div>
      </div>

      <h2>The sequence</h2>
      {ordered.length === 0 ? <p className="empty">No sequence copy synced for this campaign yet.</p> : null}
      {ordered.map(([k, s]) => {
        const st = statOf.get(k);
        const versions = versionCount.get(k) ?? 1;
        const bad = PLACEHOLDER.test(`${s.subject} ${s.body}`);
        return (
          <div className="step" key={k} style={bad ? { borderColor: "var(--crit)" } : undefined}>
            <div className="head">
              <div>
                <div className="n">
                  Email {s.step_index + 1}
                  {s.delay_days != null ? ` · then wait ${s.delay_days}d` : ""}
                  {versions > 1 ? ` · ${versions} versions, latest ${prettyDate(String(s.last_seen).slice(0, 10))}` : ""}
                </div>
                <div className="subj">{s.subject?.trim() || <span className="dim">(same thread, no subject)</span>}</div>
              </div>
              <div className="stats">
                {st
                  ? <>{num(st.sent)} sent · {num(st.opened)} opened · {num(st.replied)} replied
                      {st.replies_automatic ? ` · ${num(st.replies_automatic)} auto` : ""}</>
                  : <span className="dim">no step data</span>}
              </div>
            </div>
            <div className="body">
              {stripHtml(s.body).split("\n").map((line, i) => <div key={i}>{line || " "}</div>)}
            </div>
          </div>
        );
      })}

      {replies?.length ? (
        <>
          <h2>Replies</h2>
          <div className="card tw">
            <table>
              <thead><tr><th>Who</th><th>Company</th><th>Channel</th><th>Tag</th><th>When</th></tr></thead>
              <tbody>
                {replies.map((r) => (
                  <tr key={r.id}>
                    <td className="name">{r.lead_name || r.lead_email || "—"}</td>
                    <td className="dim" style={{ textAlign: "left" }}>{r.company ?? "—"}</td>
                    <td className="dim">{r.channel}</td>
                    <td><span className="pill">{r.sentiment.replace(/_/g, " ")}</span></td>
                    <td className="dim">{prettyWhen(r.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
