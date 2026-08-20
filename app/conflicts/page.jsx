import { db, num, prettyDate, prettyWhen } from "../../lib/db";
import { Pill, PersonLink } from "../../components/ui";
import { classifyReply, recordMeetingDetail, mergeMeetings } from "./actions";

export const dynamic = "force-dynamic";

const LABELS = [
  ["interested", "Interested"],
  ["referral", "Referral"],
  ["not_now", "Not now"],
  ["not_interested", "Not interested"],
  ["auto_reply", "Out of office"],
];

/**
 * Everything the tools cannot settle on their own.
 *
 * A conflict is derived, never stored: it appears when the data disagrees with
 * itself and disappears the moment it agrees. There is nothing to mark as done,
 * so nothing can sit here stale and wrong.
 */
export default async function Conflicts({ searchParams }) {
  const sp = searchParams ?? {};
  const { data: conflicts } = await db.from("v_conflicts").select("*").order("conflict_date", { ascending: false });
  const list = conflicts ?? [];

  const campaignIds = [...new Set(list.map((c) => c.campaign_id).filter(Boolean))];
  const { data: campaigns } = campaignIds.length
    ? await db.from("campaigns").select("id, name").in("id", campaignIds)
    : { data: [] };
  const nameOf = new Map((campaigns ?? []).map((c) => [c.id, c.name]));

  // the actual messages behind every reply-split conflict, in one query
  const splits = list.filter((c) => c.kind === "reply_split");
  let messages = [];
  if (splits.length) {
    const days = [...new Set(splits.map((s) => s.conflict_date))].sort();
    const { data } = await db
      .from("replies")
      .select("id, campaign_id, lead_name, lead_email, subject, body, sentiment, classified_by, received_at")
      .eq("source", "instantly")
      .gte("received_at", `${days[0]}T00:00:00Z`)
      .lte("received_at", `${days[days.length - 1]}T23:59:59.999Z`)
      .order("received_at", { ascending: false });
    messages = data ?? [];
  }

  const meetingGaps = list.filter((c) => c.kind === "meeting_detail");

  // Two rows for one conversation. The view names the pair and nothing else —
  // deciding which to keep needs both rows in front of somebody, so fetch them.
  // A direct read, like the two others in this codebase: this is a lookup of
  // named rows, not a count, and nothing here feeds a tile.
  const dupes = list.filter((c) => c.kind === "duplicate_meeting");
  let dupeRows = [];
  if (dupes.length) {
    const ids = [...new Set(dupes.flatMap((c) => [c.subject_id, c.partner_id]).filter(Boolean))];
    const { data } = await db
      .from("meetings")
      .select("id, prospect_name, prospect_email, company, meeting_date, booked_on, status, evidence, note, origin, logged_by, campaign_id, group_id")
      .in("id", ids);
    dupeRows = data ?? [];
  }
  const meetingById = new Map(dupeRows.map((m) => [m.id, m]));

  // A reply that never trips reply_split (Instantly's count can already agree
  // with ours) and never gets classified just sits — including, once, a
  // reply that was actually a booked meeting nobody logged. v_conflicts
  // surfaces anything still unclassified after 48h; fetch the full rows.
  const needsReview = list.filter((c) => c.kind === "needs_review");
  let reviewMessages = [];
  if (needsReview.length) {
    const { data } = await db
      .from("replies")
      .select("id, campaign_id, lead_name, lead_email, company, subject, body, sentiment, received_at")
      .in("id", needsReview.map((c) => c.subject_id));
    reviewMessages = data ?? [];
  }

  return (
    <>
      <h1>Conflicts</h1>
      <p className="sub">
        Where the tools contradict themselves, or leave a gap only you can close. Nothing here is
        guessed on your behalf — confirm it and the sync will never overwrite your answer.
      </p>

      {/* A write that the database refused. It says why in a sentence; the
          person needs to read it, not a stack trace. */}
      {sp.err ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn-ink)" }}>
          <p style={{ margin: 0 }}>
            <b>That didn&rsquo;t save.</b> {sp.err}{" "}
            <a href="/conflicts">dismiss</a>
          </p>
        </div>
      ) : null}

      {!list.length ? (
        <div className="card">
          <p className="empty" style={{ padding: 0 }}>
            Nothing to settle. Every reply count reconciles and every meeting has a name.
          </p>
        </div>
      ) : null}

      {splits.map((c) => {
        const mine = messages.filter(
          (m) => m.campaign_id === c.campaign_id &&
                 (m.received_at ?? "").slice(0, 10) === c.conflict_date
        );
        return (
          <div className="card" key={`${c.campaign_id}-${c.conflict_date}`}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>{c.title}</div>
            <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
              {nameOf.get(c.campaign_id) ?? "—"} · {c.detail}
            </div>

            {mine.map((m) => (
              <div className="msg" key={m.id}>
                <div className="msg-head">
                  <div>
                    <span className="who"><PersonLink email={m.lead_email} name={m.lead_name} /></span>
                    {m.lead_name && m.lead_email ? <span className="dim"> · {m.lead_email}</span> : null}
                  </div>
                  <div className="msg-meta">
                    <span className="dim">{m.classified_by === "human" ? "you confirmed" : "read as"}</span>
                    <Pill status={m.sentiment} />
                    <span className="dim">· {prettyWhen(m.received_at)}</span>
                  </div>
                </div>

                <div className="msg-subject">{m.subject || "—"}</div>
                {m.body ? <div className="msg-body">{m.body.slice(0, 240)}</div> : null}

                <form action={classifyReply} className="choices">
                  <span className="choices-label">It is actually</span>
                  {LABELS.map(([v, label]) => (
                    <button
                      key={v}
                      name="sentiment"
                      value={v}
                      className={m.sentiment === v ? "choice on" : "choice"}
                    >
                      {label}
                    </button>
                  ))}
                  <input type="hidden" name="id" value={m.id} />
                </form>
              </div>
            ))}
            {!mine.length ? (
              <p className="empty">
                Instantly counts inbound here that the Unibox has not handed over yet.
                It usually catches up within a sync or two.
              </p>
            ) : null}
          </div>
        );
      })}

      {meetingGaps.map((c) => (
        <div className="card" key={c.subject_id}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>{c.title}</div>
          <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
            {nameOf.get(c.campaign_id) ?? "No campaign recorded"} · {c.detail}
          </div>
          <form action={recordMeetingDetail} className="gapform">
            <input type="hidden" name="id" value={c.subject_id} />
            <input name="name" placeholder="Prospect name" required />
            <input name="company" placeholder="Company" />
            <input name="email" placeholder="Email" type="email" />
            <input name="note" placeholder="Note (optional)" />
            <button className="choice on">Save</button>
          </form>
        </div>
      ))}

      {dupes.map((c) => {
        const pair = [c.subject_id, c.partner_id].map((id) => meetingById.get(id)).filter(Boolean);
        if (pair.length < 2) return null;
        return (
          <div className="card" key={`${c.subject_id}-${c.partner_id}`}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>{c.title}</div>
            <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
              {nameOf.get(c.campaign_id) ?? "No campaign recorded"} · {c.detail}
            </div>

            {pair.map((m, n) => {
              const other = pair[n === 0 ? 1 : 0];
              return (
                <div className="msg" key={m.id}>
                  <div className="msg-head">
                    <div>
                      <span className="who">
                        <PersonLink email={m.prospect_email} name={m.prospect_name} fallback="No name recorded" />
                      </span>
                      {m.prospect_email ? <span className="dim"> · {m.prospect_email}</span> : null}
                    </div>
                    <div className="msg-meta">
                      <Pill status={m.status} />
                      <span className="dim">· {prettyDate(m.meeting_date)}</span>
                    </div>
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {[
                      m.company,
                      // Where it came from is the whole basis for choosing. A
                      // call's meeting is the call's record of the conversation
                      // and merge_meetings will not drop it.
                      m.origin === "call"
                        ? "from a phone call"
                        : `typed in by ${m.logged_by || "somebody"}`,
                      m.prospect_email ? null : "no email recorded",
                      m.booked_on ? `agreed on ${prettyDate(m.booked_on)}` : null,
                      m.evidence,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  {m.note ? <div className="msg-body">{m.note}</div> : null}
                  <form action={mergeMeetings} className="choices">
                    <span className="choices-label">
                      {m.origin === "call" ? "The call's own record" : "Hand-typed"}
                    </span>
                    <input type="hidden" name="keep" value={m.id} />
                    <input type="hidden" name="drop" value={other.id} />
                    <button className="choice">Keep this one</button>
                  </form>
                </div>
              );
            })}
          </div>
        );
      })}

      {reviewMessages.map((m) => (
        <div className="card" key={m.id}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>
            {(m.lead_name || m.lead_email || "Someone")} replied and nobody has read it yet
          </div>
          <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
            {nameOf.get(m.campaign_id) ?? "—"} · Unclassified for over 48 hours. Read it, classify it —
            and if it is a booked meeting,{" "}
            <a className="drilled" href="/meetings">log it from the Meetings page</a>.
          </div>
          <div className="msg">
            <div className="msg-head">
              <div>
                <span className="who"><PersonLink email={m.lead_email} name={m.lead_name} /></span>
                {m.lead_name && m.lead_email ? <span className="dim"> · {m.lead_email}</span> : null}
              </div>
              <div className="msg-meta">
                <Pill status={m.sentiment} />
                <span className="dim">· {prettyWhen(m.received_at)}</span>
              </div>
            </div>
            <div className="msg-subject">{m.subject || "—"}</div>
            {m.body ? <div className="msg-body">{m.body.slice(0, 240)}</div> : null}
            <form action={classifyReply} className="choices">
              <span className="choices-label">It is actually</span>
              {LABELS.map(([v, label]) => (
                <button key={v} name="sentiment" value={v} className="choice">{label}</button>
              ))}
              <input type="hidden" name="id" value={m.id} />
            </form>
          </div>
        </div>
      ))}
    </>
  );
}
