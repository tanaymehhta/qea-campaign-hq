import { db, num, prettyDate, prettyWhen } from "../../lib/db";
import { Pill } from "../../components/ui";
import { classifyReply, recordMeetingDetail } from "./actions";

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
export default async function Conflicts() {
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

  return (
    <>
      <h1>Conflicts</h1>
      <p className="sub">
        Where the tools contradict themselves, or leave a gap only you can close. Nothing here is
        guessed on your behalf — confirm it and the sync will never overwrite your answer.
      </p>

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

            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>From</th>
                    <th style={{ textAlign: "left" }}>Subject</th>
                    <th>Read as</th>
                    <th>When</th>
                    <th style={{ textAlign: "left" }}>It is actually</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((m) => (
                    <tr key={m.id}>
                      <td className="name">
                        {m.lead_name || m.lead_email || "—"}
                        {m.lead_name && m.lead_email
                          ? <div className="dim" style={{ fontSize: 12 }}>{m.lead_email}</div> : null}
                      </td>
                      <td style={{ textAlign: "left", maxWidth: "34ch" }}>
                        <div style={{ fontSize: 13 }}>{m.subject || "—"}</div>
                        <div className="dim" style={{ fontSize: 12 }}>{(m.body ?? "").slice(0, 90)}</div>
                      </td>
                      <td>
                        <Pill status={m.sentiment} />
                        <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>
                          {m.classified_by === "human" ? "you confirmed" : "guessed"}
                        </div>
                      </td>
                      <td className="dim">{prettyWhen(m.received_at)}</td>
                      <td style={{ textAlign: "left" }}>
                        <form action={classifyReply} className="choices">
                          <input type="hidden" name="id" value={m.id} />
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
                        </form>
                      </td>
                    </tr>
                  ))}
                  {!mine.length ? (
                    <tr><td colSpan={5} className="empty">
                      Instantly counts inbound here that the Unibox has not handed over yet.
                      It usually catches up within a sync or two.
                    </td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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
    </>
  );
}
