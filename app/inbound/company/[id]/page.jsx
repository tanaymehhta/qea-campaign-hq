import "../../inbound.css";
import { prettyWhen, num } from "../../../../lib/db";
import { loadCompany, pageOf, pathOf, costs, whyNobody } from "../../../../lib/inbound/queue";
import { money } from "../../../../lib/pipeline";
import { REGIONS, repById } from "../../../../lib/inbound/routing";
import { verdict, bullets, cap, isApiError, isCreditError, errorReason, researchChip, RUNNING_CHIP } from "../../../../lib/inbound/words";
import { Research } from "../../research";
import { RankButtons, ReadyToggle, RelevanceToggle, RestartButton, ReachedOut } from "../../controls";
import { touchOf } from "../../../../lib/inbound/touched";
import { Live } from "../../live";
import { Running } from "../../running";

export const dynamic = "force-dynamic";

const Sep = () => <span className="sep">·</span>;

function Fact({ k, children }) {
  return <div><span className="k">{k}</span><span className="v">{children}</span></div>;
}

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

/* Two glyphs, four lines each, inline. A tick in a circle ran; a cross in a
   rounded square failed. Shape carries the meaning as well as colour, so the
   timeline survives greyscale, a projector and every dichromacy. */
const Tick = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
  </svg>
);
/* Ran, and nothing came out. A third shape rather than a third colour, so it
   still separates from "not run yet" — a dashed ring — in greyscale. */
const Dash = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M6 10h8" strokeLinecap="round" />
  </svg>
);

/**
 * What has happened to this company, said in order.
 *
 * The complaint this answers, verbatim: "why are there no people? did the
 * system break?" Four dots, two colours, and every red one carries the plain
 * reason it is red. The provider's own words go in the fold underneath — a rep
 * should never be handed a 402 as their first sentence, and an engineer should
 * never have to open the database to find one.
 *
 * Under 480px the row turns and runs down the page: four labelled dots across a
 * phone is four truncated words and a line nobody can follow.
 */
function hint(d) {
  if (d.state === "todo") return "Has not run yet.";
  if (d.state === "running") {
    if (d.queued) return "Waiting for the step before it to finish.";
    return d.waiting
      ? `Asked for ${prettyWhen(d.when)}. GitHub is starting a machine — about twenty seconds.`
      : `Started ${prettyWhen(d.when)} and still going.`;
  }
  if (d.stage === 0) return `First seen on ${prettyWhen(d.when)}.`;
  const ran = `Ran ${prettyWhen(d.when)}`;
  if (d.state === "ok") return `${ran} — nothing inside it failed.`;
  if (d.state === "none") return `${ran} — nothing inside it failed, but ${d.reason}.`;
  const n = d.failures.length;
  return n
    ? `${ran} — ${n} step${n === 1 ? "" : "s"} failed: ${d.reason}.`
    : `${ran} — ${d.reason}.`;
}

function Timeline({ dots, companyId, busy }) {
  // Nothing is broken while it is being re-run: every one of these boxes
  // describes the run this restart is replacing.
  const broken = busy ? [] : dots.filter((d) => d.state === "bad" && d.failures.length);
  // Did its job, and something inside it still went wrong. Not a red box with a
  // Restart under it — the stage produced what it was asked for, and re-running
  // it would spend money to be told the same thing.
  const flawed = dots.filter((d) => d.caveat && d.failures.length);
  return (
    <div className="i-tl">
      <ol>
        {dots.map((d) => (
          <li key={d.stage} className={d.state} title={hint(d)}>
            <span className={`i-glyph ${d.state === "ok" ? "good" : d.state}`}>
              {d.state === "ok" ? <Tick />
                : d.state === "bad" ? <Cross />
                : d.state === "none" ? <Dash /> : null}
            </span>
            <span className="lbl">{d.label}</span>
            <span className="when">
              {d.state === "running"
                ? (d.queued ? "waiting its turn" : d.waiting ? "starting…" : "running now…")
                : d.when ? prettyWhen(d.when) : "not yet"}
            </span>
            {d.attempts > 1
              ? <span className="tries">attempt {d.attempts} of {d.attempts}</span> : null}
          </li>
        ))}
      </ol>

      {flawed.length ? (
        <div className="why">
          {flawed.map((d) => (
            <div className="i-note" key={`c${d.stage}`} style={{ display: "block", marginBottom: 10 }}>
              <b>{d.label}:</b> {d.made} on file. The last run still hit a problem:{" "}
              {d.caveat}.
            </div>
          ))}
        </div>
      ) : null}

      {broken.length ? (
        <div className="why">
          {broken.map((d) => (
            <div className="i-tone bad" key={d.stage}>
              <b>{d.label} failed.</b> {cap(d.reason)}.
              <div style={{ marginTop: 10 }}>
                <RestartButton companyId={companyId} stage={d.stage} small
                  wasCredit={isCreditError(d.reason)} busy={busy} />
              </div>
            </div>
          ))}
          <details className="i-show">
            <summary>What the failed steps returned</summary>
            <div className="body">
              {broken.flatMap((d) =>
                d.failures.map((f, i) => (
                  <div className="i-quote" key={`${d.stage}-${i}`}>
                    <div className="subj">{f.node}</div>
                    <pre>{f.raw}</pre>
                  </div>
                )))}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

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
  if (!c) return <><h1 className="i-h1">Not found</h1><p className="i-sub">No company with that id.</p></>;
  const err = searchParams?.err;
  // Which queue you walked in from. The card links carry it, so opening a
  // company out of Mark Vasu's queue signs the tick here without asking. A
  // bookmark straight to this URL carries nothing, and gets the dropdown.
  const rep = repById(searchParams?.rep) ? searchParams.rep : "all";

  const v = verdict(c);
  // Last time's verdict is not the current answer while the classifier is
  // running on it again.
  const chip = d.busy ? RUNNING_CHIP : researchChip(c);
  const spend = costs(d.runs);
  // Why there is nobody, in the terms of what actually ran — not "yet".
  const nobody = whyNobody(d.dots[2], d.nodesByRun.get(d.dots[2].run?.id) ?? [],
                           c.domain, v.lane === "irrelevant");
  const draftFor = (p) =>
    d.emails.find((e) => e.person_id === p.id) ??
    (p.email ? d.emails.find((e) => e.person_email?.toLowerCase() === p.email.toLowerCase()) : null);

  const hq = [c.hq_city, c.hq_state, c.hq_country].filter(Boolean).join(", ");
  // RB2B geolocates whoever was on the site, which is often not where the
  // company is registered. Both are true and a rep should see both.
  const conflict = hq && d.geo.place && !hq.toLowerCase().includes(d.geo.place.split(",")[0].toLowerCase());

  // Something is in flight, so the page will be wrong in a moment unless it
  // asks again. Nothing pushes from the runner; this is the whole live story.
  // `d.busy` rather than a second reading of the dots: the queue reads the same
  // helper, and two derivations of one fact eventually disagree.

  return (
    <div className="i-page">
      {d.busy ? <Live /> : null}
      <header className="i-head rise">
        <h1 className="i-h1">{c.name}</h1>
        <p className="i-sub">
          {c.domain ?? "no domain"}
          {d.geo.place ? ` · visited from ${d.geo.place}` : ""} · {REGIONS[d.geo.region].label} ·{" "}
          <b>{d.reps.map((r) => r.name).join(" and ")}</b>
        </p>

        {/* No arrows. An arrow promises the next step in a sequence; these are
            sideways moves between things that already exist. The one action on
            the whole record lives here too, rather than under a value in the
            record below, where it read as part of the data. */}
        <div className="i-links">
          <a href="/inbound">Queue</a>
          {c.website || c.domain ? (
            <><Sep /><a href={c.website ?? `https://${c.domain}`} target="_blank" rel="noreferrer">Website</a></>
          ) : null}
          {c.linkedin_url ? (
            <><Sep /><a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>
          ) : null}
          <Sep />
          <RelevanceToggle companyId={c.id} relevant={v.lane !== "irrelevant"} />
        </div>

        {/* Under the record, not inside it: this is the one line on the page a
            person wrote rather than a run produced. */}
        <div className="i-links">
          <ReachedOut companyId={c.id} touch={touchOf(c)} rep={rep} />
        </div>
      </header>

      {err ? <div className="i-tone bad">That didn&rsquo;t save — {err}</div> : null}
      {searchParams?.nope
        ? <div className="i-tone bad">Not started — {searchParams.nope}.</div> : null}
      {/* "Reload to see it" retired with the banner: the page reloads itself,
          and the dock in the corner says what is running. */}

      <Timeline dots={d.dots} companyId={c.id} busy={d.busy} />

      {conflict ? (
        <div className="i-tone warn">
          <b>The visit and the company are in different places.</b> Someone browsed from{" "}
          {d.geo.place}, but {c.name} is on file in {hq}. Territory follows the visitor, so this
          sits with {d.reps.map((r) => r.name).join(" and ")} — worth a look before you work it.
        </div>
      ) : null}

      <div className="i-two">
        <div>
          <Section title="The account">
            <div className="i-card">
              <div className="i-facts">
                <Fact k="Worth selling to?">
                  {v.short}
                  {c.account_type_confidence
                    ? <span className="dim"> · {Math.round(c.account_type_confidence * 100)}% sure</span> : null}
                  {v.conflict ? (
                    <span className="dim" style={{ display: "block" }}>
                      Typed {v.conflict}, but research ruled them out.
                    </span>
                  ) : null}
                </Fact>
                {/* What it cost, and what the money bought. No per-name figure:
                    stage 1 is most of it and costs the same whether twenty people
                    turn up or none, so a cost-per-person misleads. */}
                <Fact k="Cost">
                  {spend.rows.length ? (
                    <details className="i-cost">
                      <summary>{money(spend.total)}</summary>
                      <table>
                        <tbody>
                          {spend.rows.map((r) => (
                            <tr key={r.stage}>
                              <td>{r.work}{r.runs > 1 ? ` · ${r.runs} runs` : ""}</td>
                              {/* `money` goes to four places under a cent, which
                                  is right for a node and wrong for a line item
                                  that is simply free. */}
                              <td>{r.usd ? money(r.usd) : "$0.00"}</td>
                              <td className="dim">
                                {[r.llm ? `${num(r.llm)} AI calls` : null,
                                  r.search ? `${num(r.search)} searches` : null,
                                  r.apollo ? `${num(r.apollo)} Apollo credits` : null]
                                  .filter(Boolean).join(", ")}
                              </td>
                            </tr>
                          ))}
                          <tr><td>Total</td><td>{money(spend.total)}</td><td /></tr>
                        </tbody>
                      </table>
                    </details>
                  ) : "—"}
                </Fact>
                {/* 64 of 85 read `unknown`, which renders the word as if it were
                    data. A field we do not hold is left off. */}
                {c.vertical && c.vertical !== "unknown" ? (
                  <Fact k="Vertical">{c.vertical.replace(/_/g, " ")}</Fact>
                ) : null}
                <Fact k="Head office">{hq || "—"}</Fact>
                <Fact k="Visited from">
                  <span title={`Read from the ${d.geo.basis}`}>{d.geo.place || "—"}</span>
                </Fact>
                <Fact k="Staff">{c.employee_count ?? "—"}</Fact>
                <Fact k="Research">
                  <span className={`i-chip ${chip.state}`} title={chip.long}>
                    <span className="mark" />{chip.label}
                  </span>
                </Fact>
              </div>

              {/* The classifier's reasoning, in bullets — except when it is not
                  reasoning at all. 56 of the 95 companies carry a raw 402 in this
                  column, and bulleting a stack trace under the words "why it
                  decided that" is the single worst line on the old page. */}
              {isApiError(c.account_type_reason) ? (d.busy ? null : (
                <div className="i-tone bad" style={{ marginTop: 16 }}>
                  <b>Research failed.</b> {cap(errorReason(c.account_type_reason))} when this
                  company was classified, so nothing was decided about them.
                  <div style={{ marginTop: 10 }}>
                    <RestartButton companyId={c.id} stage={1} small busy={d.busy}
                      wasCredit={isCreditError(c.account_type_reason)}
                      caveat={d.emails.length && !c.assigned_to
                        ? `The ${d.emails.length} draft${d.emails.length === 1 ? "" : "s"} here stay blocked either way — nobody is on file as this account's owner, and the validator will not sign a mail for an owner the record does not name.`
                        : null} />
                  </div>
                </div>
              )) : c.account_type_reason ? (
                <div style={{ marginTop: 18 }}>
                  <div className="i-label" style={{ marginBottom: 8 }}>
                    What kind of company they are
                  </div>
                  <ul className="i-lbs">
                    {bullets(c.account_type_reason, 5).map((b, i) => (
                      <li className="i-lb" key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Visits" right={num(d.visits.length)}>
            <div className="i-card">
              {d.visits.length ? (
                <ul className="i-rows">
                  {d.visits.map((v2) => (
                    <li key={v2.id}>
                      <span className="p" title={pathOf(v2)}>{pageOf(v2)}</span>
                      <span className="t">{prettyWhen(v2.seen_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="i-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                  No visits recorded.
                </p>
              )}
            </div>
          </Section>

          <Research company={c} buildings={d.buildings} hits={d.hits} signals={d.signals}
                    people={d.people} visits={d.visits} drafts={d.emails} />
        </div>

        <div className="stick">
          <Section title="People found" right={num(d.people.length)}>
            <div className="i-card">
              {d.people.length ? (
                /* The name is a link, not a disclosure: one click opens the
                   person. The draft sits behind its own toggle underneath, so
                   reading a draft here and opening a person are two separate
                   actions rather than two clicks at the same thing. */
                d.people.map((p, pi) => {
                  const own = draftFor(p);
                  const shown = own ?? d.emails[0] ?? null;
                  return (
                    <div className="i-per" key={p.id}>
                      <div className="i-perhead">
                        <a className="who" href={`/inbound/person/${p.id}`}>
                          <span className="nm">{p.full_name}</span>
                          {p.visits.length ? (
                            <span className="i-chip done" style={{ marginLeft: 7 }}
                                  title={`Came to the site — ${p.visits.length} visit${p.visits.length === 1 ? "" : "s"}, last on ${pageOf(p.visits[0])}`}>
                              <span className="mark" />visited
                            </span>
                          ) : null}
                          <span className="tt">{p.title ?? "no title on file"}</span>
                          {p.visits.length ? (
                            <span className="tt">
                              {p.visits.length} visit{p.visits.length === 1 ? "" : "s"} ·{" "}
                              {pageOf(p.visits[0])} · {prettyWhen(p.visits[0].seen_at)}
                            </span>
                          ) : (
                            <span className="tt">found by lookup</span>
                          )}
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
                        </a>
                        {/* Outside the anchor: a form nested in a link is invalid
                            HTML, and the browser resolves it by dropping one. */}
                        <span className="i-perside">
                          <RankButtons personId={p.id} companyId={c.id}
                                       first={pi === 0} last={pi === d.people.length - 1} />
                          <ReadyToggle personId={p.id} companyId={c.id}
                                       ready={p.status === "Ready"}
                                       manualled={p.manual_sendable != null} />
                        </span>
                      </div>
                      {shown ? (
                        <details className="i-show">
                          <summary>{own ? "Show the draft" : "Show the draft they would get"}</summary>
                          <div className="body">
                            <div className="i-quote">
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
                                /* A consultant account: refused on purpose, with
                                   the reason recorded. An empty <pre> read as a bug. */
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
                // Never "yet". 46 of the 85 visited companies land here, and they
                // are three different situations — never looked, Apollo has no
                // record, or found them and dropped them all. Each is a different
                // next move, so each gets its own sentence.
                <div className="i-nobody">
                  <div className="head">{nobody.head}</div>
                  <div className="tail">
                    {d.dots[2].when ? `Searched ${prettyWhen(d.dots[2].when)}. ` : ""}
                    {nobody.tail}
                  </div>
                  <RestartButton companyId={c.id} stage={2} busy={d.busy} />
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      <Running rows={[{ id: c.id, name: c.name, busy: d.busy }]} linked={false} />
    </div>
  );
}
