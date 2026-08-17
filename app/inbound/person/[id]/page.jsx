import "../../inbound.css";
import { prettyWhen, num } from "../../../../lib/db";
import { loadPerson, pageOf, pathOf } from "../../../../lib/inbound/queue";
import { REGIONS } from "../../../../lib/inbound/routing";
import { emailStatus, emailSource, roleWords, verdict } from "../../../../lib/inbound/words";
import Draft from "../../draft";
import { Research } from "../../research";
import { ReadyToggle, RelevanceToggle } from "../../controls";

export const dynamic = "force-dynamic";

const Sep = () => <span className="sep">·</span>;

/** A label and its value, on one rule. The record, not the form. */
function Fact({ k, children }) {
  return <div><span className="k">{k}</span><span className="v">{children}</span></div>;
}

/** Section label, rule, content. Every group on the page wears one. */
function Section({ title, right, children }) {
  return (
    <section>
      <div className="i-sec">
        <h2 className="i-h2">{title}</h2>
        <span className="line" />
        {right ? <span className="n">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Why the automatic send is off, in one line.
 *
 * The validator writes up to six reasons and they are written for whoever runs
 * the pipeline — *"account unassigned — drafted as Mark Vasu, set assigned_to
 * before sending"* is an instruction to an operator, not news to a rep. So the
 * first one is the line, the rest are one click away, and the draft itself
 * stays readable and copyable in every state.
 */
function Gate({ reasons }) {
  const [first, ...rest] = reasons ?? [];
  return (
    <div className="i-tone bad" style={{ marginBottom: 14 }}>
      <b>Not ready to send</b> — {first ?? "the validator held it back"}. You can copy it and
      send it yourself.
      {rest.length ? (
        <details className="i-show">
          <summary>why, in full</summary>
          <div className="body">
            <ul className="i-lbs">
              {rest.map((r, i) => <li className="i-lb" key={i}>{r}</li>)}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * One person, read the way a rep reads before reaching out.
 *
 * The first thing on the page is whether they can be written to at all, because
 * that is the first thing anyone asks and every other fact on the page is only
 * worth reading if the answer is yes. Evidence under it, the thing you send on
 * the right, and the right column stays put while the left scrolls. The company
 * research is on this page, in full: a rep asking "why would they care" should
 * never have to leave the name they are looking at to find out.
 */
export default async function Person({ params, searchParams }) {
  const d = await loadPerson(params.id);
  const p = d.person;
  if (!p) return <><h1 className="i-h1">Not found</h1><p className="i-sub">No person with that id.</p></>;
  const err = searchParams?.err;

  const draft = d.emails[0] ?? null;
  const blocked = draft?.validator_status === "blocked";
  // No draft of their own? Show a colleague's, labelled — a rep still needs to
  // see what this person would be sent before deciding to chase an address.
  const borrowed = !draft ? d.siblingDraft : null;

  return (
    <div className="i-page">
      {err ? <div className="i-tone bad">That didn&rsquo;t save — {err}</div> : null}

      <header className="i-head rise">
        <h1 className="i-h1">{p.full_name}</h1>
        <p className="i-sub">
          {[p.title, d.company?.name].filter(Boolean).join(" · ") || "No title on file"}
          {d.geo.place ? ` · ${d.geo.place}` : ""} · {REGIONS[d.geo.region].label} ·{" "}
          <b>{d.reps.map((r) => r.name).join(" and ")}</b>
        </p>

        {/* Plain links, no arrows: an arrow promises the next step in a sequence
            and these are sideways moves. Actions on the whole record live here
            too, rather than tucked under a value in the record below. */}
        <div className="i-links">
          <a href="/inbound">Queue</a>
          {d.company ? (
            <><Sep /><a href={`/inbound/company/${d.company.id}`}>{d.company.name}</a></>
          ) : null}
          {p.linkedin_url ? (
            <><Sep /><a href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>
          ) : null}
          {d.company ? (
            <>
              <Sep />
              <RelevanceToggle companyId={d.company.id}
                               relevant={verdict(d.company).lane !== "irrelevant"} />
            </>
          ) : null}
        </div>
      </header>

      <div className="i-two wide">
        <div>
          {/* The one question worth asking first, answered at the size of the
              answer. Its own label is its state; the line under it is what
              pressing it does. The classifier's reason rides underneath,
              because that is the part a button cannot say. */}
          <ReadyToggle big personId={p.id} companyId={p.company_id}
                       ready={p.status === "Ready"}
                       manualled={p.manual_sendable != null}
                       note={p.status !== "Ready" ? p.note : null} />

          <Section title="Who they are">
            <div className="i-card">
              {/* Title, email, is-it-verified — the three a rep checks first, in
                  that order. Everything else the pipeline holds follows, because
                  a field left off the page reads as a field we do not have. */}
              <div className="i-facts">
                <Fact k="Title">{p.title ?? "not found"}</Fact>
                <Fact k="Email">{p.email ?? "not found"}</Fact>
                <Fact k="Verified?">
                  {p.email_status === "verified" ? (
                    <span className="i-chip done"><span className="mark" />Verified</span>
                  ) : p.email_status ? (
                    <span className="i-chip none">
                      <span className="mark" />{emailStatus(p.email_status)}
                    </span>
                  ) : p.email ? (
                    <span className="i-chip none"><span className="mark" />Not checked</span>
                  ) : "—"}
                  {/* "quarantined_off_domain" means the address was guessed and
                      the guess looks wrong. Nobody outside the pipeline knows
                      that, so it is said instead of quoted. */}
                  {emailSource(p.email_source)
                    ? <span className="dim"> · {emailSource(p.email_source)}</span> : null}
                </Fact>
                <Fact k="Company">
                  {d.company
                    ? <a href={`/inbound/company/${d.company.id}`}>{d.company.name}</a>
                    : "not linked"}
                </Fact>
                <Fact k="Phone">{p.phone ?? "—"}</Fact>
                <Fact k="LinkedIn">
                  {p.linkedin_url
                    ? <a href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn profile</a>
                    : "—"}
                </Fact>
                <Fact k="Seniority">{roleWords(p.seniority_band) ?? "—"}</Fact>
                <Fact k="Role">{roleWords(p.role_bucket) ?? "—"}</Fact>
                {/* fit_tier and list_status used to be printed raw here. They are
                    the inputs the view already reduced to the block at the top,
                    so showing them again is the jargon that view exists to hide.
                    "Why them" goes the same way when it is empty, which is 91%
                    of the time: a dash reads as a value we lost, and this one
                    was never collected at person level. */}
                {p.role_hypothesis ? <Fact k="Why them">{p.role_hypothesis}</Fact> : null}
                <Fact k="Where they are">
                  {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                </Fact>
                <Fact k="Found by">{p.source === "visitor" ? "RB2B — on the site" : "Research"}</Fact>
                <Fact k="Territory">
                  <span title={`Read from the ${d.geo.basis}`}>{REGIONS[d.geo.region].label}</span>
                </Fact>
                {/* Outreach is gone. `outreach_status` is `not_started` on all
                    2,446 rows, so the field could only ever say one thing. */}
              </div>
              {p.include_reason ? (
                <div className="i-tags" style={{ marginTop: 14 }}>
                  {p.include_reason.split(/[;\n]/).map((r, i) =>
                    r.trim() ? <span key={i}>{r.trim().replace(/_/g, " ")}</span> : null)}
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Visits" right={num(d.visits.length)}>
            <div className="i-card">
              {d.visits.length ? (
                <ul className="i-rows">
                  {d.visits.map((v) => (
                    <li key={v.id}>
                      <span className="p" title={pathOf(v)}>{pageOf(v)}</span>
                      <span className="t">{prettyWhen(v.seen_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="i-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                  Never visited — research found them at {d.company?.name ?? "this company"}.
                </p>
              )}
            </div>
          </Section>

          <Research
            company={d.company} buildings={d.buildings} hits={d.hits} signals={d.signals}
            people={d.coPeople} visits={d.coVisits} drafts={d.coDrafts}
          />
        </div>

        <div className="stick">
          {/* "Draft", never "Draft · blocked". Nothing is blocked from the rep:
              the words are right there and can be copied and sent by hand. What
              is blocked is the automatic send, which is a different sentence and
              belongs under the heading, not in it. */}
          <Section title="Draft">
            <div className="i-card">
              {draft && !draft.body ? (
                /* Six rows carry a reason and no body: consultants the copy
                   system refuses on purpose, because a partner gets a different
                   motion from a buyer. That is a decision, not a missing draft. */
                <div className="i-tone flat">
                  <b>No draft written, deliberately.</b>{" "}
                  {(draft.validator_reasons ?? []).join("; ")
                    || "The copy system declined to write to this kind of account."}
                </div>
              ) : draft ? (
                <>
                  {blocked ? <Gate reasons={draft.validator_reasons} /> : null}
                  <Draft subject={draft.subject} body={draft.body} to={p.email} />
                  {draft.opener_fact ? (
                    /* Evidence, and evidence reads as confirmation — so it wears
                       the green rule rather than the grey small print it used to. */
                    <div className="i-lb good" style={{ marginTop: 14 }}>
                      <b>The opening line is built on this:</b> {draft.opener_fact}
                      {(draft.evidence_urls ?? []).map((u, i) => (
                        <span key={i}> · <a href={u} target="_blank" rel="noreferrer">source</a></span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : borrowed ? (
                <>
                  {/* A borrowed draft carries its own verdict, and 350 of the 355
                      are blocked — so saying nothing here handed a rep a blocked
                      draft with the words "it is ready" under it. */}
                  {borrowed.validator_status === "blocked"
                    ? <Gate reasons={borrowed.validator_reasons} /> : null}
                  <div className="i-quote">
                    <div className="borrowed">
                      Nothing was written for {p.first_name || "them"}. This one was written for{" "}
                      {borrowed.full_name || borrowed.person_email} at the same company — the pitch
                      is the company&rsquo;s, so it is what {p.first_name || "they"} would get.
                    </div>
                    <div className="subj">{borrowed.subject}</div>
                    <pre>{borrowed.body}</pre>
                  </div>
                  <p className="i-note" style={{ marginBottom: 0 }}>
                    {!p.email
                      ? "No address for them yet — worth finding one before you rewrite it."
                      : borrowed.validator_status === "blocked"
                      ? "Copy it and change the name, but read the reason above first."
                      : "Copy it, change the name, and it is ready."}
                  </p>
                </>
              ) : (
                <div className="i-empty">
                  No draft written for {p.first_name || "this person"}, and none for anyone else at{" "}
                  {d.company?.name ?? "this company"} either.
                </div>
              )}
            </div>
          </Section>

          {d.emails.length > 1 ? (
            <Section title="Other drafts" right={num(d.emails.length - 1)}>
              <div className="i-card">
                <div className="i-facts">
                  {d.emails.slice(1).map((e) => (
                    <div key={e.id}>
                      <span className="k" style={{ whiteSpace: "normal" }}>{e.subject}</span>
                      <span className="v">
                        {e.validator_status === "blocked"
                          ? <span className="i-chip failed"><span className="mark" />blocked</span>
                          : <span className="i-chip done"><span className="mark" />passed</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="History">
            <div className="i-card">
              <p className="i-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                {/* Not "outreach status is not_started" — that column reads
                    `not_started` on all 2,446 people and says nothing. What is
                    true is that nothing has ever been sent from here at all.
                    There is no "pushed" branch: the pipeline has no send step,
                    so `pushed_at` cannot be set and a branch reading it would be
                    a line of code that can never run. */}
                Nothing has been sent to {p.first_name || "them"}. The pipeline does not send,
                so every draft here is one to copy and send by hand.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
