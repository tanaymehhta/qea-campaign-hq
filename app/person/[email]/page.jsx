import { db, num, prettyDate, prettyWhen } from "../../../lib/db";
import { Pill, Tile } from "../../../components/ui";

export const dynamic = "force-dynamic";

/**
 * Everything the system knows about one human, across every campaign.
 *
 * The rest of the dashboard is organised by campaign, so a person who was
 * contacted by three of them appears three times and never once whole. This is
 * the only page keyed on the person rather than the campaign.
 *
 * Email is the key. It is stored lowercase in every table, so this matches on
 * `eq(lower)` rather than `ilike` — twenty-nine addresses contain an underscore
 * and `ilike` would treat it as a wildcard.
 *
 * No tabs: a typical person here is in one campaign with two recorded events,
 * so tabbing would hide two lines behind a click. Sections stack, as they do on
 * the campaign page.
 *
 * Proposals are absent on purpose. That table records a prospect name and no
 * email, so there is no key to match a person on — and it holds no rows yet.
 * Give it an email column and it belongs here.
 */

const EVENT_LABEL = {
  sent: "Email sent",
  opened: "Email opened",
  clicked: "Link clicked",
  replied: "Replied",
  auto_reply: "Out-of-office reply",
  bounced: "Bounced",
  linkedin_sent: "LinkedIn request sent",
  linkedin_accepted: "LinkedIn request accepted",
  unsubscribed: "Unsubscribed",
  meeting_booked: "Meeting booked",
};

/** The minute an event happened, for collapsing siblings. */
const minuteOf = (ts) => String(ts ?? "").slice(0, 16);

/**
 * lemlist files the same event against every campaign a person sits in, so a
 * campaign split into a main and a referral variant records one out-of-office
 * three times. Per campaign that is true; on a person page it reads as a bug.
 * Collapse anything identical to the minute into one entry that names them all.
 */
function collapse(items, keyOf) {
  const out = new Map();
  for (const it of items) {
    const k = keyOf(it);
    const seen = out.get(k);
    if (seen) seen.campaign_ids.push(it.campaign_id);
    else out.set(k, { ...it, campaign_ids: [it.campaign_id] });
  }
  return [...out.values()];
}

export default async function Person({ params }) {
  const email = decodeURIComponent(params.email ?? "").trim().toLowerCase();

  const [{ data: rows }, { data: acts }, { data: replies }, { data: meetings }] = await Promise.all([
    db.from("people")
      .select("id, campaign_id, source, email, name, company, title, status, sent_count, opened_count, clicked_count, replied_count, bounced, first_contacted_at, last_contacted_at")
      .eq("email", email),
    db.from("activities")
      .select("id, campaign_id, source, event_type, occurred_at")
      .eq("email", email)
      .order("occurred_at", { ascending: false }),
    db.from("replies")
      .select("id, campaign_id, source, lead_name, company, subject, body, sentiment, classified_by, received_at")
      .eq("lead_email", email)
      .order("received_at", { ascending: false }),
    db.from("meetings")
      .select("id, campaign_id, prospect_name, company, meeting_date, status, evidence, note")
      .eq("prospect_email", email)
      .order("meeting_date", { ascending: false }),
  ]);

  const people = rows ?? [];
  const activities = acts ?? [];
  const inbound = replies ?? [];
  const met = meetings ?? [];

  if (!people.length && !activities.length && !inbound.length && !met.length) {
    return (
      <>
        <h1>{email || "No address"}</h1>
        <p className="sub">
          Nothing recorded against this address. It has never been loaded into Instantly or
          lemlist — though it may still sit in the frozen <a href="/leads">leads</a> import,
          which holds twenty-four people no tool has ever seen.
        </p>
      </>
    );
  }

  // Campaign names, statuses and tracking settings for everything they touch.
  const ids = [...new Set([
    ...people.map((p) => p.campaign_id),
    ...activities.map((a) => a.campaign_id),
    ...inbound.map((r) => r.campaign_id),
    ...met.map((m) => m.campaign_id),
  ].filter(Boolean))];
  const { data: cs } = ids.length
    ? await db.from("v_campaign_summary")
        .select("campaign_id, name, sub_campaign_label, status, source, open_tracking, link_tracking, group_slug, group_name")
        .in("campaign_id", ids)
    : { data: [] };
  const campaign = new Map((cs ?? []).map((c) => [c.campaign_id, c]));
  // "Campaign" means the parent group; fall back to the sub-campaign label.
  const labelOf = (id) => {
    const c = campaign.get(id);
    return c ? c.group_name || c.sub_campaign_label || c.name : "—";
  };
  const CampaignLink = ({ id }) =>
    campaign.has(id) ? <a href={`/c/${id}`}>{labelOf(id)}</a> : <span className="dim">—</span>;

  /** The campaigns a collapsed event belongs to, named once each. */
  const CampaignList = ({ ids: list }) => {
    // Dedupe by display label too — two sub-campaigns of one group share a name now.
    const seen = new Set();
    const uniq = [...new Set(list.filter(Boolean))].filter((id) => {
      const l = labelOf(id);
      if (seen.has(l)) return false;
      seen.add(l);
      return true;
    });
    if (!uniq.length) return <span className="dim">—</span>;
    return uniq.map((id, i) => (
      <span key={id}>{i ? " · " : ""}<CampaignLink id={id} /></span>
    ));
  };

  // Identity: the most recently contacted row wins. Name and company can differ
  // between campaigns, and the freshest send is the freshest spelling.
  const newest = [...people].sort(
    (a, b) => String(b.last_contacted_at ?? "").localeCompare(String(a.last_contacted_at ?? ""))
  );
  const who = newest[0] ?? {};
  const name = who.name || inbound[0]?.lead_name || met[0]?.prospect_name || null;
  const company = who.company || inbound[0]?.company || met[0]?.company || null;

  const sum = (k) => people.reduce((t, p) => t + (p[k] ?? 0), 0);
  const sent = sum("sent_count"), opened = sum("opened_count");
  const clicked = sum("clicked_count"), replied = sum("replied_count");

  // Most campaigns run text-only with tracking off, so a zero here is usually
  // structural. Say which, rather than leaving a bare 0 to read as failure.
  const theirs = people.map((p) => campaign.get(p.campaign_id)).filter(Boolean);
  const noOpen = theirs.filter((c) => c.open_tracking === false).length;
  const noLink = theirs.filter((c) => c.link_tracking === false).length;
  const structural = (n, total) =>
    n === 0 ? undefined : n === total ? "no campaign here can record one" : `${n} of ${total} cannot record one`;

  const firstTouch = people.map((p) => p.first_contacted_at).filter(Boolean).sort()[0];
  const lastTouch = people.map((p) => p.last_contacted_at).filter(Boolean).sort().pop();
  const bounced = people.some((p) => p.bounced);

  // One stream: the event log plus the meetings, which no tool records.
  const timeline = collapse(
    [
      ...activities.map((a) => ({ ...a, at: a.occurred_at })),
      ...met.map((m) => ({
        id: m.id, campaign_id: m.campaign_id, source: m.evidence,
        event_type: "meeting_booked", at: `${m.meeting_date}T12:00:00Z`, meeting: m,
      })),
    ],
    (e) => `${e.event_type}|${minuteOf(e.at)}`
  ).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const messages = collapse(inbound, (r) => `${minuteOf(r.received_at)}|${(r.body ?? r.subject ?? "").slice(0, 120)}`);

  return (
    <>
      <h1>{name || email}</h1>
      <p className="sub">
        {name ? <>{email} · </> : null}
        {company ? <>{company} · </> : null}
        {who.title ? <>{who.title} · </> : null}
        in {num(people.length)} {people.length === 1 ? "campaign" : "campaigns"}
        {firstTouch ? <> · first contacted {prettyWhen(firstTouch)}</> : null}
        {lastTouch ? <> · last {prettyWhen(lastTouch)}</> : null}
        {bounced ? " · this address bounced" : ""}
      </p>

      <div className="grid g4">
        <Tile plus label="Emails sent" value={num(sent)} raw={sent}
          tone={sent ? undefined : "muted"}
          note={activities.filter((a) => a.event_type === "sent").length
            ? `${num(activities.filter((a) => a.event_type === "sent").length)} timestamped below`
            : "Instantly reports only the most recent send"} />
        <Tile plus label="Opened" value={num(opened)} raw={opened}
          tone={opened ? undefined : "muted"}
          note={opened ? "A tracking pixel loaded" : structural(noOpen, theirs.length) ?? "No open recorded"} />
        <Tile plus label="Clicked" value={num(clicked)} raw={clicked}
          tone={clicked ? undefined : "muted"}
          note={clicked ? "A deliberate act — the strongest signal short of a reply"
            : structural(noLink, theirs.length) ?? "No click recorded"} />
        <Tile plus label="Replied" value={num(replied)} raw={replied}
          tone={replied ? undefined : "muted"}
          note={!messages.length ? "Nothing inbound"
            : replied > messages.length
              // The count sums per-campaign rows, and lemlist files one message
              // against every sibling campaign. Name the gap rather than leave
              // a figure that does not match the messages under it.
              ? `${num(messages.length)} distinct ${messages.length === 1 ? "message" : "messages"}, filed against ${num(replied)} campaigns`
              : `${num(messages.length)} ${messages.length === 1 ? "message" : "messages"} below`} />
      </div>

      <h2>Where they have been contacted</h2>
      {people.length ? (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Campaign</th>
                <th style={{ textAlign: "left" }}>Group</th>
                <th>Tool</th><th>Status</th>
                <th>Sent</th><th>Opened</th><th>Clicked</th><th>Replied</th>
                <th>First</th><th>Last</th>
              </tr>
            </thead>
            <tbody>
              {newest.map((p) => {
                const c = campaign.get(p.campaign_id);
                return (
                  <tr key={p.id}>
                    <td className="name"><CampaignLink id={p.campaign_id} /></td>
                    <td style={{ textAlign: "left" }} className="dim">
                      {c?.group_slug
                        ? <a href={`/campaigns/${c.group_slug}`}>{c.group_name}</a>
                        : "—"}
                    </td>
                    <td className="dim">{p.source}</td>
                    <td><Pill status={p.status} /></td>
                    <td className={p.sent_count ? "" : "zero"}>{num(p.sent_count)}</td>
                    <td className={p.opened_count ? "" : "zero"}>{num(p.opened_count)}</td>
                    <td className={p.clicked_count ? "" : "zero"}>{num(p.clicked_count)}</td>
                    <td className={p.replied_count ? "" : "zero"}>{num(p.replied_count)}</td>
                    <td className="dim">{p.first_contacted_at ? prettyWhen(p.first_contacted_at) : "—"}</td>
                    <td className="dim">{p.last_contacted_at ? prettyWhen(p.last_contacted_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          No campaign holds this address any more, though events below still name them.
        </p>
      )}

      <h2>Everything that happened</h2>
      {timeline.length ? (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>When</th>
                <th style={{ textAlign: "left" }}>Event</th>
                <th style={{ textAlign: "left" }}>Campaign</th>
                <th style={{ textAlign: "left" }}>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((e) => (
                <tr key={`${e.event_type}-${e.id}`}>
                  <td className="name dim">{prettyWhen(e.at)}</td>
                  <td style={{ textAlign: "left" }}>
                    {EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, " ")}
                    {e.meeting ? (
                      <span className="dim">
                        {" "}· {e.meeting.status}
                        {e.meeting.note ? ` · ${e.meeting.note}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: "left" }}><CampaignList ids={e.campaign_ids} /></td>
                  <td style={{ textAlign: "left" }} className="dim">{e.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          No timestamped events. Instantly reports lifetime counters without saying when, so a
          person contacted only through it can carry figures above and no history here.
        </p>
      )}

      <h2>What they wrote back</h2>
      {messages.length ? (
        messages.map((r) => (
          <div className="msg" key={r.id}>
            <div className="msg-head">
              <span className="who">{prettyWhen(r.received_at)}</span>
              <span className="msg-meta">
                <Pill status={r.sentiment} />
                {r.classified_by === "human" ? <span className="dim">settled by hand</span> : null}
              </span>
            </div>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>
              <CampaignList ids={r.campaign_ids} />
              {r.campaign_ids.length > 1 ? (
                <span> — one message, filed against each</span>
              ) : null}
            </div>
            {r.subject ? <div className="msg-subject" style={{ fontWeight: 600 }}>{r.subject}</div> : null}
            {r.body?.trim() ? (
              <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 6, maxWidth: "74ch", whiteSpace: "pre-wrap" }}>
                {r.body.trim()}
              </div>
            ) : (
              // Eighty of the ninety-eight lemlist replies arrive with the subject
              // and nothing else. Say that, rather than leaving a blank where a
              // message should be.
              <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                {r.source === "lemlist" ? "lemlist recorded the subject only" : "No message body recorded"}
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="empty">
          No replies. The count is a floor — anything sent outside the sequence never reaches
          either tool.
        </p>
      )}

      {met.length ? (
        <>
          <h2>Meetings</h2>
          <div className="card tw">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Date</th>
                  <th style={{ textAlign: "left" }}>Campaign</th>
                  <th>Status</th><th>Evidence</th>
                  <th style={{ textAlign: "left" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {met.map((m) => (
                  <tr key={m.id}>
                    <td className="name">{prettyDate(m.meeting_date)}</td>
                    <td style={{ textAlign: "left" }}><CampaignLink id={m.campaign_id} /></td>
                    <td><Pill status={m.status} /></td>
                    <td className="dim">{m.evidence}</td>
                    <td style={{ textAlign: "left" }} className="dim">{m.note || "—"}</td>
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
