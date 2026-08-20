import {
  db, num, prettyDate, prettyWhen, windowFrom, shift, today,
  METRICS, PAGE_SIZES, pageSize, campaignIdsForGroup, campaignIdsForRep, listHref, pileArgs,
  reachedCounts, pct, dailyRange,
} from "../../lib/db";
import { RangePicker, Pill, Seg, PersonLink, ShareDonut, tally } from "../../components/ui";

export const dynamic = "force-dynamic";

/**
 * One page behind every number on the dashboard.
 *
 * Each metric declares which table holds the humans behind it (see METRICS in
 * lib/db). The shape of the answer differs by vendor and that is not hidden:
 * where a list cannot honour the date window, it says so rather than quietly
 * returning the wrong people.
 */
/**
 * What one row of this list is. The page used to call every row a "person",
 * including the send log, where 6,861 message rows read as 6,861 humans and
 * matched no other number on the site — which is how the word came to be
 * reported as confusing. A row is a person only where the grain is a person.
 */
const UNIT = {
  activities: ["send", "sends"],
  replies:    ["message", "messages"],
  meetings:   ["meeting", "meetings"],
  proposals:  ["proposal", "proposals"],
  people:     ["person", "people"],
};

export default async function List({ searchParams }) {
  const sp = searchParams ?? {};
  const key = sp.metric ?? "sent";
  const m = METRICS[key];
  if (!m) {
    return (
      <>
        <h1>Unknown metric</h1>
        <p className="sub">No such thing as &ldquo;{key}&rdquo;. <a href="/">Back to the dashboard</a>.</p>
      </>
    );
  }

  const w = windowFrom(sp);
  const size = pageSize(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * size;

  // scope: a campaign group, a single campaign, or everything. Group ids ride
  // along for the meetings branch, where a meeting can carry a group_id and no
  // campaign_id — the Overview counts those, so this list must too.
  let scopeIds = null;
  let scopeGroupIds = [];
  let scopeLabel = "all campaigns";
  if (sp.campaign) {
    const { data: c } = await db.from("campaigns").select("id, name").eq("id", sp.campaign).single();
    if (c) { scopeIds = [c.id]; scopeLabel = c.name; }
  } else if (sp.group) {
    const { group, ids } = await campaignIdsForGroup(sp.group);
    if (group) { scopeIds = ids; scopeGroupIds = [group.id]; scopeLabel = group.display_name; }
  } else if (sp.rep) {
    // Reps own groups, not campaigns — see campaignIdsForRep. Scoping here keeps
    // a rep-filtered tile and the list behind it counting the same people.
    const { label, ids, groupIds } = await campaignIdsForRep(sp.rep);
    if (label) { scopeIds = ids; scopeGroupIds = groupIds; scopeLabel = `${label}'s campaigns`; }
  }

  const campaignNames = new Map(
    ((await db.from("campaigns").select("id, name, source")).data ?? []).map((c) => [c.id, c])
  );

  // The lifetime tables carry no usable per-event date, so a window would
  // silently drop people who really are in the number. Say it instead.
  const windowed = m.rpc != null || m.table !== "people" || !!m.dateField;
  const ignoresWindow = !windowed && w.range !== "all";

  let rows = [], count = 0;

  // The window and campaigns every RPC-backed metric asks with. Named once
  // because the open-rate box below has to be counting the same people the
  // list is showing, and a second copy of these three lines is how it stops.
  const rpcScope = {
    from: w.range === "all" ? null : w.from,
    to: w.range === "all" ? null : w.to,
    campaignIds: scopeIds,
    source: null,
  };

  // Built as a function rather than a value, because it is needed twice: once
  // for the page of rows on screen, and once — selecting a single column — for
  // the breakdown above it, which summarises the whole result rather than the
  // twenty-five rows you happen to be looking at.
  const build = (cols, forBreakdown = false) => {
    let q;
    if (m.rpc) {
      // The one metric backed by a function instead of a table. The tile on the
      // Overview counts `reached_counts`, which is a wrapper over this exact
      // call, so the number and this list are the same pile by construction
      // rather than by two people remembering to write the same predicate.
      //
      // Two PostgREST facts, both measured 20 Aug, both cheap to fall into:
      // the `Range` header is ignored on POST /rpc (`.range()` sends
      // limit/offset params, so it is fine), and ordering by a column that is
      // not in `select` fails on a set-returning function — which is why the
      // breakdown query asks for its ordering column too.
      q = db.rpc(m.rpc, pileArgs(rpcScope), { count: "exact" });
      if (cols) q = q.select(`${cols}, last_contacted_at`);
      // The pile is the same people either way; `counter` picks which of their
      // lifetime columns has to be non-zero. Applied as a filter on the
      // function's output rather than inside it, so opened, clicked and
      // reached cannot end up scoped or dated three different ways.
      if (m.counter) q = q.gt(m.counter, 0);
      q = q.order("last_contacted_at", { ascending: false, nullsFirst: false });
      // Scope is an argument to the function, not a filter on its output, so
      // a person in two campaigns is still found by the campaign that is not
      // the one they were first reached through.
      return q;
    }
    if (m.table === "activities") {
      q = db.from("activities")
        .select(cols ?? "id, campaign_id, source, event_type, occurred_at, email, name, company", { count: "exact" })
        .eq("event_type", m.event)
        .gte("activity_date", w.from).lte("activity_date", w.to)
        .order("occurred_at", { ascending: false });
    } else if (m.table === "people") {
      q = db.from("people")
        .select(cols ?? "id, campaign_id, source, email, name, company, status, sent_count, opened_count, clicked_count, replied_count, bounced, first_contacted_at, last_contacted_at", { count: "exact" })
        .order("last_contacted_at", { ascending: false, nullsFirst: false });
      if (m.counter) q = q.gt(m.counter, 0);
      if (m.altFilter) for (const [k, v] of Object.entries(m.altFilter)) q = q.eq(k, v);
      if (m.dateField) q = q.gte(m.dateField, w.from).lte(m.dateField, `${w.to}T23:59:59.999Z`);
    } else if (m.table === "replies") {
      q = db.from("replies")
        .select(cols ?? "id, campaign_id, lead_name, lead_email, company, channel, subject, body, sentiment, received_at", { count: "exact" })
        .gte("received_at", `${w.from}T00:00:00Z`).lte("received_at", `${w.to}T23:59:59.999Z`)
        .order("received_at", { ascending: false });
      // The metric can already pin one sentiment (e.g. auto_reply); a metric
      // that doesn't (replied = every inbound) leaves it open to the ?sentiment=
      // filter — except for the breakdown query, which must see every sentiment
      // to stay clickable regardless of which slice is currently selected.
      if (m.sentiment) q = q.eq("sentiment", m.sentiment);
      else if (!forBreakdown && sp.sentiment && sp.sentiment !== "all") q = q.eq("sentiment", sp.sentiment);
    } else if (m.table === "meetings") {
      // Hand-logged and can be booked for a future date — "all time" means every
      // one ever logged, not capped at today the way send activity is.
      // Only booked + held count as the KPI — a cancelled meeting is not a
      // meeting; the same rule the campaign views already apply.
      q = db.from("meetings")
        .select(cols ?? "id, campaign_id, group_id, prospect_name, prospect_email, company, meeting_date, status, evidence, note", { count: "exact" })
        .in("status", ["booked", "held"])
        .order("meeting_date", { ascending: false });
      if (w.range !== "all") q = q.gte("meeting_date", w.from).lte("meeting_date", w.to);
    } else {
      q = db.from("proposals")
        .select(cols ?? "id, campaign_id, prospect_name, company, amount, sent_date, status, note", { count: "exact" })
        .order("sent_date", { ascending: false });
      if (w.range !== "all") q = q.gte("sent_date", w.from).lte("sent_date", w.to);
    }
    // An empty scope means the group has no campaigns; `in ()` is invalid SQL,
    // so the caller short-circuits rather than silently returning everything.
    // Meetings scope on campaign OR group — a group-only meeting (campaign_id
    // null) is counted by the Overview tile and must not vanish here.
    if (scopeIds !== null) {
      if (m.table === "meetings") {
        const parts = [];
        if (scopeIds.length) parts.push(`campaign_id.in.(${scopeIds.join(",")})`);
        if (scopeGroupIds.length) parts.push(`group_id.in.(${scopeGroupIds.join(",")})`);
        if (parts.length) q = q.or(parts.join(","));
      } else if (scopeIds.length) {
        q = q.in("campaign_id", scopeIds);
      }
    }
    return q;
  };

  // An activity list is one event type by definition, so there is nothing to
  // divide; the other shapes carry a state worth seeing the shape of.
  const BREAKDOWN = { people: "status", replies: "sentiment", meetings: "status", proposals: "status" };
  const field = BREAKDOWN[m.table];
  let breakdown = [];

  const scopeEmpty = scopeIds !== null && !scopeIds.length &&
    !(m.table === "meetings" && scopeGroupIds.length);
  if (!scopeEmpty) {
    const [res, cats] = await Promise.all([
      build().range(offset, offset + size - 1),
      field ? build(`campaign_id, ${field}`, true).limit(5000) : Promise.resolve({ data: [] }),
    ]);
    rows = res.data ?? [];
    count = res.count ?? 0;
    breakdown = tally(cats.data, field);
  }

  // What the vendors say they sent over this window, against how many send
  // records we actually hold. Instantly keeps only a lead's more recent sends,
  // so the event stream is a floor and the notebook is the count — the note
  // under the list says the difference out loud rather than leaving two numbers
  // to be discovered by someone trying to reconcile them.
  let vendorSends = null;
  if (m.table === "activities" && m.event === "sent" && !scopeEmpty) {
    const ids = scopeIds ? new Set(scopeIds) : null;
    vendorSends = (await dailyRange(w.from, w.to)).reduce(
      (a, r) => a + (r.campaign_id && (!ids || ids.has(r.campaign_id)) ? r.sent ?? 0 : 0), 0
    );
  }

  // Both denominators for "people who opened", counted over the same scope as
  // the list. Fetched rather than written down: a note carrying 1,491 as text
  // would be a second copy of a number nothing keeps in step.
  const openScope =
    m.counter === "opened_count" && !scopeEmpty ? await reachedCounts(rpcScope) : null;

  const pages = Math.max(1, Math.ceil(count / size));
  const base = {
    metric: key, group: sp.group, campaign: sp.campaign, rep: sp.rep, size,
    range: w.range === "day" ? undefined : w.range, d: w.range === "day" ? w.from : undefined,
    sentiment: m.sentiment ? undefined : sp.sentiment,
  };
  const link = (extra) => listHref({ ...base, ...extra });
  const canFilterSentiment = field === "sentiment" && !m.sentiment;
  const SENTIMENTS = ["all", "unclassified", "interested", "referral", "not_now", "not_interested", "auto_reply"];

  return (
    <>
      <h1>{m.label}</h1>
      <p className="sub">
        {num(count)} {(m.unit ?? UNIT[m.table] ?? UNIT.people)[count === 1 ? 0 : 1]} · {scopeLabel} ·{" "}
        {w.range === "day" ? prettyDate(w.from) : w.label.toLowerCase()}. {m.note}
      </p>

      <div className="range">
        <a href={
          sp.campaign ? `/c/${sp.campaign}`
            : sp.group ? `/campaigns/${sp.group}`
            : sp.rep ? `/?rep=${encodeURIComponent(sp.rep)}`
            : "/"
        }>&larr; back</a>
      </div>

      <RangePicker
        base={listHref({ ...base, range: undefined, d: undefined })}
        current={w.range}
        day={{
          current: w.range === "day" ? w.from : today(),
          prev: shift(w.range === "day" ? w.from : today(), -1),
          next: shift(w.range === "day" ? w.from : today(), 1),
        }}
      />

      {ignoresWindow ? (
        <div className="warnbox w">
          Neither Instantly nor lemlist timestamps this event, so it cannot be filtered to
          a date range. This is the lifetime list, not {w.label.toLowerCase()}.
        </div>
      ) : null}

      {/* Only where the two denominators actually differ. In a scope whose
          campaigns all carry a pixel — Chicago Retrofit, every lemlist group —
          there is no second denominator to be confused by, and a box saying
          "0 people between them" is noise pretending to be rigour. */}
      {vendorSends && vendorSends > count ? (
        <div className="warnbox plain">
          <b>We hold {num(count)} of the {num(vendorSends)} sends the tools counted here</b> —{" "}
          {num(vendorSends - count)} short. Instantly keeps only a lead&rsquo;s more recent
          sends and drops the older ones, so this list is a floor rather than the whole
          history; lemlist&rsquo;s side is complete. The tile on the Overview says{" "}
          {num(vendorSends)}, because that is what the tools counted at the time. Both are
          messages, not people — {" "}
          <a className="drilled" href={listHref({ metric: "contacted", range: base.range, d: base.d, group: sp.group, campaign: sp.campaign, rep: sp.rep })}>
            the people behind them are here
          </a>.
        </div>
      ) : null}

      {openScope?.trackable && openScope.people > openScope.trackable ? (
        <div className="warnbox plain">
          <b>Two denominators, and {num(openScope.people - openScope.trackable)} people between them.</b> {num(count)} of the{" "}
          {num(openScope.trackable)} people whose mail could register an open is{" "}
          <b>{pct(count, openScope.trackable)}%</b> — the figure on the tile. Over everyone
          reached, all {num(openScope.people)}, it is {pct(count, openScope.people)}%.
          {" "}The difference is the {num(openScope.people - openScope.trackable)} people in
          campaigns that carry no tracking pixel: they did not decline to open the mail,
          nothing was watching. Counting them can only push the rate down, and it would fall
          again every time a campaign runs with tracking off — which would read as
          engagement dropping when nothing about it had changed.
        </div>
      ) : null}

      <ShareDonut
        title={m.table === "replies" ? "replies" : m.table === "meetings" ? "meetings" : "people"}
        items={breakdown}
        note={`By ${field === "sentiment" ? "how the reply was read" : "status"}, across all ${num(count)} — not just this page.`}
      />

      {canFilterSentiment ? (
        <div className="segrow">
          <span className="note">Type</span>
          <Seg
            options={SENTIMENTS.map((s) => [s, s.replace(/_/g, " ")])}
            current={sp.sentiment ?? "all"}
            hrefFor={(s) => link({ sentiment: s === "all" ? undefined : s, page: 1 })}
          />
        </div>
      ) : null}

      <div className="segrow">
        <span className="note">Show</span>
        <Seg
          options={PAGE_SIZES.map((s) => [s, s])}
          current={size}
          hrefFor={(s) => link({ size: s, page: 1 })}
        />
      </div>

      <div className="card tw">
        <table>
          <thead>
            {m.table === "replies" ? (
              <tr><th style={{ textAlign: "left" }}>Person</th><th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Campaign</th><th>Type</th><th style={{ textAlign: "left" }}>Message</th><th>When</th></tr>
            ) : m.table === "meetings" ? (
              <tr><th style={{ textAlign: "left" }}>Person</th><th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Campaign</th><th>Status</th><th>Evidence</th><th>Date</th></tr>
            ) : m.table === "proposals" ? (
              <tr><th style={{ textAlign: "left" }}>Person</th><th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Campaign</th><th>Amount</th><th>Status</th><th>Sent</th></tr>
            ) : m.table === "people" ? (
              <tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Campaign</th>
                <th>Status</th><th>Opens</th><th>Clicks</th><th>Replies</th><th>Last contacted</th></tr>
            ) : (
              <tr><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Campaign</th>
                <th>Tool</th><th>When</th></tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = campaignNames.get(r.campaign_id);
              const cname = c ? <a href={`/c/${r.campaign_id}`}>{c.name}</a> : <span className="dim">—</span>;

              if (m.table === "replies") return (
                <tr key={r.id}>
                  <td className="name">
                    <PersonLink email={r.lead_email} name={r.lead_name} fallback="Unknown" />
                    {r.lead_name && r.lead_email ? <div className="dim" style={{ fontSize: 12 }}>{r.lead_email}</div> : null}</td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td style={{ textAlign: "left" }}>{cname}</td>
                  <td><Pill status={r.sentiment} /></td>
                  <td style={{ textAlign: "left", maxWidth: "48ch" }}>
                    {r.subject ? <div style={{ fontWeight: 600, fontSize: 13 }}>{r.subject}</div> : null}
                    <div className="dim" style={{ fontSize: 12.5 }}>{(r.body ?? "").slice(0, 220) || "—"}</div>
                  </td>
                  <td className="dim">{prettyWhen(r.received_at)}</td>
                </tr>
              );

              if (m.table === "meetings") return (
                <tr key={r.id}>
                  <td className="name">
                    {r.prospect_name || r.prospect_email
                      ? <PersonLink email={r.prospect_email} name={r.prospect_name} />
                      : <span className="dim">not recorded</span>}
                    {r.prospect_email ? <div className="dim" style={{ fontSize: 12 }}>{r.prospect_email}</div> : null}</td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td style={{ textAlign: "left" }}>{cname}</td>
                  <td><Pill status={r.status} /></td>
                  <td className="dim">{r.evidence}</td>
                  <td className="dim">{prettyDate(r.meeting_date)}</td>
                </tr>
              );

              if (m.table === "proposals") return (
                <tr key={r.id}>
                  <td className="name">{r.prospect_name || "—"}</td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td style={{ textAlign: "left" }}>{cname}</td>
                  <td>{r.amount != null ? `$${num(r.amount)}` : "—"}</td>
                  <td><Pill status={r.status} /></td>
                  <td className="dim">{prettyDate(r.sent_date)}</td>
                </tr>
              );

              if (m.table === "people") return (
                <tr key={r.id}>
                  <td className="name"><PersonLink email={r.email} name={r.name} /></td>
                  <td className="dim" style={{ textAlign: "left" }}>{r.email}</td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td style={{ textAlign: "left" }}>{cname}</td>
                  <td><Pill status={r.status} /></td>
                  <td className={r.opened_count ? "" : "zero"}>{num(r.opened_count)}</td>
                  <td className={r.clicked_count ? "" : "zero"}>{num(r.clicked_count)}</td>
                  <td className={r.replied_count ? "" : "zero"}>{num(r.replied_count)}</td>
                  <td className="dim">{r.last_contacted_at ? prettyWhen(r.last_contacted_at) : "—"}</td>
                </tr>
              );

              return (
                <tr key={r.id}>
                  <td className="name"><PersonLink email={r.email} name={r.name} /></td>
                  <td className="dim" style={{ textAlign: "left" }}>{r.email || "—"}</td>
                  <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                  <td style={{ textAlign: "left" }}>{cname}</td>
                  <td className="dim">{r.source}</td>
                  <td className="dim">{prettyWhen(r.occurred_at)}</td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr><td colSpan={9} className="empty">Nobody here for this window.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="range" style={{ marginTop: 12 }}>
          {page > 1 ? <a href={link({ page: page - 1 })}>&larr;</a> : null}
          <span className="count">
            {num(offset + 1)}–{num(Math.min(offset + size, count))} of {num(count)}
          </span>
          {page < pages ? <a href={link({ page: page + 1 })}>&rarr;</a> : null}
        </div>
      ) : null}
    </>
  );
}
