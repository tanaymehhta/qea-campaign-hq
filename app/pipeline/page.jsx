import "./pipeline.css";
import { prettyWhen, num } from "../../lib/db";
import { Seg } from "../../components/ui";
import { NodeStrip } from "./nodes";
import { setCompanyRelevant } from "../inbound/actions";
import {
  inboundOverview, peopleOverview, researchOverview, latestByStage, STAGES, money,
  runLog, strandedList, runSeconds, nodeErrors, HOSTS, RUN_RANGES, DECIDED,
} from "../../lib/pipeline";

export const dynamic = "force-dynamic";

const STAGE_MARK = { ok: "ok", needs_review: "review", error: "error",
                     running: "running", cancelled: "killed" };

const TONE = { ok: "ok", error: "bad", running: "", cancelled: "bad" };
const toneOf = (s) => TONE[s] ?? "warn";

function StageDot({ run }) {
  if (!run) return <span className="pill dim">—</span>;
  const s = run.status ?? "unknown";
  return <span className={`pill ${toneOf(s)}`}>{STAGE_MARK[s] ?? s}</span>;
}

const VIEWS = [
  ["runs", "Runs"],
  ["company", "By company"],
  ["person", "By person"],
  ["research", "Research"],
  ["stuck", "Stuck"],
];

/** "3 hours ago", to one unit. A run log is scanned, not read. */
function ago(iso, now = Date.now()) {
  if (!iso) return "—";
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

const dur = (s) => (s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)}m`);

/**
 * Is the schedule alive — the first thing on the page, because it is the first
 * thing anybody asks. It reads GitHub-hosted runs only; a laptop run means a
 * human was at a keyboard, which is a different question with the same shape.
 */
function Health({ health }) {
  // `h-` prefix for the same reason as `s-` below: bare `ok` and `bad` are text
  // utilities in globals.css, and inheriting them would have coloured this
  // banner by accident in two states out of four and left the third plain.
  return (
    <div className={`ib-health h-${health.state}`}>
      <span className="dot" />
      <div>
        <b>
          {health.state === "unknown"
            ? "No scheduled run identified"
            : `Last scheduled run ${ago(health.last.startedAt)}`}
        </b>
        <div className="dim">
          {health.note}
          {health.last ? ` · ${prettyWhen(health.last.startedAt)}` : ""}
        </div>
      </div>
      <a className="ib-gh"
         href="https://github.com/tanaymehhta/qea-inbound/actions/workflows/inbound-pipeline.yml"
         target="_blank" rel="noreferrer">
        Actions log &rarr;
      </a>
    </div>
  );
}

/**
 * One execution, expandable to the stages and their nodes.
 *
 * A `<details>`, so the whole log works with JavaScript off and nothing on this
 * page has to hold open/closed state — the same disclosure the campaign cards
 * and meeting rows use.
 */
function RunRow({ e, company, nodesByRun }) {
  const errs = e.runs.reduce(
    (t, r) => t + (nodesByRun.get(r.id) ?? []).filter((n) => nodeErrors(n).length).length, 0);
  return (
    // `s-` prefix, not the bare status: globals.css carries a `.ok` text
    // utility, so `class="ib-run ok"` painted every successful row green and
    // bold — the colour that is supposed to mean "look here" applied to the 87%
    // of rows where nothing happened.
    <details className={`ib-run s-${e.status}`}>
      <summary>
        <span className="when">
          {prettyWhen(e.startedAt)}
          <span className="dim"> · {ago(e.startedAt)}</span>
        </span>
        <span className="co">
          {company
            ? <a href={`/pipeline/${company.id}`}>{company.name}</a>
            : <span className="dim">unknown company</span>}
        </span>
        <span className="host" title={e.host ? HOSTS[e.host].long : "No workbook path recorded"}>
          {e.host ? HOSTS[e.host].label : "—"}
        </span>
        <span className="stages">
          {STAGES.map((s) => {
            const r = e.byStage.get(s.no);
            return (
              <span key={s.no} className={`pill ${r ? toneOf(r.status) : "dim"}`}
                    title={`${s.no}. ${s.label}${r ? ` — ${r.status}` : " — not run"}`}>
                {s.no}
              </span>
            );
          })}
        </span>
        <span className="n">{e.cost ? money(e.cost) : <span className="dim">$0</span>}</span>
        <span className="n dim">{dur(e.seconds)}</span>
        <span className={errs ? "n bad" : "n dim"}>{errs ? `${errs} err` : "—"}</span>
      </summary>

      <div className="ib-runbody">
        {e.runs.map((r) => {
          const nodes = nodesByRun.get(r.id) ?? [];
          const stage = STAGES.find((s) => s.no === (r.stage_no ?? 0)
            || s.graph === r.graph_name);
          return (
            <section className="ib-stage" key={r.id}>
              <div className="ib-stage-head">
                <span className="ib-stage-no">{stage?.no ?? "?"}</span>
                <span className="ib-stage-title">{stage?.label ?? r.graph_name}</span>
                <span className="ib-stage-meta">
                  <span className={`pill ${toneOf(r.status)}`}>{r.status}</span>{" "}
                  {dur(runSeconds(r))} · {money(r.total_cost_usd)} ·{" "}
                  {num((r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0))} tokens ·{" "}
                  {num(r.search_calls)} searches
                  {r.apollo_credits ? ` · ${num(r.apollo_credits)} Apollo credits` : ""}
                </span>
              </div>
              <NodeStrip nodes={nodes} />
              {r.error ? <div className="warnbox plain">Run error: {r.error}</div> : null}
              {r.output && typeof r.output === "object" ? (
                <div className="ib-out">
                  {Object.entries(r.output)
                    .filter(([, v]) => typeof v === "number" || typeof v === "string"
                      || typeof v === "boolean")
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k}><div className="k">{k}</div><div className="v">{String(v)}</div></div>
                    ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </details>
  );
}

/** "Research this again" — the one write, and the same one `--stranded` makes. */
function Requeue({ id }) {
  return (
    <form action={setCompanyRelevant}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="relevant" value="yes" />
      <button type="submit" className="ib-requeue"
              title="Sets research_status to 'new'. The next scheduled run picks it up.">
        Research this again
      </button>
    </form>
  );
}

export default async function Pipeline({ searchParams }) {
  const view = VIEWS.some(([k]) => k === searchParams?.view) ? searchParams.view : "runs";
  const range = RUN_RANGES.some(([k]) => k === searchParams?.range) ? searchParams.range : "7";

  const { companies, events, runsByCompany } = await inboundOverview();
  const pv = view === "person" ? await peopleOverview() : null;
  const rv = view === "research" ? await researchOverview() : null;
  const log = view === "runs" ? await runLog({ range }) : null;
  const stuck = view === "stuck" ? await strandedList() : null;

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
        those stages, stage by stage and node by node. The one thing it can change is putting a
        stuck company back in the queue. The leads themselves are at{" "}
        <a href="/inbound">/inbound</a>, and every draft is at{" "}
        <a href="/inbound/drafts">/inbound/drafts</a>.
      </p>

      {log ? <Health health={log.health} /> : null}

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
          <a key={k} href={k === "runs" ? "/pipeline" : `/pipeline?view=${k}`}
            className={view === k ? "on" : ""}>{l}</a>
        ))}
      </div>

      {view === "runs" ? (
        <>
          <h2>Every run, newest first</h2>
          <p className="sub">
            One row per execution — the three stages of one company going through together.
            Open one for the stages, their nodes, and what each node cost. Where it ran is read
            off the workbook path: <b>GitHub</b> is the 3-hourly schedule, <b>Laptop</b> is
            somebody running it by hand.
          </p>

          <div className="segrow">
            <Seg options={RUN_RANGES} current={range}
                 hrefFor={(k) => `/pipeline?range=${k}`} />
            <span className="note">
              {num(log.executions.length)} of {num(log.total)} execution
              {log.total === 1 ? "" : "s"}
              {log.truncated ? ` · ${num(log.truncated)} older ones not shown` : ""} ·{" "}
              {money(log.executions.reduce((a, e) => a + e.cost, 0))} in this window
            </span>
          </div>

          <div className="ib-runhead">
            <span>Started</span><span>Company</span><span>Where</span>
            <span>Stages</span><span>Cost</span><span>Took</span><span>Errors</span>
          </div>
          {log.executions.map((e) => (
            <RunRow key={e.key} e={e} nodesByRun={log.nodesByRun}
                    company={log.companyById.get(e.companyId)} />
          ))}
          {!log.executions.length ? (
            <div className="ib-not-run">
              No runs in this window. <a href="/pipeline?range=all">All time</a> holds{" "}
              {num(log.total)}.
            </div>
          ) : null}

          <p className="note" style={{ marginTop: 14 }}>
            Cost is what the run itself recorded — LLM tokens plus search calls. An execution
            with no workbook path cannot say which machine ran it and shows a dash rather than a
            guess. Duration is measured from the first stage starting to the last one finishing,
            because <code>duration_sec</code> is NULL on every row in the table.
          </p>
        </>
      ) : null}

      {view === "stuck" ? (
        <>
          <h2>Companies a run left half-done</h2>
          <p className="sub">
            From <code>v_inbound_stranded</code>. A run can stop for reasons that have nothing to
            do with the company — the LLM account runs out of credit mid-batch, the Actions job
            hits its time limit, a stage dies — and before this view a company just sat there,
            because the runner only ever picks up <code>research_status = &lsquo;new&rsquo;</code>.
            <b> Research this again</b> writes exactly that value; the next scheduled run does the
            rest, and it costs money.
          </p>

          {stuck.groups.map((g) => (
            <div key={g.reason}>
              <div className="ib-lane">
                <h3 className="ib-h3">{g.reason}</h3>
                <span className="n">{num(g.rows.length)}</span>
              </div>
              {g.decided ? (
                <p className="note" style={{ marginBottom: 8 }}>
                  Not a failure — a model that actually ran said no. No button, for the same
                  reason <code>--stranded</code> skips these.
                </p>
              ) : null}
              <div className="ib-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th style={{ textAlign: "left" }}>Company</th>
                      <th style={{ textAlign: "left" }}>Status</th><th>People</th>
                      <th>Drafts</th><th>Ready</th>
                      <th style={{ textAlign: "left" }}>Last researched</th>
                      <th style={{ textAlign: "left" }}>{g.decided ? "Why" : ""}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="dim">{i + 1}</td>
                        <td className="name" style={{ textAlign: "left" }}>
                          <a href={`/pipeline/${r.id}`}>{r.name}</a>
                          <div className="dim">{r.domain ?? "no domain"}</div>
                        </td>
                        <td className="dim" style={{ textAlign: "left" }}>
                          {r.research_status}
                          {r.account_type ? ` · ${r.account_type}` : ""}
                        </td>
                        <td className={r.people_named ? "" : "dim"}>{num(r.people_named)}</td>
                        <td className={r.drafts ? "" : "dim"}>{num(r.drafts)}</td>
                        <td className={r.sendable ? "" : "dim"}>{num(r.sendable)}</td>
                        <td className="dim" style={{ textAlign: "left" }}>
                          {r.last_researched_at ? prettyWhen(r.last_researched_at) : "never"}
                        </td>
                        <td style={{ textAlign: "left" }}>
                          {g.decided
                            ? <span className="dim" title={r.account_type_reason ?? ""}>
                                {(r.account_type_reason ?? "—").slice(0, 90)}
                              </span>
                            : <Requeue id={r.id} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {!stuck.rows.length ? (
            <div className="ib-not-run">Nothing is stuck. Every company reached a verdict.</div>
          ) : null}

          <p className="note" style={{ marginTop: 14 }}>
            {num(stuck.recoverable)} of {num(stuck.rows.length)} are worth re-running; the rest
            were decided. From a terminal the same thing is{" "}
            <code>python scripts/run_pipeline.py --stranded</code>, which skips{" "}
            &ldquo;{DECIDED}&rdquo; for the same reason this page does.
          </p>
        </>
      ) : null}

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
