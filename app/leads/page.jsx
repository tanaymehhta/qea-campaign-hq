import { db, num, prettyDate, prettyWhen } from "../../lib/db";
import { Tile, Pill, PersonLink } from "../../components/ui";

export const dynamic = "force-dynamic";

/**
 * Leads — one row per human, across email and the phone.
 *
 * Every read goes to `v_lead_people` (migrations 20260820180517 and
 * 20260820180640). Three things about it decide the shape of this page:
 *
 *   A ROW IS A PERSON. It used to be a person × campaign: 2,780 rows called
 *   2,731 people. No one spans two campaign *groups*, so collapsing lost
 *   nothing and the group tabs still sum to the total.
 *
 *   THE CALL LIST IS ON IT. All 1,255 phoned-or-callable names, not only the
 *   11 anyone has dialled — reversed by Tanay on 20 Aug, because the page's job
 *   is to be the thing you check before you contact somebody, and a name it
 *   does not hold is a name that gets chased twice.
 *
 *   TWO QUESTIONS, NEVER MERGED. "Have we contacted them?" is answered by the
 *   tools and by the call log. "Status" is a column somebody typed on a
 *   spreadsheet: 49 people carry `sent` with no send in either tool, and 906
 *   with a real send do not carry it. Both are shown; neither is derived from
 *   the other; the filters cross so the disagreement is one click away.
 *
 * Every number on this page is a `count: "exact"` head-count over the SAME
 * Every number here comes from `lead_facets` and the table from `lead_rows`,
 * two readers of one predicate written once in SQL. The page holds no filter
 * logic of its own, so a number and the list it opens cannot describe
 * different people — not because two people remembered to write the same
 * thing twice, but because there is only one of it.
 */

const STATUSES = ["sent", "assigned", "prospect", "held", "no_email"];
const CHANNELS = {
  email: "email campaigns",
  call: "the call list",
  both: "on both",
};
const PAGE = 100;

export default async function Leads({ searchParams }) {
  const sp = searchParams ?? {};

  const [{ data: groups }, { data: callCampaigns }] = await Promise.all([
    db.from("campaign_groups").select("id, slug, display_name, sort_order").order("sort_order"),
    db.from("call_campaigns").select("id, slug, display_name").order("created_at"),
  ]);

  // The two kinds of list a person can be on, in one picker. They are different
  // tables and they stay different columns — the picker is a convenience, not a
  // merge.
  const lists = [
    ...(groups ?? []).map((g) => ({ ...g, kind: "group" })),
    ...(callCampaigns ?? []).map((c) => ({ ...c, kind: "call" })),
  ];
  const bySlug = new Map(lists.map((l) => [l.slug, l]));
  const nameOfList = new Map(lists.map((l) => [l.id, l.display_name]));

  const selSlugs = [...new Set((sp.list ?? "").split(",").filter((s) => bySlug.has(s)))];
  const selGroupIds = selSlugs.map((s) => bySlug.get(s)).filter((l) => l.kind === "group").map((l) => l.id);
  const selCallIds = selSlugs.map((s) => bySlug.get(s)).filter((l) => l.kind === "call").map((l) => l.id);

  const channel = CHANNELS[sp.ch] ? sp.ch : null;
  const status = STATUSES.includes(sp.status) ? sp.status : null;
  const reached = sp.reached === "yes" || sp.reached === "no" ? sp.reached : null;
  // Three states, because the "No way to contact" tile has to be able to open
  // its own 1,162 people: "yes" only the reachable, "no" only the unreachable,
  // absent asks nothing.
  const canReach = sp.can === "yes" ? true : sp.can === "no" ? false : null;
  const search = (sp.q ?? "").replace(/[,()%*]/g, "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  /**
   * The arguments both readers ask with. `lead_facets` counts and `lead_rows`
   * lists, from one predicate written once in SQL — migrations 20260820181400
   * and 20260820181426 — so no number on this page can describe a different set of
   * people from the table underneath it. The page itself holds no filter logic
   * at all, which is the only way to guarantee that.
   */
  const args = {
    p_groups: selGroupIds.length ? selGroupIds : null,
    p_calls: selCallIds.length ? selCallIds : null,
    p_channel: channel,
    p_status: status,
    p_reached: reached,
    p_contactable: canReach,
    p_search: search || null,
  };

  // Twenty-six numbers in one pass over one materialised scan. They used to be
  // twenty-five separate head-counts, each re-planning and re-running a view
  // that costs ~95ms, and the page took nine seconds to load.
  const [{ data: facetRows }, { data: rows }] = await Promise.all([
    db.rpc("lead_facets", args),
    db.rpc("lead_rows", args).range((page - 1) * PAGE, page * PAGE - 1),
  ]);
  const F = new Map((facetRows ?? []).map((r) => [`${r.facet}:${r.key}`, r.n]));
  // A missing facet key means "none of those", which is a real zero — the
  // grouped branches only emit a row for a value that exists. A failed *read*
  // is different and shows as an em dash, because `f` is null then, not empty.
  const f = (facet, key) => (facetRows ? Number(F.get(`${facet}:${key}`) ?? 0) : null);

  const total = f("total", "all");
  const emailSide = f("total", "email");
  const callSide = f("total", "call");
  const contactedAll = f("total", "contacted");
  const neverAll = f("total", "never");
  const uncontactableAll = f("total", "unreachable");
  const markedSent = f("total", "marked_sent");
  const calledAll = f("total", "called");
  const shown = f("shown", "all") ?? 0;
  // People on neither an email group nor a call campaign. Three today: calls
  // logged before `call_contacts` existed, which carry a name and nothing else.
  const listed = lists.reduce((a, l) => a + (f("list", l.id) ?? 0), 0);
  const unlisted = f("list", "all") == null ? null : f("list", "all") - listed;

  // Name-only collisions across the two sides. Surfaced, never acted on: the
  // rule is that only an email address merges two records (§10.3), and the one
  // that exists today is two different Michael Murphys.
  const { data: twins } = await db
    .from("v_lead_people").select("name, company, channel").eq("name_twin", true).limit(20);

  const href = (over = {}) => {
    const q = new URLSearchParams();
    const listv = "list" in over ? over.list : selSlugs.join(",");
    const ch = "ch" in over ? over.ch : channel;
    const st = "status" in over ? over.status : status;
    const rc = "reached" in over ? over.reached : reached;
    const can = "can" in over ? over.can : canReach;
    if (listv) q.set("list", listv);
    if (ch) q.set("ch", ch);
    if (st) q.set("status", st);
    if (rc) q.set("reached", rc);
    if (can === true) q.set("can", "yes");
    else if (can === false) q.set("can", "no");
    if (search) q.set("q", search);
    const p = "page" in over ? over.page : 1;
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  // Clicking a list toggles it in or out of the set.
  const listHrefFor = (slug) => {
    const next = slug === null ? []
      : selSlugs.includes(slug) ? selSlugs.filter((s) => s !== slug)
      : [...selSlugs, slug];
    return href({ list: next.join(",") });
  };

  const pages = Math.max(1, Math.ceil(shown / PAGE));
  const filtered = !!(channel || status || reached || canReach !== null || search || selSlugs.length);

  return (
    <>
      <h1>Leads</h1>
      <p className="sub">
        Every human we know, <strong>one row each</strong> — {num(emailSide)} from the email
        campaigns and {num(callSide)} from the call list, which is on this page whether or not
        anyone has dialled them yet. Two different questions are answered side by side:{" "}
        <strong>contacted</strong> is what the tools and the call log actually did, and{" "}
        <strong>status</strong> is a column typed on a source spreadsheet. They disagree, and
        crossing them is one click.
      </p>

      <div className="grid g5">
        <Tile
          hero
          label="People"
          value={num(total)}
          raw={total}
          note={`${num(emailSide)} emailed or targeted · ${num(callSide)} on the call list · nobody is on both yet`}
        />
        <Tile
          hero
          label="Contacted"
          value={num(contactedAll)}
          raw={contactedAll}
          note={`Emailed or dialled, by any channel · ${num(calledAll)} of them by phone`}
          href="/list?metric=contacted&range=all"
        />
        <Tile
          plus
          label="Never contacted"
          value={num(neverAll)}
          raw={neverAll}
          note="Nothing has gone out to these people yet"
          href={href({ reached: "no", ch: null, status: null, list: "", can: null })}
        />
        <Tile
          plus
          label="No way to contact"
          value={num(uncontactableAll)}
          raw={uncontactableAll}
          tone="muted"
          // Almost all of these are call-list names carrying a licence and a
          // building book but no phone number and no address. They are real
          // targets and they are not workable today, which is a fact worth a
          // tile rather than a surprise at the bottom of a list.
          note="No phone number and no email address on file"
          href={href({ can: false, reached: null, ch: null, status: null, list: "" })}
        />
        <Tile
          plus
          label="Marked sent"
          value={num(markedSent)}
          raw={markedSent}
          tone="muted"
          note="Typed on the source spreadsheet — not the tools"
          href={href({ status: "sent", reached: null, ch: null, list: "", can: null })}
        />
      </div>

      {twins?.length ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0 }}>
            <b>Possibly the same person, twice.</b>{" "}
            {twins.map((t) => `${t.name} (${t.company || "no company"})`).join(", ")}{" "}
            {twins.length === 1 ? "appears" : "appear"} on both sides under the same name with no
            shared email address. Names are never merged automatically — only an email address
            joins two records. Somebody has to look.
          </p>
        </div>
      ) : null}

      <form action="/leads" method="GET" className="searchbox" style={{ marginBottom: 16 }}>
        {selSlugs.length ? <input type="hidden" name="list" value={selSlugs.join(",")} /> : null}
        {channel ? <input type="hidden" name="ch" value={channel} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {reached ? <input type="hidden" name="reached" value={reached} /> : null}
        {canReach !== null ? <input type="hidden" name="can" value={canReach ? "yes" : "no"} /> : null}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input type="search" name="q" placeholder="Search name, email, company, or phone…"
          defaultValue={sp.q ?? ""} />
      </form>

      <div className="segrow" style={{ marginBottom: 10 }}>
        <span className="note">Where they came from</span>
        <div className="seg">
          <a href={href({ ch: null })} className={!channel ? "on" : ""}>All ({num(f("channel", "all"))})</a>
          <a href={href({ ch: "email" })} className={channel === "email" ? "on" : ""}>email campaigns ({num(f("channel", "email"))})</a>
          <a href={href({ ch: "call" })} className={channel === "call" ? "on" : ""}>call list ({num(f("channel", "call"))})</a>
          <a href={href({ ch: "both" })} className={channel === "both" ? "on" : ""}>both ({num(f("channel", "both"))})</a>
        </div>
      </div>

      {/* The tabs below sum to less than the total, and the gap is named rather
          than left to be discovered: three people were rung before the call
          workspace existed and belong to no list at all. */}
      <div className="segrow" style={{ marginBottom: 10 }}>
        <span className="note">
          Which list — pick several
          {unlisted ? ` · ${num(unlisted)} on no list` : ""}
        </span>
        <div className="seg">
          {/* Not the page-wide total: clearing the list picker leaves every
              other filter on, so this counts what clicking it would show. */}
          <a href={listHrefFor(null)} className={!selSlugs.length ? "on" : ""}>All ({num(f("list", "all"))})</a>
          {lists.filter((l) => f("list", l.id)).map((l) => (
            <a key={l.slug} href={listHrefFor(l.slug)}
              className={selSlugs.includes(l.slug) ? "on" : ""}>
              {l.display_name} ({num(f("list", l.id))})
            </a>
          ))}
        </div>
      </div>

      <div className="segrow" style={{ marginBottom: 10 }}>
        <span className="note">Contacted — what the tools and the call log actually did</span>
        <div className="seg">
          <a href={href({ reached: null })} className={!reached ? "on" : ""}>All ({num(f("reached", "all"))})</a>
          <a href={href({ reached: "yes" })} className={reached === "yes" ? "on" : ""}>contacted ({num(f("reached", "yes"))})</a>
          <a href={href({ reached: "no" })} className={reached === "no" ? "on" : ""}>never ({num(f("reached", "no"))})</a>
        </div>
        <a className="choice" href={href({ can: canReach === true ? null : true })}>
          {canReach === true ? "Show everyone" : "Only people I can contact"}
        </a>
      </div>

      <div className="segrow" style={{ marginBottom: 16 }}>
        <span className="note">Status — typed on the source spreadsheet, not the tools</span>
        <div className="seg">
          <a href={href({ status: null })} className={!status ? "on" : ""}>All ({num(f("status", "all"))})</a>
          {STATUSES.map((s) => (
            <a key={s} href={href({ status: s })} className={status === s ? "on" : ""}>
              {s.replace(/_/g, " ")} ({num(f("status", s))})
            </a>
          ))}
        </div>
      </div>

      <h2 style={{ marginBottom: 6 }}>
        {num(shown)} {shown === 1 ? "person" : "people"}
        {filtered ? "" : " — everyone"}
      </h2>
      <p className="sub" style={{ marginTop: 0 }}>
        {[
          channel ? `from ${CHANNELS[channel]}` : null,
          selSlugs.length ? selSlugs.map((s) => bySlug.get(s).display_name).join(" + ") : null,
          reached === "yes" ? "contacted" : reached === "no" ? "never contacted" : null,
          canReach === true ? "with a phone or an email" : canReach === false ? "with no phone and no email" : null,
          status ? `marked ${status.replace(/_/g, " ")}` : null,
          search ? `matching “${search}”` : null,
        ].filter(Boolean).join(" · ") || "No filters — this is the whole list."}
        {pages > 1 ? ` · page ${page} of ${num(pages)}` : ""}
      </p>

      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th style={{ textAlign: "left" }}>How to reach them</th>
              <th style={{ textAlign: "left" }}>Company</th>
              <th style={{ textAlign: "left" }}>Which list</th>
              <th style={{ textAlign: "left" }} title="What we have actually done — the tools and the call log, not the spreadsheet">
                Contacted
              </th>
              <th title="Typed on a source spreadsheet. Blank means they were never on one.">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <tr key={r.person_key}>
                <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {(page - 1) * PAGE + i + 1}
                </td>
                <td className="name">
                  <PersonLink email={r.email} name={r.name} fallback="no name" />
                  {r.dnc ? <div className="dim" style={{ fontSize: 12 }}>do not call</div> : null}
                  {r.name_twin ? (
                    <div className="dim" style={{ fontSize: 12 }} title="Same name on both sides, no shared email — a human has to decide">
                      possible duplicate
                    </div>
                  ) : null}
                </td>
                <td className="dim" style={{ textAlign: "left" }}>
                  {r.phone ? <div>{r.phone}</div> : null}
                  {r.email ? (
                    <div title={r.email_is_shared ? "A firm mailbox, not this person's own address" : undefined}>
                      {r.email}{r.email_is_shared ? " · firm mailbox" : ""}
                    </div>
                  ) : null}
                  {/* A blank, not a dash: "we have no way to reach this person"
                      is a fact worth reading as a sentence. 1,162 of them. */}
                  {!r.phone && !r.email ? <span>no phone, no email</span> : null}
                </td>
                <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                <td className="dim" style={{ textAlign: "left" }}>
                  {nameOfList.get(r.group_id) ?? nameOfList.get(r.call_campaign_id) ?? "—"}
                  {r.buildings_count ? (
                    <div style={{ fontSize: 12 }}>{num(r.buildings_count)} buildings</div>
                  ) : null}
                </td>
                <td style={{ textAlign: "left" }}>
                  {r.first_contacted_at ? (
                    <div>
                      <span className="pill p-running">emailed</span>{" "}
                      <span className="dim">{prettyWhen(r.first_contacted_at)}</span>
                    </div>
                  ) : null}
                  {r.calls ? (
                    <div>
                      <Pill status={r.call_outcome} />{" "}
                      <span className="dim">
                        {num(r.calls)} call{r.calls === 1 ? "" : "s"} · {prettyDate(r.last_call_date)}
                      </span>
                    </div>
                  ) : null}
                  {r.callback_date && !r.first_contacted_at ? (
                    <div className="dim">call back {prettyDate(r.callback_date)}</div>
                  ) : null}
                  {!r.first_contacted_at && !r.calls ? <span className="dim">not yet</span> : null}
                </td>
                {/* Null is not a status. Somebody the tools know who was never on
                    a source spreadsheet has no imported pipeline state, and
                    inventing one for them would be the whole bug again. */}
                <td>{r.status ? <Pill status={r.status} /> : <span className="dim">—</span>}</td>
              </tr>
            ))}
            {!rows?.length ? (
              <tr><td colSpan={7} className="empty">Nobody matches this filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="segrow" style={{ marginTop: 14 }}>
          <span className="note">
            {num((page - 1) * PAGE + 1)}–{num(Math.min(page * PAGE, shown))} of {num(shown)}
          </span>
          <div className="seg">
            {page > 1 ? <a href={href({ page: page - 1 })}>&larr; previous</a> : null}
            {page < pages ? <a href={href({ page: page + 1 })}>next &rarr;</a> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
