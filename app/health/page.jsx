import { db, num, pct, today, dailyRange, prettyWhen } from "../../lib/db";
import { Num, Pill } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function Health() {
  const t = today();
  const [{ data: accounts }, { data: runs }, { data: campaigns }, rows] = await Promise.all([
    db.from("email_accounts").select("*").order("email"),
    db.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(12),
    db.from("v_campaign_summary").select("*"),
    dailyRange(t, t),
  ]);

  const sentToday = new Map();
  for (const r of rows) sentToday.set(r.campaign_id, (sentToday.get(r.campaign_id) ?? 0) + (r.sent ?? 0));

  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const capTotal = running.reduce((a, c) => a + (c.daily_limit ?? 0), 0);
  const sentTotal = [...sentToday.values()].reduce((a, b) => a + b, 0);

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
        <div className="tile"><div className="lbl">Sent today</div><div className="val">{num(sentTotal)}</div>
          <div className="note">against a configured cap of {num(capTotal)}</div></div>
        <div className="tile"><div className="lbl">Running campaigns</div><div className="val">{running.length}</div></div>
        <div className="tile"><div className="lbl">Mailboxes</div><div className="val">{(accounts ?? []).length}</div>
          <div className="note">{byDomain.size} domains</div></div>
        <div className="tile"><div className="lbl">Last sync</div>
          <div className="val" style={{ fontSize: 20 }}>{runs?.[0] ? prettyWhen(runs[0].finished_at ?? runs[0].started_at) : "never"}</div>
          <div className="note">{runs?.[0]?.status ?? "—"} · {runs?.[0]?.mode ?? ""}</div></div>
      </div>

      <h2>Capacity — configured cap against what actually went out today</h2>
      <div className="card tw">
        <table>
          <thead><tr><th>Campaign</th><th>Tool</th><th>Status</th><th>Cap/day</th><th>Sent today</th><th>Used</th></tr></thead>
          <tbody>
            {running.sort((a, b) => (b.daily_limit ?? 0) - (a.daily_limit ?? 0)).map((c) => {
              const s = sentToday.get(c.campaign_id) ?? 0;
              const used = c.daily_limit ? pct(s, c.daily_limit) : null;
              return (
                <tr key={c.campaign_id}>
                  <td className="name"><a href={`/c/${c.campaign_id}`}>{c.sub_campaign_label || c.name}</a></td>
                  <td className="dim">{c.source}</td>
                  <td><Pill status={c.status} /></td>
                  <td className="dim">{c.daily_limit ?? "—"}</td>
                  <Num v={s} />
                  <td className={used === null ? "zero" : used < 25 ? "mid" : ""}>{used === null ? "—" : `${used}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
