import "../../inbound.css";
import { prettyWhen, num } from "../../../../lib/db";
import { personDetail } from "../../../../lib/inbound";

export const dynamic = "force-dynamic";

/**
 * A person's dossier — the sales-facing read on one human: who they are, why
 * the pipeline put them on the list, what their company is signalling, and the
 * draft emails written for them. The pipeline trace lives on the company page.
 */
export default async function InboundPerson({ params }) {
  const d = await personDetail(params.personId);
  const p = d.person;
  if (!p) return <><h1>Not found</h1><p className="sub">No person with that id.</p></>;

  const drafts = d.emails.slice(0, 3);
  const why = [p.include_reason, p.role_hypothesis].filter(Boolean);

  return (
    <>
      <div className="rise">
        <h1>{p.full_name || "Unknown"}</h1>
        <p className="sub">
          {[p.title, d.company ? null : "no company linked"].filter(Boolean).join(" · ")}
          {d.company ? <>{p.title ? " · " : ""}<a href={`/inbound/${d.company.id}`}>{d.company.name}</a></> : null}
          {p.city || p.state ? ` · ${[p.city, p.state].filter(Boolean).join(", ")}` : ""}
        </p>
      </div>

      <div className="range" style={{ marginBottom: 18 }}>
        <a href="/inbound?view=person">&larr; All people</a>
      </div>

      <div className="meta" style={{ marginBottom: 22 }}>
        <div><div className="k">Email</div><div className="v">{p.email ?? "—"}</div></div>
        <div><div className="k">Email status</div><div className="v">
          {p.email_status
            ? <span className={`pill ${p.email_status === "verified" ? "ok" : "warn"}`}>{p.email_status}</span>
            : "—"}
          {p.email_source ? <span className="dim"> via {p.email_source}</span> : null}
        </div></div>
        <div><div className="k">Role</div><div className="v">{p.role_bucket ?? "—"}</div></div>
        <div><div className="k">Seniority</div><div className="v">{p.seniority_band ?? "—"}</div></div>
        <div><div className="k">Fit tier</div><div className="v">{p.fit_tier ?? "—"}</div></div>
        <div><div className="k">List status</div><div className="v">{p.list_status ?? "—"}</div></div>
        <div><div className="k">Sendable</div><div className="v">
          {p.sendable
            ? <span className="pill ok">yes</span>
            : <span className="pill warn">{p.sendable_reason ?? "no"}</span>}
        </div></div>
        <div><div className="k">Source</div><div className="v">{p.source}</div></div>
        <div><div className="k">LinkedIn</div><div className="v">
          {p.linkedin_url
            ? <a href={p.linkedin_url} target="_blank" rel="noreferrer">profile</a>
            : "—"}
        </div></div>
        <div><div className="k">Outreach</div><div className="v">{p.outreach_status?.replace(/_/g, " ") ?? "—"}</div></div>
      </div>

      {why.length ? (
        <>
          <h2>Why they&rsquo;re on the list</h2>
          <div className="card">
            {why.map((w, i) => (
              <p key={i} style={{ margin: i ? "10px 0 0" : 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
                {w}
              </p>
            ))}
          </div>
        </>
      ) : null}

      {d.visits.length ? (
        <>
          <h2>Visits</h2>
          <p className="sub">What they looked at on the site, newest first — the reason RB2B flagged them.</p>
          <div className="ib-scroll">
            <table>
              <thead><tr><th>Seen</th><th>Page</th><th>Referrer</th><th>Repeat</th></tr></thead>
              <tbody>
                {d.visits.map((v) => (
                  <tr key={v.id}>
                    <td className="dim">{prettyWhen(v.seen_at)}</td>
                    <td>{(v.captured_url ?? "").replace(/^https?:\/\//, "") || "—"}</td>
                    <td className="dim">{(v.referrer ?? "").replace(/^https?:\/\//, "") || "—"}</td>
                    <td className="dim">{v.is_repeat_visit ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {d.company && (d.signals.length || d.hits.length || d.buildings.length) ? (
        <>
          <h2>What {d.company.name} is signalling</h2>
          <p className="sub">
            Company-level research context for the pitch — {num(d.buildings.length)} building
            {d.buildings.length === 1 ? "" : "s"} found, {num(d.hits.length)} compliance rule
            {d.hits.length === 1 ? "" : "s"} in play.{" "}
            <a href={`/inbound/${d.company.id}`}>Full research on the company page &rarr;</a>
          </p>
          {d.signals.length ? (
            <div className="card">
              {d.signals.slice(0, 6).map((s) => (
                <p key={s.id} style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6 }}>
                  <span className="pill">{s.signal_type}</span>{" "}
                  {s.claim_or_target ?? s.amount ?? s.mention_type ?? ""}
                  {s.quote ? <span className="dim"> — &ldquo;{s.quote.slice(0, 160)}&rdquo;</span> : null}
                  {s.source_url ? <> <a href={s.source_url} target="_blank" rel="noreferrer">source</a></> : null}
                </p>
              ))}
              {d.signals.length > 6 ? (
                <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>
                  +{d.signals.length - 6} more on the company page
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <h2>Draft emails</h2>
      <p className="sub">
        {drafts.length
          ? `Written by the pipeline for ${p.first_name || p.full_name || "this person"} — read, copy, or check the claim behind the opener.`
          : "None yet — stage 3 has not written for this person."}
      </p>
      {drafts.map((e) => (
        <div className={`ib-mail ${e.validator_status ?? ""}`} key={e.id}>
          <div className="subj">{e.subject ?? "(no subject)"}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {e.icp_key ?? "—"}
            {" · "}
            <span className={`pill ${e.validator_status === "sent" ? "ok" : "bad"}`}>
              {e.validator_status === "sent" ? "passes validation" : "blocked"}
            </span>
            {e.pushed_at ? <> · pushed {prettyWhen(e.pushed_at)}</> : null}
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
      {d.emails.length > 3 ? (
        <p className="dim" style={{ fontSize: 12.5 }}>
          {num(d.emails.length - 3)} older draft{d.emails.length - 3 === 1 ? "" : "s"} not shown.
        </p>
      ) : null}
    </>
  );
}
