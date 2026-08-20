import {
  db, dailyRange, mailboxRange, today, shift, num, pct, windowFrom, prettyDate, prettyWhen,
  EMPTY, addInto, listHref, repList, responseCounts, reachedCounts,
  meetingCounts, meetingArgs, everyRow,
} from "../lib/db";
import { Tile, RangePicker, DailyBars, Reps, BounceCell, DrillCell } from "../components/ui";

// A dial needs its person and its day; the campaign behind the contact is the
// second of the two doors a call can be a rep's through.
const CALL_COLS = "id, call_date, contact_id, prospect_name, rep, call_contacts(call_campaign_id)";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);
  const t = today();

  const [{ data: campaigns }, { groups, reps }, rows, mailbox, { data: proposals }, { data: calls }, { data: callCamps }] =
    await Promise.all([
      // sender_emails is the edge that makes Instantly bounce placeable — see the
      // bounce section below. It is a text[] on the campaign, written by the sync.
      db.from("campaigns").select("id, source, name, status, sender_emails, open_tracking, last_synced"),
      repList(),
      dailyRange(w.from, w.to),
      mailboxRange(w.from, w.to),
      // Meetings moved to `meeting_rows` below — they need the rep's scope,
      // which is not resolved until after the campaigns come back.
      // Proposals are hand-logged and can be dated in the future; "all time"
      // means every one ever logged, not capped at today like send activity.
      (w.range === "all"
        ? db.from("proposals").select("id, campaign_id, sent_date")
        : db.from("proposals").select("id, campaign_id, sent_date").gte("sent_date", w.from).lte("sent_date", w.to)),
      // A phone call has no campaign_id — it answers to the rep who made it or
      // to the owner of the list it came from, which is exactly the pair of
      // doors `meeting_rows` and `reached_people` already scope by. The contact
      // is embedded to reach the second door; `contact_id`/`prospect_name` and
      // `call_date` are what makes a dial a dial rather than an outcome row.
      (w.range === "all"
        ? db.from("phone_calls").select(CALL_COLS).is("deleted_at", null)
        : db.from("phone_calls").select(CALL_COLS).is("deleted_at", null).gte("call_date", w.from).lte("call_date", w.to)),
      db.from("call_campaigns").select("id, owner"),
    ]);

  const { data: members } = await db.from("campaign_group_members").select("campaign_id, group_id");
  const groupOf = new Map((members ?? []).map((m) => [m.campaign_id, m.group_id]));
  const cById = new Map((campaigns ?? []).map((c) => [c.id, c]));
  // The second door a phone call can be a rep's through: the owner of the call
  // list the contact sits on, for a call logged without a rep on it.
  const callCampOwner = new Map((callCamps ?? []).map((c) => [c.id, c.owner?.trim() || null]));

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

  const scopedProposals = (proposals ?? []).filter((p) => inScope(p.campaign_id));

  // ---------------------------------------------------------------- response
  //
  // Who wrote back, and who said yes.
  //
  // This used to be forty lines of JavaScript: pull every reply in the window,
  // drop `auto_reply` and `not_interested`, unique the addresses, count the
  // set. It was right, and it was unreachable — `/replies` could not call a
  // filter that lived inside this render, so it listed something else, and the
  // tile said 3 while the click opened 193 rows.
  //
  // The rule is `response_counts` now (migration 20260820120000), and
  // `/replies` asks the same function for the same people. That is the whole
  // point: not that the number got better, but that there is only one of it.
  //
  // Two changes of meaning arrive with it, both decided in TRUST_OPEN.md §5:
  //
  //   A refusal is a response.  `not_interested` used to be subtracted, which
  //   made the tile "people who might buy" while calling itself "people who
  //   replied". Somebody who writes back to say no has answered. They belong in
  //   Total and nowhere near Interested — which is why this is two tiles.
  //
  //   Unclassified is homework, not a KPI.  A person nobody has read yet counts
  //   in neither tile. They surface as "N need a label" under Total, and
  //   labelling them on /replies is what moves them into it.
  //
  // Instantly only, and that is a correctness rule rather than a preference.
  // lemlist never reported `new_leads_contacted` — 0 across all 234 of its
  // campaign-days, measured 19 Aug 2026 — so not one of its people is inside
  // the "people reached" this divides by. Counting its repliers on top would
  // put 35 people over an Instantly-only 1,839 and overstate the rate 2.7x.
  // lemlist is being retired; /replies still lists every message from both
  // behind its "All inbound" pile, and if a vendor ever does start reporting
  // people reached, the `source` argument below is what changes.
  //
  // A rep owns groups, not campaigns, so their scope is resolved to campaign
  // ids here — the same `inScope` rule every other tile on this page uses,
  // handed to Postgres instead of applied to rows after the fact.
  const scopedIds = myGroupIds
    ? (campaigns ?? []).filter((c) => myGroupIds.has(groupOf.get(c.id))).map((c) => c.id)
    : null;
  const scope = {
    // All time asks for no window at all rather than for 2020-01-01.
    from: w.range === "all" ? null : w.from,
    to: w.range === "all" ? null : w.to,
    campaignIds: scopedIds,
    // Both vendors. This was Instantly-only until 20 Aug 2026, because the
    // Interested tile divided by `new_leads_contacted` and lemlist has never
    // written that column — a lemlist person in the numerator would have been
    // divided by a denominator they are not inside.
    //
    // That objection is about a *rate*. Total responses is a **count**, and a
    // count has no denominator to be wrong about. Once the lemlist inbox was
    // read and labelled (20260820160000), keeping 22 humans off the tile
    // because of an arithmetic problem the tile does not have would have been
    // the same fault in the other direction: deleting a true number to avoid
    // explaining it. So the count is both vendors, and the rate below changed
    // its denominator instead.
    source: null,
    // Only the reached pile reads this (see reachedArgs). A person we have only
    // phoned has no campaign to be scoped by, so without their rep's name they
    // would land in the all-reps total and in nobody's own view.
    rep,
  };

  // Meetings arrive through three doors — an email campaign, a rep's group, or
  // a phone call — and until 20 Aug this page, /list and /meetings each decided
  // whose a meeting was in their own way. /?rep=Mark Vasu said 5 and the tile's
  // own href opened 4: a call-booked meeting has no campaign and no group, and
  // /list could not see it. `meeting_rows` is now the only answer, and the
  // number below is `meeting_counts` over the identical arguments — the same
  // construction that keeps the reached and response tiles honest.
  //
  // The window means *booked in this window* now (`booked_on`), not *the
  // meeting falls in this window*. A meeting agreed today for 3 September is a
  // win today. Rows logged before the column existed have no booked_on and
  // fall back to their meeting date, so nothing already on the board moves.
  const meetingScope = {
    from: scope.from, to: scope.to,
    campaignIds: scopedIds,
    groupIds: mine?.groupIds ?? null,
    rep,
  };
  const [pile, meetingPile, scopedMeetings] = await Promise.all([
    responseCounts(scope),
    meetingCounts(meetingScope),
    // Paged: the group table below counts these rows itself, and PostgREST
    // stops at 1,000 with no error — the tile would go on reading the true
    // number while the rows beneath it quietly stopped summing to it.
    everyRow(() => db.rpc("meeting_rows", meetingArgs(meetingScope)).order("id")),
  ]);
  // Total responses is exactly two things and nothing else: the people who said
  // yes and the people who said no. Robots are not a response and unread mail is
  // not an answer, so both sit outside this pair. That is what lets the tile
  // print its own breakdown — the parts are guaranteed to sum.
  const notInterested =
    pile.responded == null || pile.interested == null ? null : pile.responded - pile.interested;
  // Interested over everyone who replied — one pile on both sides of the line.
  // It used to be "% of people reached", which cannot survive lemlist: that
  // denominator is Instantly-only and always will be. This one is true whatever
  // mix of vendors is in scope, which is the whole reason for the swap.
  const interestedRate =
    pile.interested == null || !pile.responded ? null : pct(pile.interested, pile.responded);

  // ----------------------------------------------------------------- reached
  //
  // The front of the same funnel, and until today the same fault one tile over.
  //
  // This tile read `overall.new_leads_contacted` — the daily notebook — while
  // its own href opened `/list?metric=contacted`, which reads `people`. The
  // notebook is Instantly-only, because lemlist never wrote that column; the
  // people table has both vendors. So the tile said 1,839 and the click opened
  // 2,393, and the 554 in between were every lemlist human we have ever
  // emailed. Measured 20 Aug by scraping the tile and following its own link.
  //
  // "lemlist never reported people reached" is written in every document here
  // and it is only half true: not in the notebook, yes in the per-person table,
  // where its dates were rebuilt from the activity stream. Nobody had drawn the
  // distinction, so the number stayed one vendor short of the responses it
  // sits next to.
  //
  // `reached_counts` is a wrapper over `reached_people`, which is what the list
  // behind this tile now calls. Same scope object as the response pile above,
  // so both ends of the funnel are windowed, scoped and vendored identically.
  const reached = await reachedCounts(scope);
  // The same question per group, asked of the same function. A column that
  // summed a different definition from the tile above it is exactly how a page
  // ends up disagreeing with itself.
  // The whole counts row per group, not just `people`: the First touches column
  // and the Opened column beside it are two `count(*) filter`s over one set of
  // rows, so a group cannot be reached-by-one-definition and opened-by-another.
  const reachedByGroup = new Map(
    await Promise.all(
      shownGroups.map(async (g) => [
        g.id,
        await reachedCounts({
          ...scope,
          campaignIds: (campaigns ?? []).filter((c) => groupOf.get(c.id) === g.id).map((c) => c.id),
          // Deliberately dropped here. A group is a set of email campaigns; a
          // phoned person is in none of them, and leaving the rep in would add
          // the same 11 people to every one of that rep's group rows.
          rep: null,
        }),
      ])
    )
  );

  // ------------------------------------------------------------------ opened
  //
  // Three numbers were being called "opened" and the tile picked the one that
  // was neither of the other two. Measured 20 Aug, all time:
  //
  //   225  `unique_opened` from the notebook, Instantly only, unique per
  //        campaign-DAY. What this tile used to print.
  //   123  Instantly people who have ever opened. Instantly's own two records
  //        disagree with each other by 102.
  //   228  lemlist people who have ever opened, and lemlist writes no
  //        `unique_opened` at all — so the tile could not see one of them,
  //        exactly as it could not see its 554 reached people this morning.
  //
  // The click had always opened all 351 of them. Q4 in TRUST_OPEN.md.
  //
  // The denominator was worse than the numerator: 3,574 tracked *sends*, which
  // is messages under a numerator trying to be people, one vendor under two.
  // It is now the people whose mail could register an open at all — 1,491 of
  // the 2,393 we reached. The other 902 are in campaigns with no pixel; they
  // did not decline to open, nothing was watching, and padding the bottom of a
  // fraction with them is what made 23.5% read as 6.3%.
  //
  // The cost, and it is real: a window now selects on the date we reached the
  // person, not the date they opened, because neither tool dates an open per
  // person. Migration 20260820210000 has the full argument.
  const openRate = reached.opened == null || !reached.trackable ? null : pct(reached.opened, reached.trackable);
  const blindReached =
    reached.people == null || reached.trackable == null ? null : reached.people - reached.trackable;

  // The same rule per group — `reachedByGroup` above already carries both
  // halves. A group with nothing trackable renders `—` rather than 0: it did
  // not fail to be opened, it is unobservable. That is Q1 in TRUST_OPEN.md,
  // closed here for this column by counting people instead of notebook rows.
  const groupOpens = (gid) => {
    const c = reachedByGroup.get(gid);
    return !c || !c.trackable ? null : c.opened;
  };

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

  // A campaign, to everyone who reads this page, is a group — the thing the
  // table below lists and the thing a rep says they own. The 35 rows underneath
  // are vendor sequences: ten of them make up "Chicago Retrofit" alone. Counting
  // those made the tile say 6 of 35 next to a table showing 5 campaigns, 3 live.
  //
  // `actual_status` is the same word the table's badge prints, derived in
  // v_group_summary from two signals that must agree — a sequence the vendor
  // still calls running AND a send in the last 14 days. That is what kills the
  // lemlist rows claiming `running` since June: the group they sit in went
  // `ended` without anyone having to notice them.
  const live = shownGroups.filter((g) => g.actual_status === "live").length;
  // "Running right now" is only ever as true as the last sync. One job writes
  // every campaign row in a pass, so the newest `last_synced` is the moment the
  // whole table was checked — and without it printed, a correct 0 and a 0 from
  // a sync that died on Tuesday look exactly alike.
  const syncedAt = (campaigns ?? []).reduce((a, c) => (c.last_synced > a ? c.last_synced : a), "");
  const meetingCount = meetingPile.meetings;
  const proposalCount = scopedProposals.length;
  // One row per call since 20 Aug: the form posts one outcome, so pressing Add
  // is what this counts. It used to be one row per ticked checkbox and read 16
  // for 11 calls.
  //
  // Scoped to the rep who dialled, or to the owner of the call list the contact
  // sits on — `meeting_rows`'s two doors, in the same order. The three July
  // rows carry neither and so belong to nobody: they are in the all-reps total
  // and in no rep's view, which /calls/orphans exists to end.
  const callOwnerOf = (c) =>
    c.rep ?? callCampOwner.get(c.call_contacts?.call_campaign_id) ?? null;
  const scopedCalls = rep === "all" ? (calls ?? []) : (calls ?? []).filter((c) => callOwnerOf(c) === rep);
  const callCount = scopedCalls.length;
  const orphanCalls = (calls ?? []).filter((c) => !c.contact_id).length;
  const bounceRate = overallBounced == null || !overall.sent ? null : pct(overallBounced, overall.sent);

  // Every link carries the current window and rep through to the page behind it.
  const windowParams = w.range === "day" ? { d: w.from } : { range: w.range };
  const repParams = rep === "all" ? {} : { rep };
  const drill = (metric, extra = {}) => listHref({ metric, ...windowParams, ...repParams, ...extra });
  // The same window and rep the tile counted, handed to the page behind it. If
  // this ever stops matching `scope` above, the number and the list are two
  // piles again — which is the bug this whole change exists to end.
  const pileHref = (view) =>
    `/replies?${new URLSearchParams({ view, ...windowParams, ...repParams })}`;
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
            <>Everything sent across Instantly and lemlist. {live} of {shownGroups.length} campaigns
              are live as of {prettyWhen(syncedAt)}.</>
          ) : (
            <>{rep} owns {shownGroups.length} campaign{shownGroups.length === 1 ? "" : "s"},{" "}
              {live} live as of {prettyWhen(syncedAt)}.</>
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
          value={num(live)}
          raw={live}
          note={`${live} of ${num(shownGroups.length)} in this view`}
          href="/campaigns"
        />
        <Tile
          hero
          label="People reached"
          value={num(reached.people)}
          raw={reached.people ?? undefined}
          tone={overall.sent > 50 && reached.people === 0 ? "bad" : undefined}
          note={
            overall.sent > 50 && reached.people === 0
              ? "All sends are follow-ups — no new people entered"
              /* Says which channels are inside it. Phoned people joined this
                 pile on 20 Aug (Tanay: whatever the outcome — a voicemail is a
                 reach), and a tile that grew by a channel without saying so is
                 how "1,839" and "2,393" came to be two answers to one question.
                 The calls part is only printed when there is one. */
              : `First touches — ${num(reached.instantly)} Instantly · ${num(reached.lemlist)} lemlist${
                  reached.calls ? ` · ${num(reached.calls)} phoned` : ""
                }`
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
          label="People who opened"
          // Rate first, then the count. Both halves are headcounts of the same
          // people — those who opened, over those whose mail could register an
          // open — so this is the one shape a rate is allowed to have here. Do
          // not pass `raw`: the count-up tween would replace "23.5% / 351" with
          // an integer.
          value={
            openRate == null ? "—" : <>{openRate}%<span className="pair"> / {num(reached.opened)}</span></>
          }
          tone={reached.trackable && reached.opened ? undefined : "muted"}
          note={
            !reached.trackable
              ? "No campaign here can register an open"
              : [
                  `${num(reached.opened)} of ${num(reached.trackable)} who could register one`,
                  blindReached ? `${num(blindReached)} reached with no pixel` : null,
                ].filter(Boolean).join(" · ")
          }
          href={reached.trackable ? drill("opened") : undefined}
        />
      </div>

      <div className="grid g5" style={{ marginBottom: 34 }}>
        <Tile
          label="Total responses"
          // A count, so there is no denominator to be missing and no scope this
          // cannot describe. The only em dash left is a failed read — `pile`
          // comes back all-null on error rather than all-zero, because "nobody
          // wrote back" and "the question never reached the database" are
          // different sentences and only one of them is ever true here.
          value={num(pile.responded)}
          raw={pile.responded ?? undefined}
          tone={pile.responded ? undefined : "muted"}
          // The split, on the face of the tile. You should not have to click to
          // learn whether 31 responses were good news.
          note={
            pile.responded == null
              ? "Could not be counted just now"
              : [
                  pile.responded
                    ? `${num(pile.interested)} interested · ${num(notInterested)} not interested`
                    : "Nobody has written back in this view",
                  pile.needs_label ? `${num(pile.needs_label)} still to read` : null,
                ].filter(Boolean).join(" · ")
          }
          href={pileHref("responded")}
        />
        <Tile
          label="Interested"
          // One percent, and both sides of it are the same pile: people who said
          // yes, over people who answered at all. Nothing here divides one
          // vendor's numerator by another's denominator, which is the fault
          // TRUST_OPEN.md §1 says every broken rate on this dashboard shared.
          value={
            pile.interested == null ? "—"
              : interestedRate == null ? num(pile.interested)
              : <>{num(pile.interested)}<span className="pair"> / {interestedRate}%</span></>
          }
          raw={interestedRate == null ? pile.interested ?? undefined : undefined}
          tone={pile.interested ? undefined : "muted"}
          note={
            pile.interested == null ? "Could not be counted just now"
              : interestedRate == null ? "Nobody has written back in this view"
              : `${num(pile.interested)} of the ${num(pile.responded)} who replied`
          }
          href={pileHref("interested")}
        />
        <Tile
          label="Bounce rate"
          // Percent is the figure; the count lives in the note. Same `raw`
          // omission as opened — a tween to "2" would look like two bounces.
          value={bounceRate == null ? "—" : `${bounceRate}%`}
          tone={
            bounceRate == null ? "muted"
            : bounceRate > 5 ? "bad"
            : undefined
          }
          note={
            overallBounced == null
              ? "Not counted for this window yet — mailbox figures land on the 03:00 run"
              : !overall.sent ? "—"
              : bounceIsPartial
                ? `${num(overallBounced)} of ${num(overall.sent)} sent · Instantly counted to ${prettyDate(bounceThrough)}`
                : rep !== "all" && instUnplaceable
                  ? `${num(overallBounced)} of ${num(overall.sent)} sent · a floor, some mailboxes serve two groups`
                  : `${num(overallBounced)} of ${num(overall.sent)} sent · stop above 5%`
          }
          href={overallBounced == null ? undefined : drill("bounced")}
        />
        <Tile
          label="Calls logged"
          value={num(callCount)}
          raw={callCount}
          tone={callCount ? undefined : "muted"}
          /* One logged call, whatever the outcome. Booked a meeting, follow
             up, not interested, didn't reach them — all four land here. */
          note={`Hand-logged, one per call${
            rep === "all" && orphanCalls
              ? ` · ${num(orphanCalls)} on no list yet`
              : ""
          }`}
          href="/calls"
        />
        <Tile
          label="Meetings booked"
          value={num(meetingCount)}
          raw={meetingCount}
          tone={meetingCount ? undefined : "muted"}
          /* Says what it counts. Meetings, not people — two conversations with
             one man are two meetings (decided 20 Aug) — so the headcount is
             printed beside it rather than left for someone to discover in the
             list. Both come from `meeting_counts`, one call, one definition. */
          note={
            meetingCount == null ? "Could not be read"
              : `${meetingCount === meetingPile.people
                    ? `${num(meetingCount)} meeting${meetingCount === 1 ? "" : "s"}`
                    : `${num(meetingCount)} meetings · ${num(meetingPile.people)} people`}${
                  meetingPile.from_calls ? ` · ${num(meetingPile.from_calls)} off the phone` : ""
                } · counted from the day it was booked`
          }
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
              <th>Bounce %</th><th title="People who have opened at least once — a dash means no campaign in this group can register an open">Opened</th><th>Replies</th>
              <th title="A meeting booked on a phone call belongs to no email group, so it is counted in the Total and in no row above it">Meetings</th><th>Proposals</th>
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
                  <DrillCell v={reachedByGroup.get(g.id)?.people ?? null} href={drill("contacted", { group: g.slug })} />
                  <DrillCell v={gBounced} href={drill("bounced", { group: g.slug })} />
                  <BounceCell bounced={gBounced} base={m.sent} />
                  <DrillCell v={groupOpens(g.id)} href={drill("opened", { group: g.slug })} />
                  <DrillCell v={m.replied} href={drill("replied", { group: g.slug })} />
                  <DrillCell v={mt} href={drill("meetings", { group: g.slug })} />
                  <DrillCell v={pr} href={drill("proposals", { group: g.slug })} />
                </tr>
              );
            })}
            <tr className="tot">
              <td>Total</td><td />
              <td>{num(overall.sent)}</td>
              <td>{num(reached.people)}</td>
              <td>{overallBounced == null ? "—" : num(overallBounced)}</td>
              <td>{overallBounced != null && overall.sent ? `${pct(overallBounced, overall.sent)}%` : "—"}</td>
              <td>{reached.trackable ? num(reached.opened) : "\u2014"}</td>
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
