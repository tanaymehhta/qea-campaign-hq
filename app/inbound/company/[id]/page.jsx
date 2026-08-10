import "../../inbound.css";
import { prettyWhen, num } from "../../../../lib/db";
import { loadCompany, pageOf, pathOf } from "../../../../lib/inbound/queue";
import { REGIONS } from "../../../../lib/inbound/routing";
import { verdict, bullets } from "../../../../lib/inbound/words";
import { Research } from "../../research";
import { RankButtons, ReadyToggle, RelevanceToggle } from "../../controls";

export const dynamic = "force-dynamic";

/**
 * A company that visited, in full.
 *
 * This is where a company-only lead goes. It used to render through the person
 * template, which produced a page of dashes: no email, no title, no role, for a
 * thing that has none of those. A company has different questions — what do
 * they own, what law bites them, who visited, and is there anyone here to write
 * to — so it gets its own page.
 */
export default async function Company({ params, searchParams }) {
  const d = await loadCompany(params.id);
  const c = d.company;
  if (!c) return <><h1>Not found</h1><p className="sub">No company with that id.</p></>;
  const err = searchParams?.err;

  const v = verdict(c);
  const draftFor = (p) =>
    d.emails.find((e) => e.person_id === p.id) ??
    (p.email ? d.emails.find((e) => e.person_email?.toLowerCase() === p.email.toLowerCase()) : null);

  const hq = [c.hq_city, c.hq_state, c.hq_country].filter(Boolean).join(", ");
  // RB2B geolocates whoever was on the site, which is often not where the
  // company is registered. Both are true and a rep should see both.
  const conflict = hq && d.geo.place && !hq.toLowerCase().includes(d.geo.place.split(",")[0].toLowerCase());

  return (
    <>
      <div className="rise">
        <h1>{c.name}</h1>
        <p className="sub">
          {c.domain ?? "no domain"}
          {d.geo.place ? ` · visited from ${d.geo.place}` : ""} · {REGIONS[d.geo.region].label} ·{" "}
          <b>{d.reps.map((r) => r.name).join(" and ")}</b>
        </p>
      </div>

      {err ? <div className="lab-err">That didn&rsquo;t save — {err}</div> : null}

      <div className="range" style={{ marginBottom: 18 }}>
        <a href="/inbound">&larr; Queue</a>
        {c.website || c.domain ? (
          <a href={c.website ?? `https://${c.domain}`} target="_blank" rel="noreferrer">Website &rarr;</a>
        ) : null}
      </div>


      {conflict ? (
        <div className="warnbox w" style={{ marginBottom: 18 }}>
          <b>The visit and the company are in different places.</b> Someone browsed from{" "}
          {d.geo.place}, but {c.name} is on file in {hq}. Territory follows the visitor, so this
          sits with {d.reps.map((r) => r.name).join(" and ")} — worth a look before you work it.
        </div>
      ) : null}

      <div className="lab-two">
        <div>
          <div className="lab-box lab-sec">
            <h3>The account</h3>
            <div className="meta">
              <div><div className="k">Worth selling to?</div><div className="v">
                {v.short}
                {c.account_type_confidence
                  ? <span className="dim"> · {Math.round(c.account_type_confidence * 100)}% sure</span> : null}
                {v.conflict ? (
                  <span className="dim" style={{ display: "block" }}>
                    Typed {v.conflict}, but research ruled them out.
                  </span>
                ) : null}
                {/* Overrule it. Marking one relevant re-queues it for research,
                    so this button costs money on the next run — the title says so. */}
                <RelevanceToggle companyId={c.id} relevant={v.lane !== "irrelevant"} />
              </div></div>
              <div><div className="k">Vertical</div><div className="v">{c.vertical?.replace(/_/g, " ") ?? "—"}</div></div>
              <div><div className="k">Head office</div><div className="v">{hq || "—"}</div></div>
              <div><div className="k">Visited from</div><div className="v">
                {d.geo.place || "—"} <span className="dim">via {d.geo.basis}</span>
              </div></div>
              <div><div className="k">Staff</div><div className="v">{c.employee_count ?? "—"}</div></div>
              <div><div className="k">Research</div><div className="v">{c.research_status?.replace(/_/g, " ") ?? "—"}</div></div>
            </div>
            {/* The classifier's reasoning is written as one long paragraph and
                is the thing a rep most needs to skim — why did it decide this,
                and how sure is it. Bullets, like everything else here.
                The portfolio lives in Research below rather than twice. */}
            {c.account_type_reason ? (
              <>
                <h4 className="lab-h4">Why it decided that</h4>
                <ul className="lab-bul">
                  {bullets(c.account_type_reason, 5).map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </>
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
            ) : <p className="lab-flat">No visits recorded.</p>}
          </div>

          <Research company={c} buildings={d.buildings} hits={d.hits} signals={d.signals}
                    people={d.people} visits={d.visits} drafts={d.emails} />
        </div>

        <div className="lab-right">
          <div className="lab-box">
            <h3>People found — {num(d.people.length)}</h3>
            {d.people.length ? (
              /* The name is a link, not a disclosure: one click opens the
                 person. The draft sits behind its own toggle beside it, so
                 reading a draft here and opening a person are two separate
                 actions rather than two clicks at the same thing. */
              d.people.map((p, pi) => {
                const own = draftFor(p);
                const shown = own ?? d.emails[0] ?? null;
                return (
                  <div className="lab-per" key={p.id}>
                    {/* Outside the anchor: a form nested in a link is invalid
                        HTML, and the browser resolves it by dropping one of them. */}
                    <div className="lab-perbar">
                      <RankButtons personId={p.id} companyId={c.id}
                                   first={pi === 0} last={pi === d.people.length - 1} />
                      <ReadyToggle personId={p.id} companyId={c.id}
                                   ready={p.status === "Ready"}
                                   manualled={p.manual_sendable != null} />
                    </div>
                    <a className="lab-perhead" href={`/inbound/person/${p.id}`}>
                      <span className="nm">
                        {p.full_name}
                        {p.visits.length ? (
                          <span className="lab-b visited" style={{ marginLeft: 7 }}
                                title={`Came to the site — ${p.visits.length} visit${p.visits.length === 1 ? "" : "s"}, last on ${pageOf(p.visits[0])}`}>
                            visited
                          </span>
                        ) : null}
                        <span className="tt">{p.title ?? "no title on file"}</span>
                        {p.visits.length ? (
                          <span className="tt">
                            {p.visits.length} visit{p.visits.length === 1 ? "" : "s"} ·{" "}
                            {pageOf(p.visits[0])} · {prettyWhen(p.visits[0].seen_at)}
                          </span>
                        ) : null}
                        {/* Two words and one sentence, both written by the
                            pipeline. What a rep does next is the sentence, not
                            the address — "no email yet" is true of almost
                            everyone until Apollo resets and so says nothing. */}
                        <span className="tt">
                          {p.status === "Ready"
                            ? <b className="ok">Ready</b>
                            : <><b className="no">Needs a check</b>{p.note ? ` · ${p.note}` : null}</>}
                        </span>
                        <span className="tt">{p.email ?? "no address found"}</span>
                      </span>
                      <span className="go">&rarr;</span>
                    </a>
                    {shown ? (
                      <details className="lab-more">
                        <summary>
                          {own ? "Their draft" : "The draft they would get"}
                          <span className="chev">&rsaquo;</span>
                        </summary>
                        <div className="lab-more-body">
                          <div className={`lab-draft ${shown.validator_status === "blocked" ? "blocked" : ""}`}>
                            {!own ? (
                              <div className="borrowed">
                                Written for {shown.full_name || shown.person_email} at the same
                                company — the pitch is the company&rsquo;s, so this is what{" "}
                                {p.first_name || "they"} would get, not a draft to send as is.
                              </div>
                            ) : null}
                            {shown.body ? (
                              <>
                                <div className="subj">{shown.subject}</div>
                                <pre>{shown.body}</pre>
                              </>
                            ) : (
                              /* A consultant account: refused on purpose, with the
                                 reason recorded. An empty <pre> read as a bug. */
                              <div className="borrowed">
                                No draft written, deliberately —{" "}
                                {(shown.validator_reasons ?? []).join("; ")
                                  || "a partner gets a different motion from a buyer."}
                              </div>
                            )}
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="lab-empty">
                Nobody found here yet. The visit is all we have — nothing has produced a contact
                for {c.name}.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
