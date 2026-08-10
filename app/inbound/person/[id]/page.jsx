import "../../inbound.css";
import { prettyWhen, num } from "../../../../lib/db";
import { loadPerson, pageOf, pathOf } from "../../../../lib/inbound/queue";
import { REGIONS } from "../../../../lib/inbound/routing";
import { emailStatus } from "../../../../lib/inbound/words";
import Draft from "../../draft";
import { Research } from "../../research";

export const dynamic = "force-dynamic";

/**
 * One person, read the way a rep reads before reaching out.
 *
 * Evidence on the left, the thing you send on the right, and the right column
 * stays put while the left scrolls. The company research is on this page, in
 * full: a rep asking "why would they care" should never have to leave the name
 * they are looking at to find out.
 */
export default async function Person({ params }) {
  const d = await loadPerson(params.id);
  const p = d.person;
  if (!p) return <><h1>Not found</h1><p className="sub">No person with that id.</p></>;

  const draft = d.emails[0] ?? null;
  const blocked = draft?.validator_status === "blocked";
  // No draft of their own? Show a colleague's, labelled — a rep still needs to
  // see what this person would be sent before deciding to chase an address.
  const borrowed = !draft ? d.siblingDraft : null;

  return (
    <>
      <div className="rise">
        <h1>{p.full_name}</h1>
        <p className="sub">
          {[p.title, d.company?.name].filter(Boolean).join(" · ") || "No title on file"}
          {d.geo.place ? ` · ${d.geo.place}` : ""} · {REGIONS[d.geo.region].label} ·{" "}
          <b>{d.reps.map((r) => r.name).join(" and ")}</b>
        </p>
      </div>

      <div className="range" style={{ marginBottom: 18 }}>
        <a href="/inbound">&larr; Queue</a>
        {d.company ? (
          <a href={`/inbound/company/${d.company.id}`}>{d.company.name} &rarr;</a>
        ) : null}
        {p.linkedin_url
          ? <a href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn &rarr;</a> : null}
      </div>


      <div className="lab-two">
        <div>
          <div className="lab-box lab-sec">
            <h3>Who they are</h3>
            {/* Title, email, is-it-verified — the three a rep checks first, in
                that order. Everything else the pipeline holds follows, because
                a field left off the page reads as a field we do not have. */}
            <div className="meta">
              {/* The pipeline's own answer to "can I write to this person", in
                  its own words. It reads list_status, sendable, company_match
                  and email_status and reduces them to this; re-deriving it here
                  would drift the first time one of them changes meaning. */}
              <div><div className="k">Can I write to them?</div><div className="v">
                {p.status === "Ready"
                  ? <span className="lab-b visited">Ready</span>
                  : <><span className="lab-b">Needs a check</span>
                      {p.note ? <span className="dim"> · {p.note}</span> : null}</>}
              </div></div>
              <div><div className="k">Title</div><div className="v">{p.title ?? "not found"}</div></div>
              <div><div className="k">Email</div><div className="v">{p.email ?? "not found"}</div></div>
              <div><div className="k">Verified?</div><div className="v">
                {p.email_status === "verified"
                  ? <span className="lab-b visited">Yes — verified</span>
                  : p.email_status
                  ? <span className="lab-b">No — {emailStatus(p.email_status).toLowerCase()}</span>
                  : p.email ? <span className="lab-b">Not checked</span> : "—"}
                {p.email_source ? <span className="dim"> · found via {p.email_source}</span> : null}
              </div></div>
              <div><div className="k">Company</div><div className="v">
                {d.company
                  ? <a href={`/inbound/company/${d.company.id}`}>{d.company.name}</a>
                  : "not linked"}
              </div></div>
              <div><div className="k">Phone</div><div className="v">{p.phone ?? "—"}</div></div>
              <div><div className="k">LinkedIn</div><div className="v">
                {p.linkedin_url
                  ? <a href={p.linkedin_url} target="_blank" rel="noreferrer">profile</a> : "—"}
              </div></div>
              <div><div className="k">Seniority</div><div className="v">{p.seniority_band?.replace(/_/g, " ") ?? "—"}</div></div>
              <div><div className="k">Role</div><div className="v">{p.role_bucket?.replace(/_/g, " ") ?? "—"}</div></div>
              {/* fit_tier and list_status used to be printed raw here. They are
                  the inputs the view already reduced to the line at the top, so
                  showing them again is the jargon that view exists to hide. */}
              <div><div className="k">Why them</div><div className="v">{p.role_hypothesis ?? "—"}</div></div>
              <div><div className="k">Where they are</div><div className="v">
                {[p.city, p.state].filter(Boolean).join(", ") || "—"}
              </div></div>
              <div><div className="k">Found by</div><div className="v">
                {p.source === "visitor" ? "RB2B — on the site" : "Research"}
              </div></div>
              <div><div className="k">Territory</div><div className="v">
                {REGIONS[d.geo.region].label} <span className="dim">via {d.geo.basis}</span>
              </div></div>
              <div><div className="k">Outreach</div><div className="v">
                {(p.outreach_status ?? "not started").replace(/_/g, " ")}
              </div></div>
            </div>
            {p.include_reason ? (
              <div className="lab-hooks" style={{ marginTop: 14 }}>
                {p.include_reason.split(/[;\n]/).map((r, i) =>
                  r.trim() ? <span key={i}>{r.trim().replace(/_/g, " ")}</span> : null)}
              </div>
            ) : null}
          </div>

          <div className="lab-box lab-sec">
            <h3>Visits — {num(d.visits.length)}</h3>
            {d.visits.length ? (
              <ul className="lab-trail">
                {d.visits.map((v) => (
                  <li key={v.id}>
                    <span className="page" title={pathOf(v)}>{pageOf(v)}</span>
                    <span className="when">{prettyWhen(v.seen_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lab-flat">
                Never visited — research found them at {d.company?.name ?? "this company"}.
              </p>
            )}
          </div>

          <Research
            company={d.company} buildings={d.buildings} hits={d.hits} signals={d.signals}
            people={d.coPeople} visits={d.coVisits} drafts={d.coDrafts}
          />
        </div>

        <div className="lab-right">
          <div className="lab-box">
            <h3>Draft{draft ? (blocked ? " · blocked" : " · ready") : " · none yet"}</h3>
            {draft && !draft.body ? (
              /* Six rows carry a reason and no body: consultants the copy system
                 refuses on purpose, because a partner gets a different motion
                 from a buyer. That is a decision, not a missing draft. */
              <div className="warnbox w plain">
                <b>No draft written, deliberately.</b>{" "}
                {(draft.validator_reasons ?? []).join("; ")
                  || "The copy system declined to write to this kind of account."}
              </div>
            ) : draft ? (
              <>
                {blocked ? (
                  <div className="warnbox w plain" style={{ marginBottom: 12 }}>
                    <b>Not cleared to send.</b>{" "}
                    {(draft.validator_reasons ?? []).join("; ") || "The validator blocked this draft."}{" "}
                    You can still copy it and send it yourself.
                  </div>
                ) : null}
                <Draft subject={draft.subject} body={draft.body} to={p.email} />
                {draft.opener_fact ? (
                  <div className="lab-receipt">
                    <b>Claim behind the opener:</b> {draft.opener_fact}
                    {(draft.evidence_urls ?? []).map((u, i) => (
                      <span key={i}> · <a href={u} target="_blank" rel="noreferrer">source</a></span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : borrowed ? (
              <>
                <div className="lab-draft">
                  <div className="borrowed">
                    Nothing was written for {p.first_name || "them"}. This one was written for{" "}
                    {borrowed.full_name || borrowed.person_email} at the same company — the pitch
                    is the company&rsquo;s, so it is what {p.first_name || "they"} would get.
                  </div>
                  <div className="subj">{borrowed.subject}</div>
                  <pre>{borrowed.body}</pre>
                </div>
                <p className="lab-receipt" style={{ marginTop: 0 }}>
                  {p.email
                    ? "Copy it, change the name, and it is ready."
                    : "No address for them yet — worth finding one before you rewrite it."}
                </p>
              </>
            ) : (
              <div className="lab-empty">
                No draft written for {p.first_name || "this person"}, and none for anyone else at{" "}
                {d.company?.name ?? "this company"} either.
              </div>
            )}
          </div>

          {d.emails.length > 1 ? (
            <div className="lab-box">
              <h3>Other drafts — {num(d.emails.length - 1)}</h3>
              {d.emails.slice(1).map((e) => (
                <p className="lab-quote" key={e.id}>
                  <b>{e.subject}</b>
                  <span className="dim"> · {e.validator_status === "blocked" ? "blocked" : "passed"}</span>
                </p>
              ))}
            </div>
          ) : null}

          <div className="lab-box">
            <h3>History</h3>
            <p className="lab-receipt" style={{ marginTop: 0 }}>
              {draft?.pushed_at
                ? <>Pushed {prettyWhen(draft.pushed_at)} · {draft.send_status ?? "unknown"}</>
                : <>Nothing sent yet. Outreach status is{" "}
                    <b>{(p.outreach_status ?? "unknown").replace(/_/g, " ")}</b>.</>}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
