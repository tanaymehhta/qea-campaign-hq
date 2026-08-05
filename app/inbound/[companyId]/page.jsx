import "../inbound.css";
import { prettyWhen, num } from "../../../lib/db";
import {
  companyDetail, latestByStage, nodeState, nodeFacts, nodeErrors, STAGES, money, secs,
} from "../../../lib/inbound";

export const dynamic = "force-dynamic";

/** One node = one chip. The strip reads left to right in execution order. */
function NodeChip({ n }) {
  const state = nodeState(n);
  const errs = nodeErrors(n);
  return (
    <div className={`ib-node ${state}`}>
      <div className="ib-node-name">{n.sequence}. {n.node_name}</div>
      <div className="ib-node-time">
        {state === "running" ? "running…" : secs(n.duration_ms)}
        {state === "degraded" ? " · degraded" : ""}
      </div>
      <div className="ib-facts">
        {nodeFacts(n).map(([k, v]) => (
          <div className="ib-fact" key={k}><b>{v}</b> {k}</div>
        ))}
      </div>
      {errs.length ? (
        <div className="ib-err">
          {errs.slice(0, 2).map((e, i) => <div key={i}>{e.slice(0, 200)}</div>)}
          {errs.length > 2 ? <div>+{errs.length - 2} more</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Stage({ stage, run, nodes, children }) {
  if (!run) {
    return (
      <section className="ib-stage">
        <div className="ib-stage-head">
          <span className="ib-stage-no">{stage.no}</span>
          <span className="ib-stage-title">{stage.label}</span>
          <span className="ib-stage-blurb">{stage.blurb}</span>
        </div>
        <div className="ib-not-run">Not run for this company yet.</div>
      </section>
    );
  }
  const failed = nodes.filter((n) => nodeErrors(n).length).length;
  return (
    <section className="ib-stage">
      <div className="ib-stage-head">
        <span className="ib-stage-no">{stage.no}</span>
        <span className="ib-stage-title">{stage.label}</span>
        <span className="ib-stage-blurb">{stage.blurb}</span>
        <span className="ib-stage-meta">
          <span className={`pill ${run.status === "ok" ? "ok" : run.status === "error" ? "bad" : "warn"}`}>
            {run.status}
          </span>
          {" "}{prettyWhen(run.started_at)} · {nodes.length} nodes
          {failed ? ` · ${failed} with errors` : ""} · {money(run.total_cost_usd)}
        </span>
      </div>

      <div className="ib-flow">
        {nodes.map((n, i) => (
          <>
            {i > 0 ? <span className="ib-arrow" key={`a${n.id}`}>›</span> : null}
            <NodeChip n={n} key={n.id} />
          </>
        ))}
        {!nodes.length ? <div className="ib-not-run">No node events recorded.</div> : null}
      </div>

      {run.error ? <div className="warnbox">Run error: {run.error}</div> : null}
      {children}
    </section>
  );
}

function Out({ items }) {
  return (
    <div className="ib-out">
      {items.map(([k, v]) => (
        <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
      ))}
    </div>
  );
}

export default async function InboundCompany({ params }) {
  const d = await companyDetail(params.companyId);
  const c = d.company;
  if (!c) return <><h1>Not found</h1><p className="sub">No company with that id.</p></>;

  const byStage = latestByStage(d.runs);
  const r1 = byStage.get(1), r2 = byStage.get(2), r3 = byStage.get(3);
  const contacts = d.people.filter((p) => p.list_status === "contact");
  const sendable = contacts.filter((p) => p.sendable);
  const sent = d.emails.filter((e) => e.validator_status === "sent");
  const blocked = d.emails.filter((e) => e.validator_status === "blocked");
  const visitors = d.people.filter((p) => p.source === "visitor");

  const excel = [r3, r2, r1].find((r) => r?.excel_path)?.excel_path;

  return (
    <>
      <h1>{c.name}</h1>
      <p className="sub">
        {c.domain} · {c.account_type ?? c.research_status}
        {c.vertical ? ` · ${c.vertical}` : ""}
        {c.needs_human_review ? " · flagged for review" : ""}
      </p>

      {c.needs_human_review && c.review_reasons?.length ? (
        <div className="warnbox">
          <b>Needs review</b>
          <ul>{c.review_reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ) : null}

      {visitors.length ? (
        <>
          <h2>Who visited</h2>
          <p className="sub">
            From RB2B. The research below is about the <b>company</b>; this person joins the
            contact list in stage 2 alongside everyone Apollo finds.
          </p>
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Verified</th><th>Page</th><th>Seen</th></tr></thead>
            <tbody>
              {visitors.map((p) => {
                const v = d.visits[0];
                return (
                  <tr key={p.id}>
                    <td>{p.full_name}</td>
                    <td className="dim">{p.title ?? "—"}</td>
                    <td className="dim">{p.email ?? "—"}</td>
                    <td>
                      <span className={`pill ${p.email_status === "verified" ? "ok" : "warn"}`}>
                        {p.email_status ?? "unverified"}
                      </span>
                    </td>
                    <td className="dim">{(v?.captured_url ?? "").replace(/^https?:\/\//, "") || "—"}</td>
                    <td className="dim">{v ? prettyWhen(v.seen_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}

      {excel ? (
        <p className="sub" style={{ marginTop: 14 }}>
          Workbook: <code>{excel}</code>{" "}
          <span className="dim">(on the machine that ran the pipeline)</span>
        </p>
      ) : null}

      <h2>Pipeline</h2>

      <Stage stage={STAGES[0]} run={r1} nodes={d.nodesByRun.get(r1?.id) ?? []}>
        <Out items={[
          ["Buildings", num(d.buildings.length)],
          ["Compliance rules", num(d.hits.length)],
          ["Intent signals", num(d.signals.length)],
          ["Vertical", c.vertical ?? "—"],
        ]} />
        {d.signals.length ? (
          <div className="ib-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Type</th><th>What</th><th>Stage</th><th>Quote</th><th>Source</th></tr></thead>
              <tbody>
                {d.signals.map((s) => (
                  <tr key={s.id}>
                    <td><span className="pill">{s.signal_type}</span></td>
                    <td>{s.amount ?? s.claim_or_target ?? s.mention_type ?? "—"}
                      {s.scope ? <div className="dim">{s.scope}</div> : null}</td>
                    <td className="dim">{[s.work_kind, s.stage].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="dim">{(s.quote ?? "").slice(0, 110)}</td>
                    <td>{s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer">link</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Stage>

      <Stage stage={STAGES[1]} run={r2} nodes={d.nodesByRun.get(r2?.id) ?? []}>
        <Out items={[
          ["Contacts", num(contacts.length)],
          ["Sendable", num(sendable.length)],
          ["Adjacent", num(d.people.filter((p) => p.list_status === "adjacent").length)],
          ["Unresolved", num(d.people.filter((p) => p.list_status === "unresolved").length)],
        ]} />
        {contacts.length ? (
          <div className="ib-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Email</th>
                <th>Status</th><th>Sendable</th></tr></thead>
              <tbody>
                {contacts.slice(0, 60).map((p) => (
                  <tr key={p.id}>
                    <td>{p.full_name}</td>
                    <td className="dim">{p.title ?? "—"}</td>
                    <td className="dim">{p.role_bucket ?? "—"}</td>
                    <td className="dim">{p.email ?? "—"}</td>
                    <td className="dim">{p.email_status ?? "—"}</td>
                    <td>
                      {p.sendable
                        ? <span className="pill ok">yes</span>
                        : <span className="pill warn" title={p.sendable_reason ?? ""}>
                            {p.sendable_reason ?? "no"}
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Stage>

      <Stage stage={STAGES[2]} run={r3} nodes={d.nodesByRun.get(r3?.id) ?? []}>
        <Out items={[
          ["Rendered", num(d.emails.length)],
          ["Would send", num(sent.length)],
          ["Blocked", num(blocked.length)],
          ["Pushed", num(d.emails.filter((e) => e.instantly_lead_id).length)],
        ]} />
        {d.emails.length ? (
          <div style={{ marginTop: 12 }}>
            {d.emails.map((e) => (
              <div className={`ib-mail ${e.validator_status}`} key={e.id}>
                <div className="subj">{e.subject ?? "(no subject)"}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {e.full_name} · {e.title ?? "—"} · {e.icp_key ?? "—"}
                  {" · "}
                  <span className={`pill ${e.validator_status === "sent" ? "ok" : "bad"}`}>
                    {e.validator_status === "sent" ? "passes" : "blocked"}
                  </span>
                </div>
                {e.validator_status === "blocked" && e.validator_reasons?.length ? (
                  <div className="ib-err">{e.validator_reasons.join("; ")}</div>
                ) : null}
                {e.body ? <pre>{e.body}</pre> : null}
                {e.opener_fact ? (
                  <div className="ib-receipt">
                    Claim: {e.opener_fact}
                    {(e.evidence_urls ?? []).map((u, i) => (
                      <span key={i}> · <a href={u} target="_blank" rel="noreferrer">source</a></span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Stage>

      <h2>All runs</h2>
      <p className="sub">Every execution for this company, newest first, including earlier attempts.</p>
      <div className="ib-scroll">
        <table>
          <thead><tr><th>Stage</th><th>Started</th><th>Status</th><th>Nodes</th>
            <th>Tokens</th><th>Cost</th><th>Trace</th></tr></thead>
          <tbody>
            {d.runs.map((r) => {
              const ns = d.nodesByRun.get(r.id) ?? [];
              return (
                <tr key={r.id}>
                  <td>{r.stage_no ?? "—"} {r.graph_name}</td>
                  <td className="dim">{prettyWhen(r.started_at)}</td>
                  <td>
                    <span className={`pill ${r.status === "ok" ? "ok" : r.status === "error" ? "bad" : "warn"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="dim">{ns.length}{ns.filter((n) => nodeErrors(n).length).length
                    ? ` (${ns.filter((n) => nodeErrors(n).length).length} err)` : ""}</td>
                  <td className="dim">{num((r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0))}</td>
                  <td className="dim">{money(r.total_cost_usd)}</td>
                  <td>{r.langsmith_run_url
                    ? <a href={r.langsmith_run_url} target="_blank" rel="noreferrer">LangSmith</a>
                    : <span className="dim">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
