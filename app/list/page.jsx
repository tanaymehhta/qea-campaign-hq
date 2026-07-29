import {
  db, num, prettyDate, prettyWhen, windowFrom, shift, today,
  METRICS, PAGE_SIZES, pageSize, campaignIdsForGroup, campaignIdsForRep, listHref,
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

  // scope: a campaign group, a single campaign, or everything
  let scopeIds = null;
  let scopeLabel = "all campaigns";
  if (sp.campaign) {
    const { data: c } = await db.from("campaigns").select("id, name").eq("id", sp.campaign).single();
    if (c) { scopeIds = [c.id]; scopeLabel = c.name; }
  } else if (sp.group) {
    const { group, ids } = await campaignIdsForGroup(sp.group);
    if (group) { scopeIds = ids; scopeLabel = group.display_name; }
  } else if (sp.rep) {
    // Reps own groups, not campaigns — see campaignIdsForRep. Scoping here keeps
    // a rep-filtered tile and the list behind it counting the same people.
    const { label, ids } = await campaignIdsForRep(sp.rep);
    if (label) { scopeIds = ids; scopeLabel = `${label}'s campaigns`; }
  }

  const campaignNames = new Map(
    ((await db.from("campaigns").select("id, name, source")).data ?? []).map((c) => [c.id, c])
  );

  // The lifetime tables carry no usable per-event date, so a window would
  // silently drop people who really are in the number. Say it instead.
  const windowed = m.table !== "people" || !!m.dateField;
  const ignoresWindow = !windowed && w.range !== "all";

  let rows = [], count = 0;

  // Built as a function rather than a value, because it is needed twice: once
  // for the page of rows on screen, and once — selecting a single column — for
  // the breakdown above it, which summarises the whole result rather than the
  // twenty-five rows you happen to be looking at.
  const build = (cols) => {
    let q;
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
      if (m.sentiment) q = q.eq("sentiment", m.sentiment);
    } else if (m.table === "meetings") {
      q = db.from("meetings")
        .select(cols ?? "id, campaign_id, prospect_name, prospect_email, company, meeting_date, status, evidence, note", { count: "exact" })
        .gte("meeting_date", w.from).lte("meeting_date", w.to)
        .order("meeting_date", { ascending: false });
    } else {
      q = db.from("proposals")
        .select(cols ?? "id, campaign_id, prospect_name, company, amount, sent_date, status, note", { count: "exact" })
        .gte("sent_date", w.from).lte("sent_date", w.to)
        .order("sent_date", { ascending: false });
    }
    // An empty scope means the group has no campaigns; `in ()` is invalid SQL,
    // so the caller short-circuits rather than silently returning everything.
    if (scopeIds?.length) q = q.in("campaign_id", scopeIds);
    return q;
  };

  // An activity list is one event type by definition, so there is nothing to
  // divide; the other shapes carry a state worth seeing the shape of.
  const BREAKDOWN = { people: "status", replies: "sentiment", meetings: "status", proposals: "status" };
  const field = BREAKDOWN[m.table];
  let breakdown = [];

  if (scopeIds?.length !== 0) {
    const [res, cats] = await Promise.all([
      build().range(offset, offset + size - 1),
      field ? build(`campaign_id, ${field}`).limit(5000) : Promise.resolve({ data: [] }),
    ]);
    rows = res.data ?? [];
    count = res.count ?? 0;
    breakdown = tally(cats.data, field);
  }

  const pages = Math.max(1, Math.ceil(count / size));
  const base = { metric: key, group: sp.group, campaign: sp.campaign, rep: sp.rep, size, range: w.range === "day" ? undefined : w.range, d: w.range === "day" ? w.from : undefined };
  const link = (extra) => listHref({ ...base, ...extra });

  return (
    <>
      <h1>{m.label}</h1>
      <p className="sub">
        {num(count)} {count === 1 ? "person" : "people"} · {scopeLabel} ·{" "}
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

      <ShareDonut
        title={m.table === "replies" ? "replies" : m.table === "meetings" ? "meetings" : "people"}
        items={breakdown}
        note={`By ${field === "sentiment" ? "how the reply was read" : "status"}, across all ${num(count)} — not just this page.`}
      />

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
