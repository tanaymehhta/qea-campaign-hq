import { db, dailyRange, today, shift, num, pct, windowFrom, prettyDate, EMPTY, addInto } from "../lib/db";
import { Tile, RangePicker, DailyBars, Num, BounceCell } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function Today({ searchParams }) {
  const w = windowFrom(searchParams ?? {});
  const t = today();

  const [{ data: campaigns }, { data: groups }, rows, { data: meetings }, { data: proposals }] = await Promise.all([
    db.from("campaigns").select("id, source, name, status"),
    db.from("campaign_groups").select("id, slug, display_name, status, sort_order").order("sort_order"),
    dailyRange(w.from, w.to),
    db.from("meetings").select("id, campaign_id, meeting_date").gte("meeting_date", w.from).lte("meeting_date", w.to),
    db.from("proposals").select("id, campaign_id, sent_date").gte("sent_date", w.from).lte("sent_date", w.to),
  ]);

  const { data: members } = await db.from("campaign_group_members").select("campaign_id, group_id");
  const groupOf = new Map((members ?? []).map((m) => [m.campaign_id, m.group_id]));
  const cById = new Map((campaigns ?? []).map((c) => [c.id, c]));

  // window totals, by tool and by group
  const overall = { ...EMPTY };
  const byTool = { instantly: { ...EMPTY }, lemlist: { ...EMPTY } };
  const byGroup = new Map();
  for (const r of rows) {
    const c = cById.get(r.campaign_id);
    if (!c) continue;
    addInto(overall, r);
    if (byTool[c.source]) addInto(byTool[c.source], r);
    const gid = groupOf.get(r.campaign_id);
    if (!gid) continue;
    if (!byGroup.has(gid)) byGroup.set(gid, { ...EMPTY });
    addInto(byGroup.get(gid), r);
  }

  // last 14 days for the chart, always, regardless of the selected window
  const chartFrom = shift(t, -13);
  const chartRows = await dailyRange(chartFrom, t);
  const perDay = new Map();
  for (let i = 0; i < 14; i++) {
    const d = shift(chartFrom, i);
    perDay.set(d, { date: d, instantly: 0, lemlist: 0 });
  }
  for (const r of chartRows) {
    const c = cById.get(r.campaign_id);
    const slot = perDay.get(r.metric_date);
    if (c && slot) slot[c.source] += r.sent ?? 0;
  }

  const running = (campaigns ?? []).filter((c) => c.status === "running").length;
  const meetingCount = (meetings ?? []).length;
  const proposalCount = (proposals ?? []).length;
  const replies = overall.replied;
  const heroNote =
    w.range === "today"
      ? `${num(byTool.instantly.sent)} Instantly · ${num(byTool.lemlist.sent)} lemlist — still in progress`
      : `${num(byTool.instantly.sent)} Instantly · ${num(byTool.lemlist.sent)} lemlist`;

  return (
    <>
      <h1>{w.range === "day" ? prettyDate(w.from) : w.label}</h1>
      <p className="sub">
        Everything sent across both tools. {running} campaigns are running right now.
      </p>

      <RangePicker
        base="/"
        current={w.range}
        day={{ current: w.range === "day" ? w.from : t, prev: shift(w.range === "day" ? w.from : t, -1), next: shift(w.range === "day" ? w.from : t, 1) }}
      />

      <div className="grid g5">
        <Tile hero label="Emails sent" value={num(overall.sent)} note={heroNote} />
        <Tile
          label="New leads contacted"
          value={num(overall.new_leads_contacted)}
          tone={overall.sent > 50 && overall.new_leads_contacted === 0 ? "bad" : undefined}
          note={
            overall.sent > 50 && overall.new_leads_contacted === 0
              ? "All sends are follow-ups — no new leads entered"
              : "First touches, not follow-ups"
          }
        />
        <Tile
          label="Replies"
          value={num(replies)}
          tone={replies ? "" : "muted"}
          note={`${num(overall.replies_automatic)} out-of-office, counted separately`}
        />
        <Tile
          label="Meetings booked"
          value={num(meetingCount)}
          tone={meetingCount ? "" : "muted"}
          note="Logged by hand — no tool records this"
        />
        <Tile
          label="Proposals sent"
          value={num(proposalCount)}
          tone={proposalCount ? "" : "muted"}
          note="Logged by hand — no tool records this"
        />
      </div>

      <div className="grid g4">
        <Tile
          label="Bounced"
          value={num(overall.bounced)}
          tone={pct(overall.bounced, overall.sent) > 5 ? "bad" : undefined}
          note={overall.sent ? `${pct(overall.bounced, overall.sent)}% of sent · stop above 5%` : "—"}
        />
        <Tile label="Opened" value={num(overall.opened)} tone={overall.opened ? "" : "muted"}
              note={overall.opened ? `${pct(overall.opened, overall.sent)}% of sent` : "Tracking on; Instantly needs text-only off"} />
        <Tile label="Clicked" value={num(overall.clicked)} tone={overall.clicked ? "" : "muted"}
              note="Link tracking is off in Instantly" />
        <Tile label="LinkedIn accepts" value={num(overall.linkedin_accepted)}
              tone={overall.linkedin_accepted ? "" : "muted"} note="lemlist multichannel only" />
      </div>

      <h2>Last 14 days</h2>
      <DailyBars days={[...perDay.values()]} />

      <h2>By campaign — {w.range === "day" ? prettyDate(w.from) : w.label.toLowerCase()}</h2>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>Campaign</th><th>Status</th><th>Sent</th><th>New leads</th><th>Bounced</th>
              <th>Bounce %</th><th>Opened</th><th>Replies</th><th>LI acc.</th><th>Meetings</th><th>Proposals</th>
            </tr>
          </thead>
          <tbody>
            {(groups ?? []).map((g) => {
              const m = byGroup.get(g.id) ?? { ...EMPTY };
              const mt = (meetings ?? []).filter((x) => groupOf.get(x.campaign_id) === g.id).length;
              const pr = (proposals ?? []).filter((x) => groupOf.get(x.campaign_id) === g.id).length;
              return (
                <tr key={g.id}>
                  <td className="name"><a href={`/campaigns/${g.slug}`}>{g.display_name}</a></td>
                  <td><span className={`pill p-${g.status}`}>{g.status.replace(/_/g, " ")}</span></td>
                  <Num v={m.sent} />
                  <Num v={m.new_leads_contacted} />
                  <Num v={m.bounced} />
                  <BounceCell bounced={m.bounced} base={m.sent} />
                  <Num v={m.opened} />
                  <Num v={m.replied} />
                  <Num v={m.linkedin_accepted} />
                  <Num v={mt} />
                  <Num v={pr} />
                </tr>
              );
            })}
            <tr className="tot">
              <td>Total</td><td />
              <td>{num(overall.sent)}</td>
              <td>{num(overall.new_leads_contacted)}</td>
              <td>{num(overall.bounced)}</td>
              <td>{overall.sent ? `${pct(overall.bounced, overall.sent)}%` : "—"}</td>
              <td>{num(overall.opened)}</td>
              <td>{num(overall.replied)}</td>
              <td>{num(overall.linkedin_accepted)}</td>
              <td>{num(meetingCount)}</td>
              <td>{num(proposalCount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
