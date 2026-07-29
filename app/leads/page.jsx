import { db, num } from "../../lib/db";
import { Tile, Pill } from "../../components/ui";

export const dynamic = "force-dynamic";

const STATUSES = ["sent", "assigned", "prospect", "held", "no_email"];
const EMPTY_COUNTS = { total: 0, sent: 0, assigned: 0, prospect: 0, held: 0, no_email: 0 };

// PostgREST caps unbounded selects at its configured max rows, so counting via
// select().length silently truncates once `leads` grows past that — use exact
// head-counts instead, which read the Content-Range total, not the row body.
async function countWhere(filters) {
  let q = db.from("leads").select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

export default async function Leads({ searchParams }) {
  const sp = searchParams ?? {};

  const { data: groups } = await db
    .from("campaign_groups")
    .select("id, slug, display_name, sort_order")
    .order("sort_order");

  const [totalCount, groupCounts, statusCounts] = await Promise.all([
    countWhere({}),
    Promise.all((groups ?? []).map((g) => countWhere({ group_id: g.id }))),
    Promise.all(STATUSES.map((s) => countWhere({ status: s }))),
  ]);

  const countsByGroup = new Map((groups ?? []).map((g, i) => [g.id, groupCounts[i]]));
  const totalByStatus = STATUSES.reduce((acc, s, i) => {
    acc[s] = statusCounts[i];
    return acc;
  }, {});

  const bySlug = new Map((groups ?? []).map((g) => [g.slug, g]));
  const populatedGroups = (groups ?? []).filter((g) => countsByGroup.get(g.id));
  const activeGroup = bySlug.get(sp.group) ?? populatedGroups[0] ?? null;
  const activeStatus = STATUSES.includes(sp.status) ? sp.status : null;

  let rows = [];
  const gc = { ...EMPTY_COUNTS };
  if (activeGroup) {
    gc.total = countsByGroup.get(activeGroup.id) ?? 0;
    const statusBreakdown = await Promise.all(
      STATUSES.map((s) => countWhere({ group_id: activeGroup.id, status: s }))
    );
    STATUSES.forEach((s, i) => { gc[s] = statusBreakdown[i]; });

    let q = db
      .from("leads")
      .select("id, name, email, company, title, status, email_quality, source_list")
      .eq("group_id", activeGroup.id)
      .order("name")
      .limit(1000);
    if (activeStatus) q = q.eq("status", activeStatus);
    const { data } = await q;
    rows = data ?? [];
  }

  return (
    <>
      <h1>Leads</h1>
      <p className="sub">
        Every targeted person across the priority campaigns, tagged by whether they&rsquo;ve actually
        been sent to &mdash; reconciled against live Instantly/lemlist data, not just the source
        spreadsheets.
      </p>

      <div className="grid g4">
        <Tile hero label="Total people" value={num(totalCount)} note={`${populatedGroups.length} campaign groups`} />
        <Tile
          plus
          label="Sent"
          value={num(totalByStatus.sent)}
          tone={totalByStatus.sent ? "" : "muted"}
          note="Confirmed in Instantly/lemlist"
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

      <div className="seg" style={{ marginBottom: 20 }}>
        {populatedGroups.map((g) => (
          <a key={g.id} href={`/leads?group=${g.slug}`} className={activeGroup?.id === g.id ? "on" : ""}>
            {g.display_name} ({num(countsByGroup.get(g.id) ?? 0)})
          </a>
        ))}
      </div>

      {activeGroup ? (
        <>
          <h2>{activeGroup.display_name}</h2>
          <div className="seg" style={{ marginBottom: 14 }}>
            <a href={`/leads?group=${activeGroup.slug}`} className={!activeStatus ? "on" : ""}>
              All ({num(gc.total)})
            </a>
            {STATUSES.map((s) => (
              <a
                key={s}
                href={`/leads?group=${activeGroup.slug}&status=${s}`}
                className={activeStatus === s ? "on" : ""}
              >
                {s.replace(/_/g, " ")} ({num(gc[s] ?? 0)})
              </a>
            ))}
          </div>

          <div className="card tw">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Company</th>
                  <th style={{ textAlign: "left" }}>Title</th>
                  <th>Status</th>
                  <th>Email quality</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="name">{r.name || "—"}</td>
                    <td className="dim" style={{ textAlign: "left" }}>{r.email || "—"}</td>
                    <td style={{ textAlign: "left" }}>{r.company || "—"}</td>
                    <td style={{ textAlign: "left" }}>{r.title || "—"}</td>
                    <td><Pill status={r.status} /></td>
                    <td className="dim">{r.email_quality || "—"}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={6} className="empty">No leads match this filter.</td></tr>
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
