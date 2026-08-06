import { db, num, pct, today, dailyRange, prettyWhen } from "../../lib/db";
import { Num, Pill, Chev } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function Health() {
  const t = today();
  const [{ data: accounts }, { data: runs }, { data: campaigns }, rows, { data: drift }, { data: groupDrift }] = await Promise.all([
    db.from("email_accounts").select("*").order("email"),
    db.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(12),
    db.from("v_campaign_summary").select("*"),
    dailyRange(t, t),
    db.from("v_metric_drift").select("*").order("metric_date", { ascending: false }),
    db.from("v_group_status_drift").select("*"),
  ]);

  const sentToday = new Map();
  for (const r of rows) sentToday.set(r.campaign_id, (sentToday.get(r.campaign_id) ?? 0) + (r.sent ?? 0));

  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const capTotal = running.reduce((a, c) => a + (c.daily_limit ?? 0), 0);
  const sentTotal = [...sentToday.values()].reduce((a, b) => a + b, 0);

  // Capacity by parent group, mirroring the Campaigns page's group → sub drill-down.
  const byGroup = new Map();
  for (const c of running) {
    const key = c.group_id ?? "none";
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        key, slug: c.group_slug ?? null, name: c.group_name ?? "Ungrouped",
        cap: 0, sent: 0, tools: [], subs: [],
      });
    }
    const g = byGroup.get(key);
    g.cap += c.daily_limit ?? 0;
    g.sent += sentToday.get(c.campaign_id) ?? 0;
    if (c.source && !g.tools.includes(c.source)) g.tools.push(c.source);
    g.subs.push(c);
  }
  const capacityGroups = [...byGroup.values()].sort((a, b) => b.cap - a.cap);
  for (const g of capacityGroups) g.subs.sort((a, b) => (b.daily_limit ?? 0) - (a.daily_limit ?? 0));

  const byDomain = new Map();
  for (const a of accounts ?? []) {
    const d = a.domain ?? "—";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(a);
  }

  return (
    <>
      <h1>Health</h1>
      <p className="sub">
        Sending capacity, mailbox warmup, and whether the sync is actually running. This is where to
        look when volume drops and you need to know if it is a campaign problem or a mailbox problem.
      </p>

      <div className="grid g4">
        <div className="tile plus"><div className="lbl">Sent today</div><div className="val">{num(sentTotal)}</div>
          <div className="note">against a configured cap of {num(capTotal)}</div></div>
        <div className="tile plus"><div className="lbl">Running campaigns</div><div className="val">{running.length}</div></div>
        <div className="tile plus"><div className="lbl">Mailboxes</div><div className="val">{(accounts ?? []).length}</div>
          <div className="note">{byDomain.size} domains</div></div>
        <div className="tile plus"><div className="lbl">Last sync</div>
          <div className="val" style={{ fontSize: 20 }}>{runs?.[0] ? prettyWhen(runs[0].finished_at ?? runs[0].started_at) : "never"}</div>
          <div className="note">{runs?.[0]?.status ?? "—"} · {runs?.[0]?.mode ?? ""}</div></div>
      </div>

      <h2>Capacity — configured cap against what actually went out today</h2>
      <p className="sub" style={{ marginTop: -8 }}>
        One row per campaign, cap and sends summed across its sub-campaigns. Open a row for the
        per-sub-campaign split.
      </p>
      {capacityGroups.map((g, i) => {
        const used = g.cap ? pct(g.sent, g.cap) : null;
        return (
          <details className="mrow" key={g.key} open={i === 0} style={{ animationDelay: `${0.04 + i * 0.04}s` }}>
            <summary>
              <span className="meat">
                <span className="who">
                  {g.slug ? <a className="drilled" href={`/campaigns/${g.slug}`}>{g.name}</a> : g.name}
                </span>
                <span className="line">
                  {g.subs.length} running campaign{g.subs.length === 1 ? "" : "s"}
                  {g.tools.length ? ` · ${g.tools.join(", ")}` : ""}
                </span>
              </span>
              <span className="who" style={{ fontVariantNumeric: "tabular-nums" }}>
                {num(g.sent)} / {num(g.cap)}
              </span>
              <span className={used === null ? "when zero" : used < 25 ? "when mid" : "when"}>
                {used === null ? "—" : `${used}% used`}
              </span>
              <Chev />
            </summary>
            <div className="mbody"><div className="inner">
              <div className="tw">
                <table>
                  <thead><tr><th>Sub-campaign</th><th>Tool</th><th>Status</th><th>Cap/day</th><th>Sent today</th><th>Used</th></tr></thead>
                  <tbody>
                    {g.subs.map((c) => {
                      const s = sentToday.get(c.campaign_id) ?? 0;
                      const u = c.daily_limit ? pct(s, c.daily_limit) : null;
                      return (
                        <tr key={c.campaign_id}>
                          <td className="name"><a href={`/c/${c.campaign_id}`}>{c.sub_campaign_label || c.name}</a></td>
                          <td className="dim">{c.source}</td>
                          <td><Pill status={c.status} /></td>
                          <td className="dim">{c.daily_limit ?? "—"}</td>
                          <Num v={s} />
                          <td className={u === null ? "zero" : u < 25 ? "mid" : ""}>{u === null ? "—" : `${u}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div></div>
          </details>
        );
      })}

      <h2>Mailboxes</h2>
      <div className="card tw">
        <table>
          <thead><tr><th>Mailbox</th><th>Domain</th><th>Warmup</th><th>Score</th><th>Cap/day</th></tr></thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id}>
                <td className="name">{a.email}</td>
                <td className="dim" style={{ textAlign: "left" }}>{a.domain}</td>
                <td className={a.warmup_enabled ? "ok" : "zero"}>{a.warmup_enabled ? "on" : "off"}</td>
                <td className={a.warmup_score ? "" : "zero"}>{a.warmup_score ?? "—"}</td>
                <td className="dim">{a.daily_limit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Data integrity</h2>
      <p className="sub" style={{ marginTop: -8 }}>
        lemlist's tile counts (daily_metrics) are derived from the named-people table
        (activities) on every sync, so the two can no longer drift apart silently.
        This is the canary if that ever stops being true.
      </p>
      <div className="card tw">
        {!drift?.length ? (
          <p className="empty" style={{ padding: 0 }}>Clean — every lemlist tile count matches its named rows.</p>
        ) : (
          <table>
            <thead><tr><th style={{ textAlign: "left" }}>Campaign</th><th>Date</th>
              <th>Sent (tile / rows)</th><th>Bounced</th><th>LI sent</th><th>LI accepted</th></tr></thead>
            <tbody>
              {drift.map((d) => (
                <tr key={`${d.campaign_id}-${d.metric_date}`}>
                  <td className="name" style={{ textAlign: "left" }}>{d.name}</td>
                  <td className="dim">{d.metric_date}</td>
                  <td className={d.dm_sent !== d.act_sent ? "bad" : "dim"}>{d.dm_sent} / {d.act_sent}</td>
                  <td className={d.dm_bounced !== d.act_bounced ? "bad" : "dim"}>{d.dm_bounced} / {d.act_bounced}</td>
                  <td className={d.dm_linkedin_sent !== d.act_linkedin_sent ? "bad" : "dim"}>{d.dm_linkedin_sent} / {d.act_linkedin_sent}</td>
                  <td className={d.dm_linkedin_accepted !== d.act_linkedin_accepted ? "bad" : "dim"}>{d.dm_linkedin_accepted} / {d.act_linkedin_accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Group status</h2>
      <p className="sub" style={{ marginTop: -8 }}>
        A group's status is a hand-set label, never revisited once campaigns underneath it
        actually start sending. This is where a group left labelled &ldquo;planned&rdquo; or
        &ldquo;abandoned&rdquo; while it&rsquo;s really running would show up — like Canada
        &mdash; Justin&rsquo;s list did.
      </p>
      <div className="card tw">
        {!groupDrift?.length ? (
          <p className="empty" style={{ padding: 0 }}>Clean — no group is labelled planned/abandoned while actually sending.</p>
        ) : (
          <table>
            <thead><tr><th style={{ textAlign: "left" }}>Group</th><th>Labelled</th>
              <th>Running campaigns</th><th>Lifetime sent</th><th>First sent</th></tr></thead>
            <tbody>
              {groupDrift.map((g) => (
                <tr key={g.id}>
                  <td className="name" style={{ textAlign: "left" }}><a href={`/campaigns/${g.slug}`}>{g.display_name}</a></td>
                  <td className="bad">{g.stored_status}</td>
                  <td>{g.running_count} / {g.campaign_count}</td>
                  <Num v={g.sent} />
                  <td className="dim">{g.first_sent_on ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Sync log</h2>
      <div className="card tw">
        <table>
          <thead><tr><th>Started</th><th>Mode</th><th>Status</th><th>Rows</th><th>Window</th><th>Error</th></tr></thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id}>
                <td className="name">{prettyWhen(r.started_at)}</td>
                <td className="dim">{r.mode}</td>
                <td className={r.status === "ok" ? "ok" : r.status === "running" ? "dim" : "bad"}>{r.status}</td>
                <Num v={r.rows_upserted} />
                <td className="dim">{r.detail?.from ? `${r.detail.from} .. ${r.detail.to}` : "—"}</td>
                <td className="dim" style={{ textAlign: "left", whiteSpace: "normal" }}>{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
