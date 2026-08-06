import {
  db, dailyRange, today, shift, num, pct, windowFrom, prettyDate,
  EMPTY, addInto, listHref, repList,
} from "../lib/db";
import { Tile, RangePicker, DailyBars, Reps, BounceCell, DrillCell } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);
  const t = today();

  const [{ data: campaigns }, { groups, reps }, rows, { data: meetings }, { data: proposals }, { data: calls }] =
    await Promise.all([
      db.from("campaigns").select("id, source, name, status"),
      repList(),
      dailyRange(w.from, w.to),
      // Meetings/proposals are hand-logged and can be booked for a future date;
      // "all time" means every one ever logged, not capped at today like send
      // activity. Only booked + held count — a cancelled meeting is not a KPI,
      // and this is the rule v_campaign_summary already applies.
      (w.range === "all"
        ? db.from("meetings").select("id, campaign_id, group_id, meeting_date").in("status", ["booked", "held"])
        : db.from("meetings").select("id, campaign_id, group_id, meeting_date").in("status", ["booked", "held"]).gte("meeting_date", w.from).lte("meeting_date", w.to)),
      (w.range === "all"
        ? db.from("proposals").select("id, campaign_id, sent_date")
        : db.from("proposals").select("id, campaign_id, sent_date").gte("sent_date", w.from).lte("sent_date", w.to)),
      // Phone calls carry no campaign_id (some, like the New York batch, happened
      // outside any campaign in this database), so unlike meetings/proposals they
      // can't be scoped to a rep — same as how /meetings already shows them unscoped.
      (w.range === "all"
        ? db.from("phone_calls").select("id, call_date").is("deleted_at", null)
        : db.from("phone_calls").select("id, call_date").is("deleted_at", null).gte("call_date", w.from).lte("call_date", w.to)),
    ]);

  const { data: members } = await db.from("campaign_group_members").select("campaign_id, group_id");
  const groupOf = new Map((members ?? []).map((m) => [m.campaign_id, m.group_id]));
  const cById = new Map((campaigns ?? []).map((c) => [c.id, c]));

  // A rep owns groups, not campaigns, so their scope is every campaign inside
  // the groups they own. "all" means no scoping at all.
  const rep = reps.some((r) => r.id === sp.rep) ? sp.rep : "all";
  const mine = reps.find((r) => r.id === rep);
  const myGroupIds = mine ? new Set(mine.groupIds) : null;
  const inScope = (campaignId) => !myGroupIds || myGroupIds.has(groupOf.get(campaignId));
  const shownGroups = myGroupIds ? groups.filter((g) => myGroupIds.has(g.id)) : groups;

  const overall = { ...EMPTY };
  const byTool = { instantly: { ...EMPTY }, lemlist: { ...EMPTY } };
  const byGroup = new Map();
  for (const r of rows) {
    const c = cById.get(r.campaign_id);
    if (!c || !inScope(r.campaign_id)) continue;
    addInto(overall, r);
    if (byTool[c.source]) addInto(byTool[c.source], r);
    const gid = groupOf.get(r.campaign_id);
    if (!gid) continue;
    if (!byGroup.has(gid)) byGroup.set(gid, { ...EMPTY });
    addInto(byGroup.get(gid), r);
  }

  // A meeting can be logged against a group with no campaign, so scope on
  // either — otherwise a rep's hand-logged meetings vanish from their own view.
  const scopedMeetings = (meetings ?? []).filter(
    (m) => !myGroupIds || myGroupIds.has(m.group_id) || myGroupIds.has(groupOf.get(m.campaign_id))
  );
  const scopedProposals = (proposals ?? []).filter((p) => inScope(p.campaign_id));

  // The chart follows the range picker exactly: Today / a picked day = one
  // bar, 7/30/90 = that many days, All time = from the first day with data.
  const SPAN = { 7: 7, 30: 30, 90: 90 };
  const chartTo = w.range === "day" ? w.from : t;
  let chartFrom =
    w.range === "today" ? t
    : w.range === "day" ? w.from
    : SPAN[w.range] ? shift(t, -(SPAN[w.range] - 1))
    : null; // all time — resolved from the data below
  const chartRows = await dailyRange(chartFrom ?? "2020-01-01", chartTo);
  if (!chartFrom) {
    const dates = chartRows.filter((r) => inScope(r.campaign_id) && r.sent).map((r) => r.metric_date);
    chartFrom = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : shift(chartTo, -6);
  }
  const perDay = new Map();
  for (let d = chartFrom; d <= chartTo; d = shift(d, 1)) {
    perDay.set(d, { date: d, instantly: 0, lemlist: 0 });
  }
  for (const r of chartRows) {
    const c = cById.get(r.campaign_id);
    const slot = perDay.get(r.metric_date);
    if (c && slot && inScope(r.campaign_id)) slot[c.source] += r.sent ?? 0;
  }

  // Sends happen on weekdays; empty Sat/Sun columns are dead width. Display
  // only — if a weekend ever does send, the columns come back on their own.
  const isWeekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const allDays = [...perDay.values()];
  const weekdaysOnly = allDays.filter((x) => !isWeekend(x.date));
  const weekendsEmpty =
    weekdaysOnly.length > 0 &&
    allDays.filter((x) => isWeekend(x.date)).every((x) => !x.instantly && !x.lemlist);
  const chartDays = weekendsEmpty ? weekdaysOnly : allDays;
  const chartLabel =
    w.range === "today" ? "Today"
    : w.range === "day" ? prettyDate(w.from)
    : SPAN[w.range] ? `Last ${SPAN[w.range]} days`
    : "All time";

  const scopedCampaigns = (campaigns ?? []).filter((c) => inScope(c.id));
  const running = scopedCampaigns.filter((c) => c.status === "running").length;
  const meetingCount = scopedMeetings.length;
  const proposalCount = scopedProposals.length;
  // Not rep-scoped — phone_calls has no campaign_id to scope by, same as /meetings.
  const callCount = (calls ?? []).length;

  // Every link carries the current window and rep through to the page behind it.
  const windowParams = w.range === "day" ? { d: w.from } : { range: w.range };
  const repParams = rep === "all" ? {} : { rep };
  const drill = (metric, extra = {}) => listHref({ metric, ...windowParams, ...repParams, ...extra });
  const here = (params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return q.toString() ? `/?${q}` : "/";
  };

  return (
    <>
      <div className="rise">
        <h1>Overview</h1>
        <p className="sub">
          {rep === "all" ? (
            <>Everything sent across Instantly and lemlist. {running} of {(campaigns ?? []).length} campaigns
              are running right now.</>
          ) : (
            <>{rep} owns {shownGroups.length} campaign group{shownGroups.length === 1 ? "" : "s"} and{" "}
              {scopedCampaigns.length} campaigns, {running} of them running right now.</>
          )}
        </p>
      </div>

      <Reps
        reps={reps}
        current={rep}
        hrefFor={(id) => here({ rep: id === "all" ? "" : id, ...windowParams })}
      />

      <RangePicker
        base={here({ rep: rep === "all" ? "" : rep })}
        current={w.range}
        day={{
          current: w.range === "day" ? w.from : t,
          prev: shift(w.range === "day" ? w.from : t, -1),
          next: shift(w.range === "day" ? w.from : t, 1),
        }}
        note={w.range === "today" ? "Today so far — sends still in progress" : `${w.label}, to ${prettyDate(t)}`}
      />

      <div className="grid g4">
        <Tile
          hero
          label="Emails sent"
          value={num(overall.sent)}
          raw={overall.sent}
          note={`${num(byTool.instantly.sent)} Instantly · ${num(byTool.lemlist.sent)} lemlist`}
          href={drill("sent")}
        />
        <Tile
          hero
          label="Leads contacted"
          value={num(overall.new_leads_contacted)}
          raw={overall.new_leads_contacted}
          tone={overall.sent > 50 && overall.new_leads_contacted === 0 ? "bad" : undefined}
          note={
            overall.sent > 50 && overall.new_leads_contacted === 0
              ? "All sends are follow-ups — no new leads entered"
              : "First touches, not follow-ups"
          }
          href={drill("contacted")}
        />
        <Tile
          hero
          label="Emails replied"
          value={num(overall.replied)}
          raw={overall.replied}
          tone={overall.replied ? undefined : "muted"}
          note={`${num(overall.replies_automatic)} out-of-office, counted separately`}
          href={drill("replied")}
        />
        <Tile
          hero
          label="Meetings booked"
          value={num(meetingCount)}
          raw={meetingCount}
          tone={meetingCount ? undefined : "muted"}
          note="The primary KPI · logged by hand"
          href={drill("meetings")}
        />
      </div>

      <div className="grid g6" style={{ marginBottom: 34 }}>
        <Tile
          label="LinkedIn sent"
          value={num(overall.linkedin_sent)}
          raw={overall.linkedin_sent}
          tone={overall.linkedin_sent ? undefined : "muted"}
          note="Connection requests — profile views not counted"
          href={drill("linkedin_sent")}
        />
        <Tile
          label="LinkedIn accepted"
          value={num(overall.linkedin_accepted)}
          raw={overall.linkedin_accepted}
          tone={overall.linkedin_accepted ? undefined : "muted"}
          note={overall.linkedin_sent ? `${pct(overall.linkedin_accepted, overall.linkedin_sent)}% of requests` : "lemlist multichannel only"}
          href={drill("linkedin_accepted")}
        />
        <Tile
          label="Bounced"
          value={num(overall.bounced)}
          raw={overall.bounced}
          tone={pct(overall.bounced, overall.sent) > 5 ? "bad" : undefined}
          note={overall.sent ? `${pct(overall.bounced, overall.sent)}% of sent · stop above 5%` : "—"}
          href={drill("bounced")}
        />
        <Tile
          label="Opened"
          value={num(overall.opened)}
          raw={overall.opened}
          tone={overall.opened ? undefined : "muted"}
          note={overall.opened ? `${pct(overall.opened, overall.sent)}% of sent` : "Two-thirds of campaigns run tracking off"}
          href={drill("opened")}
        />
        <Tile
          label="Proposals sent"
          value={num(proposalCount)}
          raw={proposalCount}
          tone={proposalCount ? undefined : "muted"}
          note="Logged by hand — no tool records this"
          href={drill("proposals")}
        />
        <Tile
          label="Calls logged"
          value={num(callCount)}
          raw={callCount}
          tone={callCount ? undefined : "muted"}
          note="Hand-logged, not scoped to a rep"
          href="/calls"
        />
      </div>

      <h2 style={{ marginTop: 0 }} id="chart">
        {chartLabel}{weekendsEmpty ? " — weekdays" : ""}
      </h2>
      {/* Same picker as the one at the top, same URL param — either one moves
          both. The anchor lands the reload back here instead of at the top. */}
      <RangePicker
        base={here({ rep: rep === "all" ? "" : rep })}
        current={w.range}
        anchor="chart"
        note={weekendsEmpty ? "empty weekends hidden" : null}
      />
      <DailyBars days={chartDays} />

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
            {shownGroups.map((g) => {
              const m = byGroup.get(g.id) ?? { ...EMPTY };
              const mt = scopedMeetings.filter(
                (x) => x.group_id === g.id || groupOf.get(x.campaign_id) === g.id
              ).length;
              const pr = scopedProposals.filter((x) => groupOf.get(x.campaign_id) === g.id).length;
              const status = g.status ?? "unknown";
              return (
                <tr key={g.id}>
                  <td className="name"><a className="drilled" href={`/campaigns/${g.slug}`}>{g.display_name}</a></td>
                  <td><span className={`pill p-${status}`}>{status.replace(/_/g, " ")}</span></td>
                  <DrillCell v={m.sent} href={drill("sent", { group: g.slug })} />
                  <DrillCell v={m.new_leads_contacted} href={drill("contacted", { group: g.slug })} />
                  <DrillCell v={m.bounced} href={drill("bounced", { group: g.slug })} />
                  <BounceCell bounced={m.bounced} base={m.sent} />
                  <DrillCell v={m.opened} href={drill("opened", { group: g.slug })} />
                  <DrillCell v={m.replied} href={drill("replied", { group: g.slug })} />
                  <DrillCell v={m.linkedin_accepted} href={drill("linkedin_accepted", { group: g.slug })} />
                  <DrillCell v={mt} href={drill("meetings", { group: g.slug })} />
                  <DrillCell v={pr} href={drill("proposals", { group: g.slug })} />
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
