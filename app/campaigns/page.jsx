import { db, num, pct, listHref } from "../../lib/db";
import { Num, BounceCell, DrillCell } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function Campaigns() {
  const { data: groups } = await db
    .from("v_group_summary").select("*");
  const { data: order } = await db
    .from("campaign_groups").select("id, sort_order");
  const rank = new Map((order ?? []).map((g) => [g.id, g.sort_order ?? 100]));
  const list = (groups ?? []).sort((a, b) => (rank.get(a.id) ?? 100) - (rank.get(b.id) ?? 100));

  return (
    <>
      <h1>Campaigns</h1>
      <p className="sub">
        Every campaign group, lifetime. Groups are derived from the campaign name up to the first
        em dash, and any grouping corrected by hand is never overwritten by the sync.
      </p>

      {list.map((g) => (
        <div className="card" key={g.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "baseline", flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <a href={`/campaigns/${g.slug}`} style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>
                {g.display_name}
              </a>
              {g.description ? <div className="dim" style={{ fontSize: 13, marginTop: 3, maxWidth: "70ch" }}>{g.description}</div> : null}
            </div>
            <span className={`pill p-${g.status}`}>{(g.status ?? "").replace(/_/g, " ")}</span>
          </div>

          <div className="meta" style={{ marginBottom: 16 }}>
            <div><div className="k">Tools</div><div className="v">{(g.platform ?? []).join(", ") || "—"}</div></div>
            <div><div className="k">Geography</div><div className="v">{g.geography ?? "—"}</div></div>
            <div><div className="k">Segment</div><div className="v">{g.segment ?? "—"}</div></div>
            <div><div className="k">Owner</div><div className="v">{g.owner ?? "—"}</div></div>
            <div><div className="k">Sequence</div><div className="v">{g.sequence_shape ?? "—"}</div></div>
            <div><div className="k">List source</div><div className="v">{g.list_source ?? "—"}</div></div>
          </div>

          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Sub-campaigns</th><th>Leads</th><th>Sent</th><th>Delivered</th>
                  <th>Bounced</th><th>Bounce %</th><th>Opened</th><th>Replies</th>
                  <th>Reply %</th><th>LI acc.</th><th>Meetings</th><th>Proposals</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="name">
                    {g.running_count} running
                    {g.paused_count ? ` · ${g.paused_count} paused` : ""}
                    {g.draft_count ? ` · ${g.draft_count} draft` : ""}
                  </td>
                  <DrillCell v={g.leads} href={`/campaigns/${g.slug}#people`} />
                  <DrillCell v={g.sent} href={listHref({ metric: "sent", range: "all", group: g.slug })} />
                  <Num v={g.delivered} />
                  <DrillCell v={g.bounced} href={listHref({ metric: "bounced", range: "all", group: g.slug })} />
                  <BounceCell bounced={g.bounced} base={g.sent} />
                  <DrillCell v={g.opened} href={listHref({ metric: "opened", range: "all", group: g.slug })} />
                  <DrillCell v={g.replied} href={listHref({ metric: "replied", range: "all", group: g.slug })} />
                  <td className={g.leads && pct(g.replied, g.leads) >= 3 ? "ok" : "zero"}>
                    {g.leads ? `${pct(g.replied, g.leads)}%` : "—"}
                  </td>
                  <DrillCell v={g.linkedin_accepted} href={listHref({ metric: "linkedin_accepted", range: "all", group: g.slug })} />
                  <DrillCell v={g.meetings} href={listHref({ metric: "meetings", range: "all", group: g.slug })} />
                  <DrillCell v={g.proposals} href={listHref({ metric: "proposals", range: "all", group: g.slug })} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
