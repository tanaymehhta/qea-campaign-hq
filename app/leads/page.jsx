import { db, num, prettyWhen } from "../../lib/db";
import { Tile, Pill, PersonLink, ShareDonut } from "../../components/ui";

export const dynamic = "force-dynamic";

const STATUSES = ["sent", "assigned", "prospect", "held", "no_email"];
const EMPTY_COUNTS = { total: 0, sent: 0, assigned: 0, prospect: 0, held: 0, no_email: 0, none: 0 };

// PostgREST caps unbounded selects at its configured max rows, so counting via
// select().length silently truncates once the list grows past that — use exact
// head-counts instead, which read the Content-Range total, not the row body.
//
// Every read on this page goes to `v_leads`, not `leads`. The table is a frozen
// spreadsheet import — 1,950 rows, newest 28 July, no writer anywhere in this
// repo — while `people` is synced every half hour. The view is the live rows
// plus the 24 who only ever existed on a spreadsheet. See the migration.
async function countWhere(filters) {
  let q = db.from("v_leads").select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

/** Head-count across a set of groups — the multi-select needs an in-list, not an eq. */
async function countIn(groupIds, status, reached = null) {
  let q = db.from("v_leads").select("*", { count: "exact", head: true }).in("group_id", groupIds);
  if (status) q = q.eq("status", status);
  if (reached === "yes") q = q.not("first_contacted_at", "is", null);
  if (reached === "no") q = q.is("first_contacted_at", null);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Reached out or not — the tools' answer, not the spreadsheet's.
 *
 * `status = 'sent'` is a human column typed on a source file: 49 rows carry it
 * with no send in either tool, and 906 people with a real send do not carry it.
 * `first_contacted_at` is written by the sync from what Instantly and lemlist
 * actually did, and it is the same column the Overview's People reached counts,
 * so the two pages cannot disagree about who has been emailed.
 */
async function countReached(groupIds, reached, status = null) {
  let q = db.from("v_leads").select("*", { count: "exact", head: true });
  if (groupIds?.length) q = q.in("group_id", groupIds);
  if (status) q = q.eq("status", status);
  q = reached ? q.not("first_contacted_at", "is", null) : q.is("first_contacted_at", null);
  const { count } = await q;
  return count ?? 0;
}

export default async function Leads({ searchParams }) {
  const sp = searchParams ?? {};

  const { data: groups } = await db
    .from("campaign_groups")
    .select("id, slug, display_name, sort_order")
    .order("sort_order");

  const [totalCount, groupCounts, statusCounts, reachedTotal] = await Promise.all([
    countWhere({}),
    Promise.all((groups ?? []).map((g) => countWhere({ group_id: g.id }))),
    Promise.all(STATUSES.map((s) => countWhere({ status: s }))),
    countReached(null, true),
  ]);

  // Everyone the tools know who was never on a spreadsheet, so has no imported
  // status. 810 of them today. Counted rather than left as the gap between the
  // total and the four status tiles, which is how it would go unnoticed.
  const noStatusTotal = totalCount - statusCounts.reduce((a, n) => a + n, 0);

  const countsByGroup = new Map((groups ?? []).map((g, i) => [g.id, groupCounts[i]]));
  const totalByStatus = STATUSES.reduce((acc, s, i) => {
    acc[s] = statusCounts[i];
    return acc;
  }, {});

  const bySlug = new Map((groups ?? []).map((g) => [g.slug, g]));
  const populatedGroups = (groups ?? []).filter((g) => countsByGroup.get(g.id));

  // ?group=slug1,slug2 — a set, not a single pick. No selection means all of them.
  const selSlugs = [...new Set((sp.group ?? "").split(",").filter((s) => bySlug.has(s)))];
  const activeGroups = selSlugs.length ? selSlugs.map((s) => bySlug.get(s)) : populatedGroups;
  const allSelected = !selSlugs.length;
  const activeStatus = STATUSES.includes(sp.status) ? sp.status : null;
  const activeReached = sp.reached === "yes" || sp.reached === "no" ? sp.reached : null;
  const activeIds = activeGroups.map((g) => g.id);

  // Clicking a group toggles it in or out of the set; "All" clears the set.
  const groupHref = (slug) => {
    const next = slug === null ? []
      : selSlugs.includes(slug) ? selSlugs.filter((s) => s !== slug)
      : [...selSlugs, slug];
    return next.length ? `/leads?group=${next.join(",")}` : "/leads";
  };
  const search = (sp.q ?? "").replace(/[,()%]/g, "").trim();
  const groupParam = selSlugs.length ? `group=${selSlugs.join(",")}` : null;
  // Every filter survives a click on any other one. `status` and `reached` are
  // different questions — the spreadsheet's and the tools' — and the whole
  // point of showing both is being able to cross them: "marked sent, never
  // actually emailed" is one click.
  const hrefWith = (over = {}) => {
    const q = new URLSearchParams();
    if (selSlugs.length) q.set("group", selSlugs.join(","));
    const st = "status" in over ? over.status : activeStatus;
    const rc = "reached" in over ? over.reached : activeReached;
    if (st) q.set("status", st);
    if (rc) q.set("reached", rc);
    if (search) q.set("q", search);
    const qs = q.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  let rows = [];
  const gc = { ...EMPTY_COUNTS };
  if (activeGroups.length) {
    // Each tab's number is what clicking it would show, with the *other*
    // filter still applied. A "reached 2,395" sitting above a list filtered to
    // "marked sent" would be a count and a list that are not the same pile —
    // the fault this whole dashboard has spent a week removing.
    const scopeTotal = activeGroups.reduce((a, g) => a + (countsByGroup.get(g.id) ?? 0), 0);
    gc.total = activeReached ? await countIn(activeIds, null, activeReached) : scopeTotal;
    const statusBreakdown = await Promise.all(
      STATUSES.map((s) => countIn(activeIds, s, activeReached))
    );
    STATUSES.forEach((s, i) => { gc[s] = statusBreakdown[i]; });
    gc.none = gc.total - statusBreakdown.reduce((a, n) => a + n, 0);

    [gc.reached, gc.unreached, gc.allReachedScope] = await Promise.all([
      countReached(activeIds, true, activeStatus),
      countReached(activeIds, false, activeStatus),
      // What the "All" tab above would show — this scope without the reached
      // filter, which is what clicking it clears. Reading `gc.total` here would
      // print the filtered number on a tab that removes the filter.
      activeStatus ? countIn(activeIds, activeStatus) : Promise.resolve(scopeTotal),
    ]);

    let q = db
      .from("v_leads")
      .select("id, name, email, company, title, status, email_quality, source_list, in_tools, first_contacted_at")
      .in("group_id", activeIds)
      .order("name")
      .limit(1000);
    if (activeStatus) q = q.eq("status", activeStatus);
    if (activeReached === "yes") q = q.not("first_contacted_at", "is", null);
    if (activeReached === "no") q = q.is("first_contacted_at", null);
    if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);
    const { data } = await q;
    rows = data ?? [];
  }

  return (
    <>
      <h1>Leads</h1>
      <p className="sub">
        Every targeted person across the priority campaigns, live from Instantly and lemlist,
        plus the handful who only ever existed on a source spreadsheet. <strong>Status is a
        human column</strong> &mdash; it came from those spreadsheets and describes a
        pipeline no tool reports, so anyone who was never on one shows &ldquo;&mdash;&rdquo;
        rather than a status invented for them.
      </p>

      <div className="grid g5">
        <Tile
          hero
          label="Total people"
          value={num(totalCount)}
          note={
            noStatusTotal
              ? `${populatedGroups.length} groups · ${num(noStatusTotal)} never on a source spreadsheet`
              : `${populatedGroups.length} campaign groups`
          }
        />
        <Tile
          hero
          label="Reached out"
          value={num(reachedTotal)}
          note={`Emailed at least once, both tools · ${num(totalCount - reachedTotal)} not yet`}
          href="/list?metric=contacted&range=all"
        />
        <Tile
          plus
          label="Marked sent"
          value={num(totalByStatus.sent)}
          tone={totalByStatus.sent ? "" : "muted"}
          // This is the human column off the source spreadsheets, and it is not
          // the same question as the tile beside it: 49 rows carry `sent` with
          // no send in either tool, and 906 people with a real send do not carry
          // it. Naming it "Confirmed in Instantly/lemlist", as it was until
          // today, made a spreadsheet look like vendor proof.
          note="Typed on the source spreadsheet — not the tools"
        />
        <Tile
          plus
          label="Not yet sent"
          value={num(totalByStatus.assigned + totalByStatus.prospect)}
          note="Assigned or prospect, no confirmed send"
        />
        <Tile
          plus
          label="Held / no email"
          value={num(totalByStatus.held + totalByStatus.no_email)}
          tone="muted"
          note="Excluded or unusable"
        />
      </div>

      <div className="segrow" style={{ marginBottom: 20 }}>
        <span className="note">Campaigns — pick several</span>
        <div className="seg">
          <a href={groupHref(null)} className={allSelected ? "on" : ""}>
            All ({num(totalCount)})
          </a>
          {populatedGroups.map((g) => (
            <a key={g.id} href={groupHref(g.slug)} className={!allSelected && selSlugs.includes(g.slug) ? "on" : ""}>
              {g.display_name} ({num(countsByGroup.get(g.id) ?? 0)})
            </a>
          ))}
        </div>
      </div>

      {activeGroups.length ? (
        <>
          <h2>
            {activeGroups.length === populatedGroups.length
              ? "All campaigns"
              : activeGroups.map((g) => g.display_name).join(" + ")}
          </h2>

          <form action="/leads" method="GET" className="searchbox" style={{ marginBottom: 14 }}>
            {selSlugs.length ? <input type="hidden" name="group" value={selSlugs.join(",")} /> : null}
            {activeStatus ? <input type="hidden" name="status" value={activeStatus} /> : null}
            {activeReached ? <input type="hidden" name="reached" value={activeReached} /> : null}
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              name="q"
              placeholder="Search name, email, or company…"
              defaultValue={sp.q ?? ""}
            />
          </form>

          {/* The tools' answer and the spreadsheet's, one above the other. They
              are different questions and they disagree — which is the point of
              being able to see both, and of not deriving either from the other. */}
          <div className="segrow" style={{ marginBottom: 10 }}>
            <span className="note">Reached out — what Instantly and lemlist actually did</span>
            <div className="seg">
              <a href={hrefWith({ reached: null })} className={!activeReached ? "on" : ""}>
                All ({num(gc.allReachedScope ?? gc.total)})
              </a>
              <a href={hrefWith({ reached: "yes" })} className={activeReached === "yes" ? "on" : ""}>
                reached ({num(gc.reached ?? 0)})
              </a>
              <a href={hrefWith({ reached: "no" })} className={activeReached === "no" ? "on" : ""}>
                not reached ({num(gc.unreached ?? 0)})
              </a>
            </div>
          </div>

          <div className="segrow" style={{ marginBottom: 14 }}>
            <span className="note">Status — typed on the source spreadsheet</span>
            <div className="seg">
            <a href={hrefWith({ status: null })} className={!activeStatus ? "on" : ""}>
              All ({num(gc.total)})
            </a>
            {STATUSES.map((s) => (
              <a
                key={s}
                href={hrefWith({ status: s })}
                className={activeStatus === s ? "on" : ""}
              >
                {s.replace(/_/g, " ")} ({num(gc[s] ?? 0)})
              </a>
            ))}
            </div>
          </div>

          {/* The whole selection, not the page: the counts come from head-counts
              above, so the picture matches the filter rather than the slice.
              Under 3 non-zero statuses the donut deliberately renders nothing
              (a 2-slice ring is a worse way of writing one number), so say the
              number instead of leaving a silent gap. */}
          <ShareDonut
            title={activeStatus ? "shown" : "leads"}
            items={[
              ...STATUSES.map((s) => ({ label: s, value: gc[s] ?? 0 })),
              // Without this slice the ring describes only the imported half and
              // looks like the whole list.
              { label: "no imported status", value: gc.none ?? 0 },
            ]}
            note={activeStatus ? `Filtered to ${activeStatus.replace(/_/g, " ")} — the ring is the whole selection.` : null}
          />
          {STATUSES.filter((s) => gc[s] > 0).length < 3 && gc.total ? (
            <p className="note" style={{ marginBottom: 14 }}>
              No breakdown ring for this selection —{" "}
              {STATUSES.filter((s) => gc[s] > 0)
                .map((s) => `${num(gc[s])} ${s.replace(/_/g, " ")}`)
                .join(" · ")}{" "}
              {STATUSES.filter((s) => gc[s] > 0).length === 1
                ? "is every lead here, so there is nothing to divide."
                : "are the only statuses here."}
            </p>
          ) : null}

          <div className="card tw">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Company</th>
                  <th style={{ textAlign: "left" }}>Title</th>
                  <th>Reached out?</th>
                  <th>Status</th>
                  <th>Email quality</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                    <td className="name"><PersonLink email={r.email} name={r.name} /></td>
                    <td className="dim" style={{ textAlign: "left" }}>{r.email || "—"}</td>
                    <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                    <td style={{ textAlign: "left" }}>{r.title || "—"}</td>
                    <td>
                      {r.first_contacted_at
                        ? <span className="pill p-running" title={`First emailed ${prettyWhen(r.first_contacted_at)}`}>yes</span>
                        : <span className="dim">not yet</span>}
                    </td>
                    {/* Null is not a status. Someone the tools know who was never
                        on a source spreadsheet has no imported pipeline state,
                        and inventing one would be the whole bug again. */}
                    <td>{r.status ? <Pill status={r.status} /> : <span className="dim">—</span>}</td>
                    <td className="dim">{r.email_quality || "—"}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={8} className="empty">No leads match this filter.</td></tr>
                ) : null}
                {/* PostgREST caps a response at 1,000 rows whatever .limit() asks
                    for. The counts above are exact — they read Content-Range, not
                    the body — so only this table is a slice, and it says so
                    rather than reading as the whole list. */}
                {rows.length >= 1000 ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      Showing the first {num(rows.length)} of {num(activeStatus ? (gc[activeStatus] ?? 0) : gc.total)}.
                      Narrow by campaign, status, or search to see the rest.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="empty">No leads imported yet.</p>
      )}
    </>
  );
}
