import { db, num, pct, prettyDate, listHref } from "../../lib/db";
import { Seg, BounceCell, DrillCell, Num, Chev } from "../../components/ui";

export const dynamic = "force-dynamic";

const SORTS = [
  ["priority", "Priority"],
  ["reply", "Reply rate"],
  ["sent", "Volume"],
  ["risk", "Bounce risk"],
];

export default async function Campaigns({ searchParams }) {
  const sort = SORTS.some(([k]) => k === searchParams?.sort) ? searchParams.sort : "priority";

  const [{ data: groups }, { data: order }, { data: subs }] = await Promise.all([
    db.from("v_group_summary").select("*"),
    db.from("campaign_groups").select("id, sort_order"),
    db.from("v_campaign_summary").select("campaign_id, group_id, status, sent, bounced"),
  ]);

  const rank = new Map((order ?? []).map((g) => [g.id, g.sort_order ?? 100]));
  const subsOf = new Map();
  for (const s of subs ?? []) {
    if (!s.group_id) continue;
    if (!subsOf.has(s.group_id)) subsOf.set(s.group_id, []);
    subsOf.get(s.group_id).push(s);
  }

  // Bounce risk is the worst sub-campaign in the group, not the group average:
  // one poisoned list inside an otherwise healthy group is the thing to find.
  const riskOf = (g) =>
    Math.max(0, ...(subsOf.get(g.id) ?? []).filter((s) => s.sent > 40).map((s) => pct(s.bounced, s.sent) ?? 0));

  const list = [...(groups ?? [])].sort((a, b) => {
    if (sort === "reply") return (pct(b.replied, b.leads) ?? -1) - (pct(a.replied, a.leads) ?? -1);
    if (sort === "sent") return (b.sent ?? 0) - (a.sent ?? 0);
    if (sort === "risk") return riskOf(b) - riskOf(a);
    return (rank.get(a.id) ?? 100) - (rank.get(b.id) ?? 100);
  });

  const maxSent = Math.max(1, ...list.map((g) => g.sent ?? 0));
  const toolColor = (g) => ((g.platform ?? []).includes("instantly") ? "var(--s1)" : "var(--s2)");
  // "E1 d0 · E2 +7 · E3 +14" → 3. The timing string reads as noise; the count doesn't.
  const emailSteps = (g) => (g.sequence_shape?.match(/E\d+/g) ?? []).length || null;

  return (
    <>
      <div className="rise">
        <h1>Campaigns</h1>
        <p className="sub">
          Every campaign group, lifetime. Groups are derived from the campaign name up to the first
          em dash, and any grouping corrected by hand is never overwritten by the sync.
        </p>
      </div>

      <div className="segrow">
        <span className="note">Sort by</span>
        <Seg options={SORTS} current={sort} hrefFor={(k) => `/campaigns?sort=${k}`} />
      </div>

      {list.map((g, i) => {
        const mine = subsOf.get(g.id) ?? [];
        const counts = ["running", "paused", "draft", "completed"]
          .map((k) => [k, mine.filter((s) => s.status === k).length])
          .filter(([, n]) => n);
        const rate = pct(g.bounced, g.sent);
        const rr = pct(g.replied, g.leads);
        const status = (g.status ?? "unknown").replace(/_/g, " ");
        const drill = (metric) => listHref({ metric, range: "all", group: g.slug });

        return (
          <details
            className="gcard"
            key={g.id}
            open={i === 0}
            style={{ animationDelay: `${0.08 + i * 0.05}s` }}
          >
            <summary>
              <div className="ghead">
                <div className="title">
                  <div className="row">
                    <a className="nm" href={`/campaigns/${g.slug}`}>{g.display_name}</a>
                    <span className={`pill p-${g.status ?? "unknown"}`}>{status}</span>
                  </div>
                  <div className="byline">
                    {[
                      g.owner,
                      g.geography,
                      (g.platform ?? []).join(", ") || null,
                      `${g.campaign_count} campaign${g.campaign_count === 1 ? "" : "s"}`,
                      g.first_sent_on ? `${prettyDate(g.first_sent_on)} – ${prettyDate(g.last_sent_on)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>

                <div className="gstats">
                  <div><div className="k">Leads</div><div className="v" data-count={g.leads}>{num(g.leads)}</div></div>
                  <div><div className="k">Sent</div><div className="v" data-count={g.sent}>{num(g.sent)}</div></div>
                  <div>
                    <div className="k">Bounce</div>
                    <div className={`v${rate === null ? " dim" : rate > 5 ? " bad" : rate >= 2 ? " mid" : ""}`}>
                      {rate === null ? "—" : `${rate}%`}
                    </div>
                  </div>
                  <div>
                    <div className="k">Replies</div>
                    <div className={g.replied ? "v" : "v dim"} data-count={g.replied}>{num(g.replied)}</div>
                  </div>
                  <div>
                    <div className="k">Reply %</div>
                    <div className={`v${rr !== null && rr >= 3 ? " ok" : " dim"}`}>{rr === null ? "—" : `${rr}%`}</div>
                  </div>
                  <div>
                    <div className="k">Meetings</div>
                    <div className={g.meetings ? "v" : "v dim"}>{num(g.meetings)}</div>
                  </div>
                </div>
              </div>

              <div className="gfoot">
                <div className="gbar">
                  <div className="track">
                    <span
                      style={{
                        width: `${((g.sent - g.bounced) / maxSent) * 100}%`,
                        background: toolColor(g),
                        animationDelay: `${0.2 + i * 0.05}s`,
                      }}
                    />
                    <span
                      style={{
                        width: `${(g.bounced / maxSent) * 100}%`,
                        background: "var(--crit)",
                        animationDelay: `${0.2 + i * 0.05}s`,
                      }}
                    />
                  </div>
                  <div className="note">
                    <span className="sw" style={{ background: toolColor(g) }} />
                    {num(g.sent - g.bounced)} sent minus bounces ·{" "}
                    <span className="sw" style={{ background: "var(--crit)" }} />
                    {num(g.bounced)} bounced · {num(g.delivered)} delivered · {num(g.replied)} replied
                  </div>
                </div>
                <span className="ghost">Detail<Chev /></span>
                <a className="solid" href={`/campaigns/${g.slug}`}>Open &rarr;</a>
              </div>
            </summary>

            <div className="gbody">
              <div className="inner">
                {g.description ? <p className="desc">{g.description}</p> : null}

                <div className="meta" style={{ marginBottom: 18 }}>
                  <div><div className="k">Tools</div><div className="v">{(g.platform ?? []).join(", ") || "—"}</div></div>
                  <div><div className="k">Geography</div><div className="v">{g.geography ?? "—"}</div></div>
                  <div><div className="k">Owner</div><div className="v">{g.owner ?? "—"}</div></div>
                  <div><div className="k">Emails in sequence</div><div className="v">{emailSteps(g) ?? "—"}</div></div>
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
                          {counts.map(([k, n]) => `${n} ${k}`).join(" · ") || "—"}
                        </td>
                        <DrillCell v={g.leads} href={`/campaigns/${g.slug}#people`} />
                        <DrillCell v={g.sent} href={drill("sent")} />
                        <Num v={g.delivered} />
                        <DrillCell v={g.bounced} href={drill("bounced")} />
                        <BounceCell bounced={g.bounced} base={g.sent} />
                        <DrillCell v={g.opened} href={drill("opened")} />
                        <DrillCell v={g.replied} href={drill("replied")} />
                        <td className={rr !== null && rr >= 3 ? "ok" : "zero"}>{rr === null ? "—" : `${rr}%`}</td>
                        <DrillCell v={g.linkedin_accepted} href={drill("linkedin_accepted")} />
                        <DrillCell v={g.meetings} href={drill("meetings")} />
                        <DrillCell v={g.proposals} href={drill("proposals")} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}
