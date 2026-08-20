import { db, num, prettyDate, prettyWhen } from "../../lib/db";
import { Tile, Pill, PersonLink } from "../../components/ui";
import FacetRail, { SoftLink, LeadSearch } from "../../components/facet-rail";

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
 * Every number here comes from `lead_facets` and the table from `lead_rows`,
 * two readers of one predicate written once in SQL. The page holds no filter
 * logic of its own, so a number and the list it opens cannot describe
 * different people — not because two people remembered to write the same
 * thing twice, but because there is only one of it.
 *
 * THE FILTERS LIVE IN A RAIL (20 Aug 2026). They were four segmented bars
 * stacked down the page — where from, which list, contacted, status — about
 * 190px of controls before the first lead, with the active state carried only
 * by which pill happened to be bold. They are one sticky column now: every
 * facet and every count on screen at once, nothing behind a menu, multi-select
 * reading as the checkboxes it always was. The queries did not change.
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
  const kindOfList = new Map(lists.map((l) => [l.id, l.kind]));

  const selSlugs = [...new Set((sp.list ?? "").split(",").filter((s) => bySlug.has(s)))];
  const selGroupIds = selSlugs.map((s) => bySlug.get(s)).filter((l) => l.kind === "group").map((l) => l.id);
  const selCallIds = selSlugs.map((s) => bySlug.get(s)).filter((l) => l.kind === "call").map((l) => l.id);

  const channel = CHANNELS[sp.ch] ? sp.ch : null;
  const status = STATUSES.includes(sp.status) ? sp.status : null;
  const reached = sp.reached === "yes" || sp.reached === "no" ? sp.reached : null;
  // Three states, because the "No way to contact" tile has to be able to open
  // its own 1,159 people: "yes" only the reachable, "no" only the unreachable,
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
  // Both halves of the reachability facet, so the rail can print the count
  // beside each choice rather than only beside the one you are not on.
  const reachableAll = total == null || uncontactableAll == null ? null : total - uncontactableAll;

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
  // A selected list that sits on the side the channel filter just excluded. It
  // is the only way this page can ask for an empty set on purpose, so the empty
  // state names it rather than shrugging.
  const clash = channel === "email" || channel === "call"
    ? selSlugs.map((s) => bySlug.get(s)).find((l) => (l.kind === "call") !== (channel === "call"))
    : null;

  /**
   * The rail, as data. Every row is a URL — the whole page is a URL, the same
   * contract the segmented bars had — and the row you are already on carries
   * the href that clears it, which is what a checkbox does and what four
   * "All (3,983)" buttons used to be for.
   */
  const row = (key, label, on, href, n, opts = {}) => ({ key, label, on, href, n: num(n), ...opts });

  const sections = [
    {
      key: "where",
      title: "Where they came from",
      clearHref: channel ? href({ ch: null }) : null,
      rows: [
        row("email", "email campaigns", channel === "email",
          href({ ch: channel === "email" ? null : "email" }), f("channel", "email"), { swatch: "var(--s1)" }),
        row("call", "call list", channel === "call",
          href({ ch: channel === "call" ? null : "call" }), f("channel", "call"), { swatch: "var(--violet)", violet: true }),
        row("both", "on both", channel === "both",
          href({ ch: channel === "both" ? null : "both" }), f("channel", "both"), { swatch: "var(--good)" }),
      ],
    },
    {
      key: "list",
      title: "Which list",
      clearHref: selSlugs.length ? listHrefFor(null) : null,
      // Every list, always — never filtered by its own count. A row that
      // disappears when it reads 0 takes the tick with it: pick NYC LL11, then
      // pick "email campaigns", and the list you were standing on is gone from
      // the rail while still in the URL. A zero is dim and still clickable, so
      // the way back stays visible.
      rows: lists.map((l) =>
        row(l.slug, l.display_name, selSlugs.includes(l.slug), listHrefFor(l.slug),
          f("list", l.id) ?? 0, { violet: l.kind === "call" })),
      // The lists sum to less than the total, and the gap is named rather than
      // left to be discovered: three people were rung before the call workspace
      // existed and belong to no list at all.
      foot: unlisted ? { label: "on no list", n: num(unlisted) } : null,
    },
    {
      key: "reached",
      title: "Contacted",
      hint: "What the tools and the call log actually did",
      clearHref: reached ? href({ reached: null }) : null,
      rows: [
        row("yes", "contacted", reached === "yes",
          href({ reached: reached === "yes" ? null : "yes" }), f("reached", "yes")),
        row("no", "never", reached === "no",
          href({ reached: reached === "no" ? null : "no" }), f("reached", "no")),
      ],
    },
    {
      key: "can",
      title: "Reachability",
      clearHref: canReach !== null ? href({ can: null }) : null,
      rows: [
        row("y", "has phone or email", canReach === true,
          href({ can: canReach === true ? null : true }), reachableAll),
        row("n", "no way to contact", canReach === false,
          href({ can: canReach === false ? null : false }), uncontactableAll),
      ],
    },
    {
      key: "status",
      title: "Status",
      hint: "Typed on a source spreadsheet, not by the tools",
      clearHref: status ? href({ status: null }) : null,
      rows: STATUSES.map((st) =>
        row(st, st.replace(/_/g, " "), status === st,
          href({ status: status === st ? null : st }), f("status", st) ?? 0)),
    },
  ];

  // Buildings carried is the strategic number on the call side — the top 32
  // engineers reach half the city — so it gets a bar, scaled to the biggest on
  // the page rather than to a hardcoded ceiling.
  const maxBldgs = Math.max(1, ...(rows ?? []).map((r) => r.buildings_count ?? 0));

  return (
    <>
      <div className="rise">
        <h1>Leads</h1>
        <p className="sub">
          Every human we know, <strong>one row each</strong> — {num(emailSide)} from the email
          campaigns and {num(callSide)} on the call list, which is here whether or not anyone has
          dialled them yet. Two different questions sit side by side:{" "}
          <strong>contacted</strong> is what the tools and the call log actually did,{" "}
          <strong>status</strong> is a column typed on a source spreadsheet. They disagree, and
          crossing them is one click in the rail.
        </p>
      </div>

      <div className="grid g5">
        <Tile
          hero
          label="People"
          value={num(total)}
          raw={total}
          note={`${num(emailSide)} emailed or targeted · ${num(callSide)} on the call list`}
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

      <div className="leadsplit">
        <FacetRail sections={sections} filtered={filtered} />

        <div>
          {/* Keeps every other filter on when you search: `base` is this page's
              own URL, and only `q` is replaced on it. */}
          <LeadSearch base={href({ page: 1 })} defaultValue={sp.q ?? ""} />

          {/* What the rail is currently asking, as one sentence — so the answer
              above the table and the ticks beside it can never read differently. */}
          <div className="resline">
            <b>{num(shown)} {shown === 1 ? "person" : "people"}</b>
            {[
              channel ? `from ${CHANNELS[channel]}` : null,
              selSlugs.length ? selSlugs.map((s) => bySlug.get(s).display_name).join(" + ") : null,
              reached === "yes" ? "contacted" : reached === "no" ? "never contacted" : null,
              canReach === true ? "with a phone or an email"
                : canReach === false ? "with no phone and no email" : null,
              status ? `marked ${status.replace(/_/g, " ")}` : null,
              search ? `matching “${search}”` : null,
              filtered ? null : "no filters — this is everyone",
              pages > 1 ? `page ${page} of ${num(pages)}` : null,
            ].filter(Boolean).map((part, i) => (
              <span key={i}><span className="sep">·</span> {part}</span>
            ))}
            {filtered ? <SoftLink className="rst" href="/leads" style={{ marginLeft: "auto" }}>clear all</SoftLink> : null}
          </div>

          <div className="card tw" style={{ marginBottom: 0 }}>
            <table className="leadtable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>How to reach them</th>
                  <th>Company</th>
                  <th>Which list</th>
                  <th title="What we have actually done — the tools and the call log, not the spreadsheet">
                    Contacted
                  </th>
                  <th title="Typed on a source spreadsheet. Blank means they were never on one.">Status</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r, i) => {
                  const listId = r.group_id ?? r.call_campaign_id;
                  const kind = kindOfList.get(listId);
                  return (
                    <tr key={r.person_key}>
                      <td className="idx">{(page - 1) * PAGE + i + 1}</td>
                      <td>
                        <div className="who">
                          <PersonLink email={r.email} name={r.name} fallback="no name" />
                        </div>
                        {r.title ? <div className="said">{r.title}</div> : null}
                        {r.dnc ? <div className="said" style={{ color: "var(--crit)" }}>do not call</div> : null}
                        {r.name_twin ? (
                          <div className="said" title="Same name on both sides, no shared email — a human has to decide">
                            possible duplicate
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {r.phone ? <div className="mono">{r.phone}</div> : null}
                        {r.email ? (
                          <div className="mono" title={r.email_is_shared ? "A firm mailbox, not this person's own address" : undefined}>
                            {r.email}
                          </div>
                        ) : null}
                        {r.email_is_shared ? <div className="said">firm mailbox</div> : null}
                        {/* A sentence, not a dash: "we have no way to reach this
                            person" is a fact worth reading. 1,159 of them. */}
                        {!r.phone && !r.email ? <span className="said">no phone, no email</span> : null}
                      </td>
                      <td>{r.company || <span className="dim">—</span>}</td>
                      <td>
                        {listId ? (
                          <span className={`pill ${kind === "call" ? "p-list_call" : "p-list_email"}`}>
                            {nameOfList.get(listId)}
                          </span>
                        ) : <span className="dim">—</span>}
                        {r.buildings_count ? (
                          <>
                            <div className="said">{num(r.buildings_count)} buildings</div>
                            <div className="bldgbar">
                              <i style={{ width: `${(r.buildings_count / maxBldgs) * 100}%` }} />
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td>
                        {r.first_contacted_at ? (
                          <div>
                            <span className="pill p-emailed">emailed</span>
                            <div className="said">{prettyWhen(r.first_contacted_at)}</div>
                          </div>
                        ) : null}
                        {r.calls ? (
                          <div style={{ marginTop: r.first_contacted_at ? 6 : 0 }}>
                            <Pill status={r.call_outcome} />
                            <div className="said">
                              {num(r.calls)} call{r.calls === 1 ? "" : "s"} · {prettyDate(r.last_call_date)}
                            </div>
                          </div>
                        ) : null}
                        {r.callback_date && !r.first_contacted_at ? (
                          <div className="said">call back {prettyDate(r.callback_date)}</div>
                        ) : null}
                        {!r.first_contacted_at && !r.calls ? (
                          <span className="pill p-never_called">not yet</span>
                        ) : null}
                      </td>
                      {/* Null is not a status. Somebody the tools know who was
                          never on a source spreadsheet has no imported pipeline
                          state, and inventing one for them would be the bug. */}
                      <td>{r.status ? <Pill status={r.status} /> : <span className="dim">—</span>}</td>
                    </tr>
                  );
                })}
                {!rows?.length ? (
                  <tr><td colSpan={7} className="empty">
                    {clash
                      ? <>Nobody is both. <b>{clash.display_name}</b> is{" "}
                          {clash.kind === "call" ? "a phone list" : "an email campaign"}, and you have
                          asked for {CHANNELS[channel]} only —{" "}
                          <SoftLink className="rst" href={href({ ch: null })}>drop the channel filter</SoftLink> or{" "}
                          <SoftLink className="rst" href={listHrefFor(clash.slug)}>drop the list</SoftLink>.</>
                      : "Nobody matches this filter."}
                  </td></tr>
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
                {page > 1 ? <SoftLink href={href({ page: page - 1 })}>&larr; previous</SoftLink> : null}
                {page < pages ? <SoftLink href={href({ page: page + 1 })}>next &rarr;</SoftLink> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
