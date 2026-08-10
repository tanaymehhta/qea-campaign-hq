import "./pipeline.css";
import { prettyWhen, num } from "../../lib/db";
import {
  inboundOverview, peopleOverview, researchOverview, latestByStage, STAGES, money,
} from "../../lib/pipeline";

export const dynamic = "force-dynamic";

const STAGE_MARK = { ok: "ok", needs_review: "review", error: "error",
                     running: "running", cancelled: "killed" };

function StageDot({ run }) {
  if (!run) return <span className="pill dim">—</span>;
  const s = run.status ?? "unknown";
  const cls = s === "ok" ? "ok" : s === "error" ? "bad" : s === "running" ? "" : "warn";
  return <span className={`pill ${cls}`}>{STAGE_MARK[s] ?? s}</span>;
}

const VIEWS = [
  ["company", "By company"],
  ["person", "By person"],
  ["research", "Research"],
];

export default async function Pipeline({ searchParams }) {
  const view = VIEWS.some(([k]) => k === searchParams?.view) ? searchParams.view : "company";
  const { companies, events, runsByCompany } = await inboundOverview();
  const pv = view === "person" ? await peopleOverview() : null;
  const rv = view === "research" ? await researchOverview() : null;

  const researched = companies.filter((c) => c.research_status !== "new");
  const waiting = companies.filter((c) => c.research_status === "new");
  const totalCost = [...runsByCompany.values()].flat()
    .reduce((a, r) => a + Number(r.total_cost_usd ?? 0), 0);

  return (
    <>
      <h1>Inbound pipeline</h1>
      <p className="sub">
        Whether each run worked, and what it cost. RB2B identifies a visitor, research builds
        the account, stage 2 finds the people, stage 3 drafts the email — this is the trace of
        those stages, stage by stage and node by node. Read-only: nothing here starts, stops
        or approves a run. The leads themselves are at <a href="/inbound">/inbound</a>.
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

      <div className="ib-tabs">
        {VIEWS.map(([k, l]) => (
          <a key={k} href={k === "company" ? "/pipeline" : `/pipeline?view=${k}`}
            className={view === k ? "on" : ""}>{l}</a>
        ))}
      </div>

      {view === "company" ? (
        <>
          <h2>Accounts</h2>
          <p className="sub">
            One row per company. Click through for the people, the research, and the drafts.
          </p>
          <div className="ib-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Company</th><th>Vertical</th><th>Type</th>
                  {STAGES.map((s) => <th key={s.no}>{s.no}. {s.label.split(" ")[0]}</th>)}
                  <th>Cost</th><th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => {
                  const runs = runsByCompany.get(c.id) ?? [];
                  const byStage = latestByStage(runs);
                  const cost = runs.reduce((a, r) => a + Number(r.total_cost_usd ?? 0), 0);
                  return (
                    <tr key={c.id}>
                      <td className="dim">{i + 1}</td>
                      <td>
                        <a href={`/pipeline/${c.id}`}>{c.name}</a>
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
                  <tr><td colSpan={9} className="empty">No companies yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {events.some((e) => e.parse_status !== "ok" || !e.company_id) ? (
            <p className="note" style={{ marginTop: 10 }}>
              {num(events.filter((e) => e.parse_status !== "ok").length)} of the last{" "}
              {num(events.length)} RB2B webhooks failed to parse and{" "}
              {num(events.filter((e) => e.parse_status === "ok" && !e.company_id).length)} parsed
              but aren&rsquo;t linked to a company yet — those visitors exist only in the raw
              event log until the pipeline links them.
            </p>
          ) : null}
        </>
      ) : null}

      {view === "person" ? (
        <>
          <h2>People</h2>
          <p className="sub">
            Everyone RB2B saw or research found, best fit first. Click a name for their dossier —
            who they are, why they&rsquo;re on the list, and their draft emails.
          </p>
          <div className="ib-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Name</th><th>Title</th><th>Company</th><th>Role</th>
                  <th>Fit</th><th>List</th><th>Email</th><th>Email status</th>
                  <th>Sendable</th><th>Drafts</th><th>Source</th><th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {pv.people.map((p, i) => {
                  const co = pv.companyById.get(p.company_id);
                  const v = pv.lastVisit.get(p.id);
                  const drafts = pv.draftCountOf(p);
                  return (
                    <tr key={p.id}>
                      <td className="dim">{i + 1}</td>
                      <td><a href={`/pipeline/person/${p.id}`}>{p.full_name || "—"}</a></td>
                      <td className="dim">{p.title ?? "—"}</td>
                      <td>{co ? <a href={`/pipeline/${co.id}`}>{co.name}</a> : <span className="dim">—</span>}</td>
                      <td className="dim">{p.role_bucket ?? "—"}</td>
                      <td className="dim">{p.fit_tier ?? "—"}</td>
                      <td className="dim">{p.list_status ?? "—"}</td>
                      <td className="dim">{p.email ?? "—"}</td>
                      <td>
                        {p.email_status
                          ? <span className={`pill ${p.email_status === "verified" ? "ok" : "warn"}`}>{p.email_status}</span>
                          : <span className="dim">—</span>}
                      </td>
                      <td>
                        {p.sendable
                          ? <span className="pill ok">yes</span>
                          : <span className="pill warn" title={p.sendable_reason ?? ""}>{p.sendable_reason ?? "no"}</span>}
                      </td>
                      <td className={drafts ? "" : "dim"}>{drafts || "—"}</td>
                      <td className="dim">{p.source}</td>
                      <td className="dim">
                        {v ? `${(v.captured_url ?? "").replace(/^https?:\/\//, "")} · ${prettyWhen(v.seen_at)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!pv.people.length && (
                  <tr><td colSpan={13} className="empty">No people yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {view === "research" ? (
        <>
          <h2>Research, per company</h2>
          <p className="sub">
            What the pipeline actually produced — not how it ran. Click a company for the full
            picture: buildings, compliance, signals, people and drafts.
          </p>
          <div className="ib-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Company</th><th>Vertical</th><th>Buildings</th>
                  <th>Compliance hits</th><th>Intent signals</th><th>Contacts</th>
                  <th>Sendable</th><th>Drafts</th><th>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => {
                  const n = (m) => m.get(c.id) ?? 0;
                  return (
                    <tr key={c.id}>
                      <td className="dim">{i + 1}</td>
                      <td>
                        <a href={`/pipeline/${c.id}`}>{c.name}</a>
                        <div className="dim">{c.domain}</div>
                      </td>
                      <td className="dim">{c.vertical ?? "—"}</td>
                      <td className={n(rv.buildings) ? "" : "dim"}>{num(n(rv.buildings))}</td>
                      <td className={n(rv.hits) ? "" : "dim"}>{num(n(rv.hits))}</td>
                      <td className={n(rv.signals) ? "" : "dim"}>{num(n(rv.signals))}</td>
                      <td className={n(rv.contacts) ? "" : "dim"}>{num(n(rv.contacts))}</td>
                      <td className={n(rv.sendable) ? "" : "dim"}>{num(n(rv.sendable))}</td>
                      <td className={n(rv.drafts) ? "" : "dim"}>{num(n(rv.drafts))}</td>
                      <td className={n(rv.blocked) ? "bad" : "dim"}>{num(n(rv.blocked))}</td>
                    </tr>
                  );
                })}
                {!companies.length && (
                  <tr><td colSpan={10} className="empty">No companies yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
