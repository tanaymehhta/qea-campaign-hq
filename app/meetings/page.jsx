import { db, num, pct, prettyDate, prettyWhen, initials, repList, listHref } from "../../lib/db";
import { Tile, Reps, Pill } from "../../components/ui";

export const dynamic = "force-dynamic";

/**
 * The primary KPI, and the only thing on this dashboard no tool records.
 *
 * A meeting's rep is the owner of the group it sits in — `logged_by` records who
 * typed it in, which is often not the same person and is not what "whose
 * meeting is this" means.
 */
export default async function Meetings({ searchParams }) {
  const rep = searchParams?.rep ?? "all";

  const [{ groups, reps }, { data: subs }, { data: meetings }, { data: proposals }] = await Promise.all([
    repList(),
    db.from("v_campaign_summary").select("campaign_id, group_id, name, sub_campaign_label, status, leads, replied, source"),
    db.from("meetings").select("*").order("meeting_date", { ascending: false }),
    db.from("proposals").select("id, campaign_id"),
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const subById = new Map((subs ?? []).map((s) => [s.campaign_id, s]));
  const groupOfCampaign = (id) => subById.get(id)?.group_id ?? null;
  const ownerOfGroup = (gid) => groupById.get(gid)?.owner ?? null;
  const ownerOfMeeting = (m) => ownerOfGroup(m.group_id ?? groupOfCampaign(m.campaign_id));

  const known = reps.find((r) => r.id === rep);
  const myGroupIds = known ? new Set(known.groupIds) : null;

  const allMeetings = meetings ?? [];
  const mine = myGroupIds
    ? (subs ?? []).filter((s) => myGroupIds.has(s.group_id))
    : (subs ?? []);
  const myMeetings = known ? allMeetings.filter((m) => ownerOfMeeting(m) === rep) : allMeetings;
  const myProposals = (proposals ?? []).filter(
    (p) => !myGroupIds || myGroupIds.has(groupOfCampaign(p.campaign_id))
  );

  const sum = (k) => mine.reduce((a, s) => a + (s[k] ?? 0), 0);
  const running = mine.filter((s) => s.status === "running").length;
  const countFor = (r) => (r.id === "all" ? allMeetings.length : allMeetings.filter((m) => ownerOfMeeting(m) === r.id).length);

  // Replies that have not yet become a meeting. Matching on email is the only
  // join the two tables share; a reply from someone we already met drops out.
  const met = new Set(allMeetings.map((m) => (m.prospect_email ?? "").toLowerCase()).filter(Boolean));
  const scopedIds = new Set(mine.map((s) => s.campaign_id));
  const { data: replies } = await db
    .from("replies")
    .select("id, campaign_id, lead_name, lead_email, company, sentiment, received_at")
    .neq("sentiment", "auto_reply")
    .order("received_at", { ascending: false })
    .limit(120);
  const waiting = (replies ?? [])
    .filter((r) => !met.has((r.lead_email ?? "").toLowerCase()))
    .filter((r) => !known || scopedIds.has(r.campaign_id))
    .slice(0, 40);

  const here = (id) => (id === "all" ? "/meetings" : `/meetings?rep=${encodeURIComponent(id)}`);
  const nameOf = (id) => {
    const s = subById.get(id);
    return s ? s.sub_campaign_label || s.name : null;
  };

  return (
    <>
      <div className="rise">
        <h1>Meetings</h1>
        <p className="sub">
          The primary KPI, and the only thing on this dashboard no tool records. Pick a rep to see
          their meetings and the replies still waiting to become one.
        </p>
      </div>

      <Reps
        reps={reps}
        current={known ? rep : "all"}
        hrefFor={here}
        big
        subtitleFor={(r) => {
          const n = countFor(r);
          return n === 1 ? "1 meeting" : `${n} meetings`;
        }}
      />

      <div className="grid g5" style={{ marginBottom: 34 }}>
        <Tile label="Campaigns" value={num(mine.length)} raw={mine.length} note={`${running} running`} />
        <Tile label="People" value={num(sum("leads"))} raw={sum("leads")} note="in their lists" />
        <Tile label="Replies" value={num(sum("replied"))} raw={sum("replied")}
          tone={sum("replied") ? undefined : "muted"} note="a floor, not a total" />
        <Tile label="Meetings" value={num(myMeetings.length)} raw={myMeetings.length}
          tone={myMeetings.length ? undefined : "muted"} note="the primary KPI" />
        <Tile label="Proposals" value={num(myProposals.length)} raw={myProposals.length}
          tone={myProposals.length ? undefined : "muted"} note="logged by hand" />
      </div>

      <h2 style={{ marginTop: 0 }}>
        {known ? `Meetings booked by ${rep}` : `All meetings — ${num(allMeetings.length)} logged, ever`}
      </h2>

      {!myMeetings.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>No meetings logged against this rep yet.</p></div>
      ) : null}

      {myMeetings.map((m, i) => {
        const campaign = nameOf(m.campaign_id);
        const owner = ownerOfMeeting(m);
        const tint = reps.find((r) => r.id === owner);
        const anonymous = !m.prospect_name;
        return (
          <details
            className={anonymous ? "mrow hasgap" : "mrow"}
            key={m.id}
            open={i === 0}
            style={{ animationDelay: `${0.06 + i * 0.05}s` }}
          >
            <summary>
              <span
                className="glyph"
                style={{
                  background: tint?.tint ?? "var(--tint-4)",
                  color: anonymous ? "var(--warn-ink)" : tint?.ink ?? "var(--ink-1)",
                }}
              >
                {anonymous ? "?" : initials(m.prospect_name)}
              </span>
              <span className="meat">
                <span className="who" style={anonymous ? { color: "var(--ink-3)" } : undefined}>
                  {m.prospect_name || "No prospect recorded"}
                </span>
                <span className="line">
                  {(m.company || "No company")} — {campaign ?? "campaign unknown"}
                </span>
              </span>
              <Pill status={m.status} />
              <span className="when">{prettyDate(m.meeting_date)}</span>
              <span className="chev">⌄</span>
            </summary>

            <div className="mbody">
              <div className="inner">
                <div className="meta">
                  <div><div className="k">Prospect</div><div className="v">{m.prospect_name || <span className="dim">not recorded</span>}</div></div>
                  <div><div className="k">Company</div><div className="v">{m.company || "—"}</div></div>
                  <div><div className="k">Email</div><div className="v">{m.prospect_email || "—"}</div></div>
                  <div><div className="k">Campaign</div><div className="v">
                    {campaign ? <a className="drilled" href={`/c/${m.campaign_id}`}>{campaign}</a> : "—"}
                  </div></div>
                  <div><div className="k">Evidence</div><div className="v">{m.evidence}</div></div>
                  <div><div className="k">Date</div><div className="v">{prettyDate(m.meeting_date)}</div></div>
                  <div><div className="k">Owner</div><div className="v">{owner ?? "—"}</div></div>
                  <div><div className="k">Logged by</div><div className="v">{m.logged_by || "—"}</div></div>
                  <div><div className="k">Status</div><div className="v">{m.status.replace(/_/g, " ")}</div></div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="k">Note</div><div className="v">{m.note || "—"}</div>
                  </div>
                </div>
                {anonymous ? (
                  <div className="warnbox plain">
                    This meeting was logged by hand with no prospect name, so it counts towards the
                    KPI but cannot be traced to anyone.{" "}
                    <a className="drilled" href="/conflicts">Fill the name in on Conflicts</a>.
                  </div>
                ) : null}
              </div>
            </div>
          </details>
        );
      })}

      <h2>Replies waiting to become meetings</h2>
      <p className="sub">
        {waiting.length
          ? "Every inbound that is not an out-of-office and does not already have a meeting against it, newest first. Matching is by email address, so a reply from a colleague of someone we met still shows here."
          : "No named replies against this rep's campaigns are still open."}
      </p>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>Person</th><th>Company</th><th>Campaign</th><th>Owner</th><th>Read as</th><th>Replied</th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((r) => {
              const gid = groupOfCampaign(r.campaign_id);
              return (
                <tr key={r.id}>
                  <td className="name">
                    {r.lead_name || r.lead_email || "Unknown"}
                    {r.lead_name && r.lead_email ? <span className="alias">{r.lead_email}</span> : null}
                  </td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td className="dim" style={{ textAlign: "left" }}>
                    {nameOf(r.campaign_id) ? (
                      <a className="drilled" href={`/c/${r.campaign_id}`}>{nameOf(r.campaign_id)}</a>
                    ) : "—"}
                  </td>
                  <td style={{ textAlign: "left" }}>{ownerOfGroup(gid) ?? "—"}</td>
                  <td><Pill status={r.sentiment} /></td>
                  <td className="dim">{prettyWhen(r.received_at)}</td>
                </tr>
              );
            })}
            {!waiting.length ? (
              <tr><td colSpan={6} className="empty">Nothing waiting.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="range" style={{ marginTop: 18 }}>
        <a href={listHref({ metric: "meetings", range: "all" })}>Every meeting as a list &rarr;</a>
      </div>
    </>
  );
}
