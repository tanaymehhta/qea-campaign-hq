import {
  db, num, pct, prettyDate, prettyWhen, listHref, pageSize, PAGE_SIZES,
  responseCounts, reachedCounts,
} from "../../../lib/db";
import { Num, BounceCell, Pill, DrillCell, PeopleTable, Tile, ShareDonut, tally } from "../../../components/ui";

export const dynamic = "force-dynamic";

export default async function Group({ params, searchParams }) {
  const sp = searchParams ?? {};
  const [{ data: g }, { data: allGroups }] = await Promise.all([
    db.from("v_group_summary").select("*").eq("slug", params.slug).single(),
    db.from("campaign_groups").select("slug, display_name, sort_order").order("sort_order"),
  ]);
  if (!g) return <><h1>Not found</h1><p className="sub">No campaign group with that name.</p></>;

  const { data: subs } = await db
    .from("v_campaign_summary").select("*").eq("group_id", g.id);

  // everyone across every campaign in this group
  const ids = (subs ?? []).map((s) => s.campaign_id);
  const size = pageSize(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * size;
  let people = [], peopleCount = 0, statuses = [];
  if (ids.length) {
    // Two reads: the page on screen, and one column for everyone, so the ring
    // above the table describes the group rather than the rows in view.
    const [res, all] = await Promise.all([
      db.from("people")
        .select("id, campaign_id, source, email, name, company, status, opened_count, clicked_count, replied_count, last_contacted_at", { count: "exact" })
        .in("campaign_id", ids)
        .order("last_contacted_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + size - 1),
      db.from("people").select("status").in("campaign_id", ids).limit(5000),
    ]);
    people = res.data ?? [];
    peopleCount = res.count ?? 0;
    statuses = all.data ?? [];
  }
  const nameOf = new Map((subs ?? []).map((s) => [s.campaign_id, s.sub_campaign_label || s.name]));
  const pageHref = (extra) => {
    const q = new URLSearchParams({ size: String(size), page: String(page), ...extra });
    return `/campaigns/${params.slug}?${q}#people`;
  };
  const drill = (metric) => listHref({ metric, range: "all", group: params.slug });
  const pileHref = (view, extra = {}) =>
    `/replies?${new URLSearchParams({ view, range: "all", group: params.slug, ...extra })}`;

  // Answers and people reached, for the group and for each sub-campaign in it.
  // Both from the functions the Overview tile and /replies ask, because a
  // column that sums a different definition from the tile above it is how a
  // page comes to disagree with itself. This read `v_campaign_summary.replied`
  // — the vendor's reply counter, message-grain and filtered by the vendor's
  // own idea of a robot — and divided it by `leads`, the size of the list.
  //
  // Two calls per sub-campaign. This is a detail page for one group; the
  // Overview asks the same question five times for the same reason.
  const lifetime = (ids) => ({ from: null, to: null, source: null, campaignIds: ids });
  const [groupResp, groupReach, subStats] = await Promise.all([
    responseCounts(lifetime(ids)),
    reachedCounts({ ...lifetime(ids), rep: null }),
    Promise.all(
      (subs ?? []).map(async (sub) => {
        const [resp, reach] = await Promise.all([
          responseCounts(lifetime([sub.campaign_id])),
          reachedCounts({ ...lifetime([sub.campaign_id]), rep: null }),
        ]);
        return [sub.campaign_id, { resp, reach, rate: pct(resp.responded, reach.people) }];
      })
    ),
  ]);
  const statOf = (id) => subStats.find(([k]) => k === id)?.[1] ?? { resp: {}, reach: {}, rate: null };
  const groupRate = pct(groupResp.responded, groupReach.people);

  // rank by response rate — the whole reason for running variants
  const ranked = (subs ?? []).sort((a, b) => {
    const ra = statOf(a.campaign_id).rate ?? -1;
    const rb = statOf(b.campaign_id).rate ?? -1;
    if (rb !== ra) return rb - ra;
    return (b.sent ?? 0) - (a.sent ?? 0);
  });

  // What the Meetings column below actually adds up to, which since 21 Aug is
  // allowed to be less than the group's own total — see the note under the table.
  const subMeetings = ranked.reduce((a, s) => a + Number(s.meetings ?? 0), 0);

  const overBounce = ranked.filter((s) => s.sent > 40 && pct(s.bounced, s.sent) > 5);
  const starved = ranked.filter((s) => s.status === "running" && s.daily_limit && s.daily_limit < 10);

  return (
    <>
      <a className="drilled dim" href="/campaigns" style={{ fontSize: 12.5, display: "inline-block", marginBottom: 10 }}>
        &larr; All campaigns
      </a>
      <h1>{g.display_name}</h1>
      <p className="sub">{g.description ?? " "}</p>

      <div className="tabs">
        {(allGroups ?? []).map((x) => (
          <a key={x.slug} href={`/campaigns/${x.slug}`} className={x.slug === params.slug ? "on" : ""}>
            {x.display_name}
          </a>
        ))}
      </div>

      <div className="grid g5">
        <Tile plus label="People" value={num(peopleCount || g.leads)} raw={peopleCount || g.leads}
          note={`${g.campaign_count} campaigns · ${g.running_count} running`} href="#people" />
        <Tile plus label="Sent" value={num(g.sent)} raw={g.sent}
          note={`${num(g.delivered)} delivered`} href={drill("sent")} />
        <Tile plus label="Responses" value={num(groupResp.responded)} raw={groupResp.responded}
          tone={groupResp.responded ? undefined : "muted"}
          note={
            groupRate == null
              ? `${num(groupResp.interested)} interested`
              : `${groupRate}% of the ${num(groupReach.people)} reached · ${num(groupResp.interested)} interested`
          }
          href={pileHref("responded")} />
        {/* Meetings have one page, /meetings, which has no group filter — so
            this opens every meeting rather than this group's, and the note says
            so instead of the tile quietly changing what it meant. */}
        <Tile plus label="Meetings" value={num(g.meetings)} raw={g.meetings}
          tone={g.meetings ? undefined : "muted"} note="The primary KPI — opens every meeting"
          href="/meetings" />
        <Tile plus label="Proposals sent" value={num(g.proposals)} raw={g.proposals}
          tone={g.proposals ? undefined : "muted"} note="Logged by hand" href={drill("proposals")} />
      </div>

      {overBounce.length ? (
        <div className="warnbox">
          <b>{overBounce.length} campaign{overBounce.length > 1 ? "s are" : " is"} above the 5% bounce stop-threshold:</b>{" "}
          {overBounce.map((s) => `${s.sub_campaign_label ?? s.name} (${pct(s.bounced, s.sent)}%)`).join(", ")}.
          The runbook says pause and re-verify the list.
        </div>
      ) : null}

      {starved.length ? (
        <div className="warnbox w">
          <b>{starved.length} running campaign{starved.length > 1 ? "s have" : " has"} a daily cap under 10:</b>{" "}
          {starved.map((s) => `${s.sub_campaign_label ?? s.name} (${s.daily_limit}/day)`).join(", ")}.
          At that volume they will never accumulate enough sends to tell you whether the copy works.
        </div>
      ) : null}

      <h2>Sub-campaigns, best response rate first</h2>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>Sub-campaign</th><th>Tool</th><th>Status</th><th>Leads</th><th>Sent</th>
              <th>Bounced</th><th>Bounce %</th><th>Opened</th>
              <th title="People who wrote back an answer. Machines and mail nobody has read yet are in neither this nor the rate beside it.">Responses</th>
              <th title="Answers over the people we actually reached in this sub-campaign — not over the size of its list">Response %</th>
              <th>LI acc.</th><th>Meetings</th><th>Proposals</th><th>Cap/day</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => (
              <tr key={s.campaign_id}>
                <td className="name">
                  <a href={`/c/${s.campaign_id}`}>{s.sub_campaign_label || s.name}</a>
                  {s.assignment_source === "override" ? <span className="alias">grouped by hand</span> : null}
                </td>
                <td className="dim">{s.source}</td>
                <td><Pill status={s.status} /></td>
                <Num v={s.leads} />
                <Num v={s.sent} />
                <Num v={s.bounced} />
                <BounceCell bounced={s.bounced} base={s.sent} />
                <Num v={s.opened} />
                <DrillCell
                  v={statOf(s.campaign_id).resp.responded ?? null}
                  href={pileHref("responded", { campaign: s.campaign_id })}
                />
                <td className={statOf(s.campaign_id).rate >= 3 ? "ok" : "zero"}>
                  {statOf(s.campaign_id).rate == null ? "—" : `${statOf(s.campaign_id).rate}%`}
                </td>
                <Num v={s.linkedin_accepted} />
                <Num v={s.meetings} />
                <Num v={s.proposals} />
                <td className="dim">{s.daily_limit ?? "—"}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Total</td><td /><td />
              <td>{num(g.leads)}</td><td>{num(g.sent)}</td><td>{num(g.bounced)}</td>
              <td>{g.sent ? `${pct(g.bounced, g.sent)}%` : "—"}</td>
              <td>{num(g.opened)}</td><td>{num(groupResp.responded)}</td>
              <td>{groupRate == null ? "—" : `${groupRate}%`}</td>
              <td>{num(g.linkedin_accepted)}</td><td>{num(g.meetings)}</td><td>{num(g.proposals)}</td><td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Decided 20 Aug: the group tile counts a meeting logged against the
          group itself, the sub-campaign rows do not — a group meeting names no
          sub-campaign and pretending it belongs to one would be a guess. So the
          Meetings column can legitimately add up to less than its own Total, and
          a column that does not sum has to say why rather than look broken.
          Derived, so it appears only when there is something to explain. */}
      {Number(g.meetings) > subMeetings ? (
        <p className="sub" style={{ marginTop: 10 }}>
          The Meetings column adds up to {num(subMeetings)}, not {num(g.meetings)}
          {": "}
          {num(Number(g.meetings) - subMeetings)} of this group&rsquo;s meeting
          {Number(g.meetings) - subMeetings === 1 ? " was" : "s were"} logged against{" "}
          {g.display_name} itself rather than one of its sub-campaigns, so{" "}
          {Number(g.meetings) - subMeetings === 1 ? "it counts" : "they count"} in the
          total and on the tile but sit in no row above.{" "}
          <a className="drilled" href="/meetings">See every meeting &rarr;</a>
        </p>
      ) : null}

      <h2 id="people">Everyone in {g.display_name}</h2>
      <p className="sub">
        Every person across all {g.campaign_count} sub-campaigns, most recently contacted first.
      </p>
      <ShareDonut title="people" items={tally(statuses, "status")}
        note="By status, across the whole group — not just this page." />
      <PeopleTable
        rows={people}
        count={peopleCount}
        size={size}
        page={page}
        hrefFor={pageHref}
        campaignOf={nameOf}
      />

      <h2>What this campaign is</h2>
      <div className="card">
        <div className="meta">
          <div><div className="k">Owner</div><div className="v">{g.owner ?? "—"}</div></div>
          <div><div className="k">Tools</div><div className="v">{(g.platform ?? []).join(", ") || "—"}</div></div>
          <div><div className="k">Geography</div><div className="v">{g.geography ?? "—"}</div></div>
          <div><div className="k">Emails in sequence</div><div className="v">
            {(g.sequence_shape?.match(/E\d+/g) ?? []).length || "—"}
          </div></div>
          <div><div className="k">Started</div><div className="v">{g.started_on ? prettyDate(g.started_on) : "—"}</div></div>
        </div>
      </div>
    </>
  );
}
