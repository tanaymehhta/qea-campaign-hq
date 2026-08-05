import "./inbound.css";
import { prettyWhen, num } from "../../lib/db";
import { inboundOverview, latestByStage, STAGES, money } from "../../lib/inbound";

export const dynamic = "force-dynamic";

const STAGE_MARK = { ok: "ok", needs_review: "review", error: "error",
                     running: "running", cancelled: "killed" };

function StageDot({ run }) {
  if (!run) return <span className="pill dim">—</span>;
  const s = run.status ?? "unknown";
  const cls = s === "ok" ? "ok" : s === "error" ? "bad" : s === "running" ? "" : "warn";
  return <span className={`pill ${cls}`}>{STAGE_MARK[s] ?? s}</span>;
}

export default async function Inbound() {
  const { companies, events, runsByCompany } = await inboundOverview();

  const researched = companies.filter((c) => c.research_status !== "new");
  const waiting = companies.filter((c) => c.research_status === "new");
  const totalCost = [...runsByCompany.values()].flat()
    .reduce((a, r) => a + Number(r.total_cost_usd ?? 0), 0);

  return (
    <>
      <h1>Inbound</h1>
      <p className="sub">
        Website visitors identified by RB2B, researched into an account, a contact list and a
        first email. Read-only: nothing here starts, stops or approves a run. Every number is
        what the pipeline actually recorded, including the runs that went wrong.
      </p>

      <div className="grid g4">
        <div className="tile plus"><div className="lbl">Companies seen</div>
          <div className="val">{num(companies.length)}</div>
          <div className="note">{num(waiting.length)} awaiting research</div></div>
        <div className="tile plus"><div className="lbl">RB2B events</div>
          <div className="val">{num(events.length)}</div>
          <div className="note">most recent {events[0] ? prettyWhen(events[0].received_at) : "—"}</div></div>
        <div className="tile plus"><div className="lbl">Researched</div>
          <div className="val">{num(researched.length)}</div>
          <div className="note">{num(companies.filter((c) => c.needs_human_review).length)} flagged for review</div></div>
        <div className="tile plus"><div className="lbl">Pipeline spend</div>
          <div className="val">{money(totalCost)}</div>
          <div className="note">LLM + search, all runs shown</div></div>
      </div>

      <h2>New from RB2B</h2>
      <p className="sub">
        Every webhook POST, newest first. A visitor becomes a company here and nothing else
        happens automatically — research is triggered separately.
      </p>
      <div className="ib-scroll">
        <table>
          <thead>
            <tr><th>Received</th><th>Person</th><th>Title</th><th>Company</th>
              <th>Page</th><th>Parse</th><th>Linked</th></tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const r = e.raw ?? {};
              const name = [r["First Name"], r["Last Name"]].filter(Boolean).join(" ");
              return (
                <tr key={e.id}>
                  <td className="dim">{prettyWhen(e.received_at)}</td>
                  <td>{name || <span className="dim">—</span>}</td>
                  <td className="dim">{r["Title"] ?? "—"}</td>
                  <td>{r["Company Name"] ?? <span className="dim">—</span>}</td>
                  <td className="dim">{(r["Captured URL"] ?? "").replace(/^https?:\/\//, "") || "—"}</td>
                  <td>
                    <span className={`pill ${e.parse_status === "ok" ? "ok" : "bad"}`}>
                      {e.parse_status ?? "—"}
                    </span>
                    {e.error ? <div className="ib-err">{e.error}</div> : null}
                  </td>
                  <td>
                    {e.company_id
                      ? <a href={`/inbound/${e.company_id}`}>open</a>
                      : <span className="dim">not linked</span>}
                  </td>
                </tr>
              );
            })}
            {!events.length && (
              <tr><td colSpan={7} className="empty">No webhook events yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Accounts</h2>
      <p className="sub">
        One row per company, with where it got to in the three stages. Click through for the
        node-by-node trace and every output.
      </p>
      <div className="ib-scroll">
        <table>
          <thead>
            <tr>
              <th>Company</th><th>Vertical</th><th>Type</th>
              {STAGES.map((s) => <th key={s.no}>{s.no}. {s.label.split(" ")[0]}</th>)}
              <th>Cost</th><th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const runs = runsByCompany.get(c.id) ?? [];
              const byStage = latestByStage(runs);
              const cost = runs.reduce((a, r) => a + Number(r.total_cost_usd ?? 0), 0);
              return (
                <tr key={c.id}>
                  <td>
                    <a href={`/inbound/${c.id}`}>{c.name}</a>
                    {c.needs_human_review
                      ? <span className="pill warn" style={{ marginLeft: 6 }}>review</span> : null}
                    <div className="dim">{c.domain}</div>
                  </td>
                  <td className="dim">{c.vertical ?? "—"}</td>
                  <td className="dim">{c.account_type ?? c.research_status}</td>
                  {STAGES.map((s) => (
                    <td key={s.no}><StageDot run={byStage.get(s.no)} /></td>
                  ))}
                  <td className="dim">{cost ? money(cost) : "—"}</td>
                  <td className="dim">{c.last_visited_at ? prettyWhen(c.last_visited_at) : "—"}</td>
                </tr>
              );
            })}
            {!companies.length && (
              <tr><td colSpan={8} className="empty">No companies yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
