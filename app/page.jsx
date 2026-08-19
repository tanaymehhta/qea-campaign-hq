import {
  db, dailyRange, mailboxRange, today, shift, num, pct, windowFrom, prettyDate,
  EMPTY, addInto, listHref, repList,
} from "../lib/db";
import { Tile, RangePicker, DailyBars, Reps, BounceCell, DrillCell } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);
  const t = today();

  const [{ data: campaigns }, { groups, reps }, rows, mailbox, { data: meetings }, { data: proposals }, { data: calls }, { data: replies }] =
    await Promise.all([
      // sender_emails is the edge that makes Instantly bounce placeable — see the
      // bounce section below. It is a text[] on the campaign, written by the sync.
      db.from("campaigns").select("id, source, name, status, sender_emails"),
      repList(),
      dailyRange(w.from, w.to),
      mailboxRange(w.from, w.to),
      // Meetings/proposals are hand-logged and can be booked for a future date;
      // "all time" means every one ever logged, not capped at today like send
      // activity. Only booked + held count — a cancelled meeting is not a KPI,
      // and this is the rule v_campaign_summary already applies.
      (w.range === "all"
        ? db.from("meetings").select("id, campaign_id, group_id, meeting_date, logged_by").in("status", ["booked", "held"])
        : db.from("meetings").select("id, campaign_id, group_id, meeting_date, logged_by").in("status", ["booked", "held"]).gte("meeting_date", w.from).lte("meeting_date", w.to)),
      (w.range === "all"
        ? db.from("proposals").select("id, campaign_id, sent_date")
        : db.from("proposals").select("id, campaign_id, sent_date").gte("sent_date", w.from).lte("sent_date", w.to)),
      // Phone calls carry no campaign_id (some, like the New York batch, happened
      // outside any campaign in this database), so unlike meetings/proposals they
      // can't be scoped to a rep — same as how /meetings already shows them unscoped.
      (w.range === "all"
        ? db.from("phone_calls").select("id, call_date").is("deleted_at", null)
        : db.from("phone_calls").select("id, call_date").is("deleted_at", null).gte("call_date", w.from).lte("call_date", w.to)),
      // Every inbound message in the window, for the response rate below. Read
      // from `replies` rather than v_daily_facts.replied because that column is
      // a per-day count with no person and no label on it — it can neither
      // collapse two messages from one human nor drop the ones who said no.
      db.from("replies")
        .select("campaign_id, lead_email, sentiment, source")
        .gte("received_at", `${w.from}T00:00:00Z`)
        .lte("received_at", `${w.to}T23:59:59.999Z`),
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
  // A call-created meeting has neither, because the calls workspace is tied to
  // no campaign, so it also answers to whoever logged it. Without that last
  // clause a rep's totals can never sum to the all-reps total.
  const scopedMeetings = (meetings ?? []).filter(
    (m) => !myGroupIds || myGroupIds.has(m.group_id) || myGroupIds.has(groupOf.get(m.campaign_id))
      || (!m.group_id && !m.campaign_id && m.logged_by === rep)
  );
  const scopedProposals = (proposals ?? []).filter((p) => inScope(p.campaign_id));

  // ---------------------------------------------------------------- response
  //
  // How many humans wrote back and meant it.
  //
  // Three things are deliberately not counted. A robot is not a response, so
  // `auto_reply` is out — the out-of-office, the maternity leave, the one who
  // retired in October. Someone declining is not a response either, so
  // `not_interested` is out. And a person is counted once however many times
  // they wrote, which is why this dedupes on the address rather than adding up
  // rows: the 41 real messages on file today come from 35 people.
  //
  // Everything else counts, including a forward — when a prospect passes the
  // mail to a colleague with "please address this", that is the strongest
  // signal in the set, and it is a response even though it was not addressed
  // to us.
  //
  // The bar is a reply worth having, not a meeting. "Tell me more", "not right
  // now", "talk to my colleague" — all responses.
  // Instantly only, and that is a correctness rule rather than a preference.
  // lemlist never reported `new_leads_contacted` — 0 across all 234 of its
  // campaign-days, measured 19 Aug 2026 — so not one of its people is inside
  // the "people reached" this divides by. Counting its repliers on top would
  // put 35 people over an Instantly-only 1,839 and overstate the rate 2.7x.
  // lemlist is being retired; /replies still lists every message from both, and
  // if a vendor ever does start reporting people reached, this line is what
  // changes.
  const scopedReplies = (replies ?? [])
    .filter((r) => inScope(r.campaign_id) && r.source === "instantly");
  const DEAD = new Set(["auto_reply", "not_interested"]);
  const responders = new Set(
    scopedReplies.filter((r) => !DEAD.has(r.sentiment) && r.lead_email)
      .map((r) => r.lead_email.toLowerCase())
  ).size;
  // Which of those people are only in the count because nobody has read them
  // yet — not how many unread replies there are.
  //
  // The two are not the same, and counting messages overstated the doubt. Every
  // unread reply on file today is a fragment of Bharat Mudgal's thread, and his
  // 28 Jul message is already `interested`, so he is counted whatever those two
  // turn out to say. The tile was warning of a ceiling that could not fall.
  //
  // A person is at risk only when every reply they sent is unread. One
  // `interested` anywhere settles them; one `not_interested` removes them.
  const settled = new Set(
    scopedReplies.filter((r) => !DEAD.has(r.sentiment) && r.sentiment !== "unclassified" && r.lead_email)
      .map((r) => r.lead_email.toLowerCase())
  );
  const unread = new Set(
    scopedReplies.filter((r) => r.sentiment === "unclassified" && r.lead_email)
      .map((r) => r.lead_email.toLowerCase())
      .filter((e) => !settled.has(e))
  ).size;
  const responseRate = pct(responders, overall.new_leads_contacted);

  // ------------------------------------------------------------------ bounce
  //
  // Instantly bounce is dated but not campaign-shaped, and it is placed here
  // rather than left company-wide.
  //
  // What the vendor gives up, exactly: `campaigns/analytics/daily` has no bounce
  // field, `campaigns/analytics` has one but only lifetime, and
  // `accounts/analytics/daily` — email_account_daily — has a dated one keyed on
  // the mailbox with no campaign on it. So the dated number exists and cannot be
  // read at campaign grain from the vendor alone.
  //
  // The missing edge is ours: `campaigns.sender_emails` says which mailboxes a
  // campaign sends from. Following it to the campaign is still wrong — one box
  // serves ten Chicago Retrofit sub-campaigns and a bounce on it cannot be split
  // between them. Following it one level up, to the **group**, is exact: a
  // mailbox belongs to one group. Measured 19 Aug 2026: 0 of 23 Instantly
  // mailboxes reach more than one group, and rolling the result to group matches
  // the vendor's own lifetime endpoint on all three — 48 / 12 / 12.
  //
  // The rule is asked of the data every render, not assumed. A mailbox that ever
  // does reach two groups, or a campaign in no group, resolves to null and is
  // counted only company-wide, where it is still true.
  const boxGroup = new Map();
  for (const c of campaigns ?? []) {
    if (c.source !== "instantly") continue;
    const gid = groupOf.get(c.id) ?? null;
    for (const e of c.sender_emails ?? []) {
      if (!boxGroup.has(e)) boxGroup.set(e, gid);
      else if (boxGroup.get(e) !== gid) boxGroup.set(e, null); // ambiguous — refuse
    }
  }

  const instByGroup = new Map();
  let instUnplaceable = 0;
  const mailboxDates = new Set();
  for (const r of mailbox) {
    mailboxDates.add(r.metric_date);
    if (r.bounced == null) continue;
    const gid = boxGroup.get(r.email) ?? null;
    if (gid) instByGroup.set(gid, (instByGroup.get(gid) ?? 0) + r.bounced);
    else instUnplaceable += r.bounced;
  }

  // A date whose mailbox pull has not landed yet. email_account_daily is written
  // by the 03:00 nightly, not the 30-minute sync, so a day that sends before
  // then has sends and no bounce figure. The total is a floor with a date on it
  // and the tile says the date out loud rather than reading as a clean zero —
  // which is the whole fault this section exists to end.
  const instDays = new Set(
    rows.filter((r) => r.campaign_id && r.sent && inScope(r.campaign_id)
      && cById.get(r.campaign_id)?.source === "instantly").map((r) => r.metric_date)
  );
  const covered = [...instDays].filter((d) => mailboxDates.has(d)).sort();
  const bounceThrough = covered.length ? covered[covered.length - 1] : null;
  const bounceIsPartial = covered.length < instDays.size;

  const scopeHasInstantly = (campaigns ?? []).some((c) => c.source === "instantly" && inScope(c.id));
  // Nothing known yet: Instantly sent in this window and not one of those days
  // has a mailbox row. A 0 here would be the original lie, so it is an em dash.
  const bounceUnknown = scopeHasInstantly && instDays.size > 0 && covered.length === 0;

  const scopedInstBounce = [...instByGroup].reduce(
    (a, [gid, v]) => a + (!myGroupIds || myGroupIds.has(gid) ? v : 0), 0
  );
  const overallBounced =
    bounceUnknown ? null
    // An unplaceable mailbox is still inside the company total, and only there.
    : overall.bounced + scopedInstBounce + (rep === "all" ? instUnplaceable : 0);

  // Same question per group. Grouping is derived from the campaign name, so a
  // group is not permanently one vendor — this is asked of the data, not assumed.
  const groupsWithInstantly = new Set(
    (campaigns ?? [])
      .filter((c) => c.source === "instantly" && groupOf.get(c.id))
      .map((c) => groupOf.get(c.id))
  );

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
          label="Active campaigns"
          value={num(running)}
          raw={running}
          note={`${running} of ${num(scopedCampaigns.length)} in this view`}
          href="/campaigns"
        />
        <Tile
          hero
          label="People reached"
          value={num(overall.new_leads_contacted)}
          raw={overall.new_leads_contacted}
          tone={overall.sent > 50 && overall.new_leads_contacted === 0 ? "bad" : undefined}
          note={
            overall.sent > 50 && overall.new_leads_contacted === 0
              ? "All sends are follow-ups — no new people entered"
              : "First touches, not follow-ups"
          }
          href={drill("contacted")}
        />
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
          label="Emails bounced"
          value={overallBounced == null ? "—" : num(overallBounced)}
          raw={overallBounced ?? undefined}
          tone={
            overallBounced == null ? "muted"
            : pct(overallBounced, overall.sent) > 5 ? "bad"
            : undefined
          }
          note={
            overallBounced == null
              ? "Not counted for this window yet — mailbox figures land on the 03:00 run"
              : !overall.sent ? "—"
              : bounceIsPartial
                ? `${pct(overallBounced, overall.sent)}% of sent · Instantly counted to ${prettyDate(bounceThrough)}`
                : rep !== "all" && instUnplaceable
                  ? `${pct(overallBounced, overall.sent)}% of sent · a floor, some mailboxes serve two groups`
                  : `${pct(overallBounced, overall.sent)}% of sent · stop above 5%`
          }
          href={overallBounced == null ? undefined : drill("bounced")}
        />
      </div>

      <div className="grid g4" style={{ marginBottom: 34 }}>
        <Tile
          label="People who replied"
          // No Instantly sending in this scope means no denominator and no
          // repliers either — a 0 would read as "nobody wrote back", which is a
          // different sentence from "this rate does not describe these
          // campaigns". lemlist-only reps land here.
          value={overall.new_leads_contacted ? num(responders) : "—"}
          raw={overall.new_leads_contacted ? responders : undefined}
          tone={overall.new_leads_contacted && responders ? undefined : "muted"}
          note={
            !overall.new_leads_contacted
              ? "No rate here — lemlist never reported people reached"
            : unread
              ? `${responseRate}% of people reached · ${num(unread)} unread — a ceiling until they are labelled`
              : `${responseRate}% of people reached · every reply read`
          }
          href={unread ? "/replies?tag=unclassified" : "/replies"}
        />
        <Tile
          label="Emails opened"
          value={num(overall.opened)}
          raw={overall.opened}
          tone={overall.opened ? undefined : "muted"}
          note={overall.opened ? `${pct(overall.opened, overall.sent)}% of sent` : "Two-thirds of campaigns run tracking off"}
          href={drill("opened")}
        />
        <Tile
          label="Calls logged"
          value={num(callCount)}
          raw={callCount}
          tone={callCount ? undefined : "muted"}
          note="Hand-logged, not scoped to a rep"
          href="/calls"
        />
        <Tile
          label="Meetings booked"
          value={num(meetingCount)}
          raw={meetingCount}
          tone={meetingCount ? undefined : "muted"}
          note="The primary KPI · logged by hand"
          href={drill("meetings")}
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
      <div className="card tw banded">
        <table>
          <thead>
            {/* Three bands over the ten columns: how much went out, how much
                of it landed, what came back. colSpans must total 10. */}
            <tr className="band">
              <th colSpan={2} />
              <th colSpan={2}>Volume</th>
              <th colSpan={2}>Deliverability</th>
              <th colSpan={4}>Engagement &amp; outcomes</th>
            </tr>
            <tr>
              <th>Campaign</th><th>Status</th><th>Sent</th>
              <th title="First time we emailed this person — not a follow-up">First touches</th>
              <th>Bounced</th>
              <th>Bounce %</th><th>Opened</th><th>Replies</th>
              <th>Meetings</th><th>Proposals</th>
            </tr>
          </thead>
          <tbody>
            {shownGroups.map((g) => {
              const m = byGroup.get(g.id) ?? { ...EMPTY };
              const mt = scopedMeetings.filter(
                (x) => x.group_id === g.id || groupOf.get(x.campaign_id) === g.id
              ).length;
              const pr = scopedProposals.filter((x) => groupOf.get(x.campaign_id) === g.id).length;
              // Derived, never typed. `g.status` is the intent someone recorded
              // once; `actual_status` is what the campaigns inside are doing.
              const status = g.actual_status ?? "unknown";
              // `m.bounced` holds only the lemlist side — v_daily_facts makes an
              // Instantly campaign-day NULL and addInto skips it. The Instantly
              // side arrives from the mailboxes this group owns. Null only while
              // nothing has been pulled yet, which is the one state where a
              // number here would be invented.
              const gBounced =
                bounceUnknown && groupsWithInstantly.has(g.id)
                  ? null
                  : m.bounced + (instByGroup.get(g.id) ?? 0);
              return (
                <tr key={g.id}>
                  <td className="name"><a className="drilled" href={`/campaigns/${g.slug}`}>{g.display_name}</a></td>
                  <td><span className={`pill p-${status}`}>{status.replace(/_/g, " ")}</span></td>
                  <DrillCell v={m.sent} href={drill("sent", { group: g.slug })} />
                  <DrillCell v={m.new_leads_contacted} href={drill("contacted", { group: g.slug })} />
                  <DrillCell v={gBounced} href={drill("bounced", { group: g.slug })} />
                  <BounceCell bounced={gBounced} base={m.sent} />
                  <DrillCell v={m.opened} href={drill("opened", { group: g.slug })} />
                  <DrillCell v={m.replied} href={drill("replied", { group: g.slug })} />
                  <DrillCell v={mt} href={drill("meetings", { group: g.slug })} />
                  <DrillCell v={pr} href={drill("proposals", { group: g.slug })} />
                </tr>
              );
            })}
            <tr className="tot">
              <td>Total</td><td />
              <td>{num(overall.sent)}</td>
              <td>{num(overall.new_leads_contacted)}</td>
              <td>{overallBounced == null ? "—" : num(overallBounced)}</td>
              <td>{overallBounced != null && overall.sent ? `${pct(overallBounced, overall.sent)}%` : "—"}</td>
              <td>{num(overall.opened)}</td>
              <td>{num(overall.replied)}</td>
              <td>{num(meetingCount)}</td>
              <td>{num(proposalCount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
