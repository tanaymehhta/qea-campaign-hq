import "../inbound.css";
import { prettyWhen, num } from "../../../lib/db";
import { money } from "../../../lib/pipeline";
import { loadSystem } from "../../../lib/inbound/system";
import { share } from "../../../lib/inbound/queue";
import { cap } from "../../../lib/inbound/words";

export const dynamic = "force-dynamic";

/**
 * How the whole system is doing — every company, all time, no filters.
 *
 * The queue is a morning read: one rep, one window, what to work. It cannot
 * answer "of everything that has ever arrived, how much came out the other
 * end", because filtering to a rep and seven days is the whole point of it.
 * This page never filters, and every figure on it is stated as a share of the
 * step above so the funnel can be checked against itself top to bottom.
 *
 * Nothing here is a second opinion. The stage table is drawn by the same
 * `timeline` that draws the four dots on a company's own page, called once per
 * company with the same arguments, so a number here and the dots there are the
 * same claim rather than two implementations of it.
 */

function Sec({ title, right }) {
  return (
    <div className="i-sec">
      <h2 className="i-h2">{title}</h2>
      <span className="line" />
      {right != null ? <span className="n">{right}</span> : null}
    </div>
  );
}

/**
 * One step of the funnel: what came in, what got through, and the width of the
 * bar as the share it represents. The bar is the point — four numbers in a
 * column read as four facts, and the same four with a width read as a drop.
 */
function Step({ label, value, of, note, tone, children }) {
  const pct = of ? Math.max(1, Math.round((value / of) * 100)) : 100;
  return (
    <div className="i-step">
      <div className="head">
        <span className="lbl">{label}</span>
        <span className={`fig${tone ? ` ${tone}` : ""}`}>
          {num(value)}
          {of ? <span className="of"> of {num(of)} · {share(value, of)}</span> : null}
        </span>
      </div>
      <div className="i-bar"><i className={tone ?? ""} style={{ width: `${pct}%` }} /></div>
      {note ? <div className="i-note">{note}</div> : null}
      {children}
    </div>
  );
}

/** A stage's four outcomes as one row of counts, worst first where it matters. */
function StageRow({ row, total }) {
  const cells = [
    { k: "ok", label: "Worked", n: row.ok, tone: "good" },
    { k: "bad", label: "Failed", n: row.bad, tone: "bad" },
    { k: "none", label: "Ran, empty", n: row.none },
    { k: "todo", label: "Never ran", n: row.todo },
  ];
  return (
    <tr>
      <td className="name">
        <b>{row.label}</b>
        <div className="dim">{row.work}</div>
      </td>
      {cells.map((c) => (
        <td key={c.k} className={c.n ? "" : "zero"}>
          <span className={c.tone === "good" && c.n ? "ok" : c.tone === "bad" && c.n ? "no" : ""}>
            {num(c.n)}
          </span>
          <div className="dim">{share(c.n, total)}</div>
        </td>
      ))}
      <td className={row.retried ? "" : "zero"}>{num(row.retried)}</td>
    </tr>
  );
}

export default async function System() {
  const d = await loadSystem();
  const { traffic, companies, stats, runs } = d;
  const sendable = stats.passing;

  return (
    <div className="i-page">
      <header className="i-head rise">
        <h1 className="i-h1">How the system is doing</h1>
        <p className="i-sub">
          Every company since the first visit on {prettyWhen(traffic.first)}, with no rep filter
          and no window. The queue answers what to work this morning; this answers how much of
          what arrived ever came out the other end, and where the rest of it stopped.
        </p>
        <div className="i-links">
          <a href="/inbound">Queue</a>
          <span className="sep">·</span>
          <a href="/inbound/drafts">Every draft</a>
          <span className="sep">·</span>
          <a href="/pipeline">Pipeline trace</a>
        </div>
      </header>

      {/* The funnel, in the order it happens, each step a share of the one above
          it. A reader can add it up and check the page against itself. */}
      <section>
        <Sec title="From a visit to a sendable email"
             right={`${prettyWhen(traffic.first)} — ${prettyWhen(traffic.last)}`} />
        <div className="i-card i-steps">
          <Step label="Visits RB2B sent us" value={traffic.posts} />
          <Step label="Visits it could identify" value={traffic.parsed} of={traffic.posts}
                note={`${num(traffic.dropped)} arrived with no company name and no domain, so there was nothing to research.`}>
            {traffic.drops.length ? (
              <ul className="i-rows">
                {traffic.drops.map(([why, n]) => (
                  <li key={why}><span className="p">{cap(why)}</span><span className="t">{num(n)}</span></li>
                ))}
              </ul>
            ) : null}
          </Step>
          {/* No percentage on this one, deliberately: the step above it counts
              visits and this one counts companies, and one company visits many
              times. "88 of 174 · 51%" was a real ratio between two things that
              do not divide into each other. */}
          <Step label="Companies those visits identified" value={companies.inQueue}
                note={`From ${num(traffic.parsed)} identified visits — one company visits many times. ${
                  num(companies.excluded)} more accounts exist but are left out: typed in by hand, never visited, or on a domain that cannot resolve.`} />
          <Step label="Companies research finished on" value={stats.researched} of={companies.inQueue}
                tone={stats.researched < companies.inQueue / 2 ? "bad" : undefined}
                note={`${num(stats.failed)} failed, and ${num(stats.notResearched)} ${
                  stats.notResearched === 1 ? "was" : "were"} never looked at.`} />
          <Step label="Companies we found a person at" value={companies.withPeople} of={companies.inQueue}
                note={`${num(stats.people)} people in total, an average of ${
                  companies.withPeople ? Math.round(stats.people / companies.withPeople) : 0
                } at each company that has any.`} />
          <Step label="People with a draft written" value={stats.drafted} of={stats.people}
                note={`Across ${num(companies.withDrafts)} of ${num(companies.inQueue)} companies.`} />
          <Step label="Drafts that pass the send gate" value={sendable} of={stats.drafts}
                tone="bad"
                note="The validator's own verdict. Nothing has ever been sent — push is a permanent no-op." />
        </div>
      </section>

      {/* The stage table. This is the answer to "is research actually done on
          every company", and it separates the three ways it can be not-done. */}
      <section>
        <Sec title="Every stage, on every company" right={`${num(companies.inQueue)} companies`} />
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Stage</th>
                <th>Worked</th>
                <th>Failed</th>
                <th>Ran, empty</th>
                <th>Never ran</th>
                <th>Retried</th>
              </tr>
            </thead>
            <tbody>
              {d.stages.map((row) => (
                <StageRow key={row.stage} row={row} total={companies.inQueue} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="i-note" style={{ lineHeight: 1.6, maxWidth: "78ch", marginTop: 12 }}>
          <b>Ran, empty</b> is the state that used to read as a green tick: every node reported ok
          and the stage left nothing behind. <b>Failed</b> counts a stage as failed when any node
          inside it recorded an error, including the ones that report ok while carrying a 402 in
          their own output. These are read off the same function that draws the four dots on a
          company&rsquo;s page, so the two always agree.
        </p>
        {/* The one place two honest numbers on this page disagree, said out loud
            rather than left for a reader to catch. */}
        <p className="i-note" style={{ lineHeight: 1.6, maxWidth: "78ch", marginTop: 10 }}>
          This table and the funnel above it count research differently, and both are right.
          The funnel asks the <b>company record</b> — does it hold a real classification, or an
          error where one should be. This table asks the <b>latest run</b> — did stage 1 execute
          with nothing failing inside it. A company classified successfully in July whose most
          recent re-run hit a 402 is finished by the first measure and failed by the second.
        </p>
      </section>

      {/* Not "what failed" — what to go and fix, in the order it costs most. */}
      <section>
        <Sec title="What is stopping it" right={`${num(d.blockers.reduce((t, b) => t + b.n, 0))} recorded failures`} />
        {d.blockers.length ? (
          <div className="card tw">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>What went wrong</th>
                  <th>Times</th>
                  <th style={{ textAlign: "left" }}>Where</th>
                </tr>
              </thead>
              <tbody>
                {d.blockers.map((b) => (
                  <tr key={b.reason}>
                    <td className="name"><b>{cap(b.reason)}</b></td>
                    <td>{num(b.n)}</td>
                    <td className="dim" style={{ textAlign: "left" }}>{b.nodes.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="i-empty"><b>Nothing recorded a failure.</b></div>
        )}
      </section>

      {/* Every figure here is the same {companies.inQueue} companies the rest of
          the page counts. It has to be: a total taken over one population and
          divided by the size of another is not a cost per anything. */}
      <section>
        <Sec title="What it has cost" right={`${num(companies.inQueue)} companies`} />
        <div className="i-stats">
          <div className="i-stat">
            <span className="i-num num">{money(runs.spent)}</span>
            <span className="i-label">Spent</span>
            <span className="i-note">across {num(runs.total)} pipeline runs</span>
          </div>
          <div className="i-stat">
            <span className="i-num num">{num(runs.credits)}</span>
            <span className="i-label">Apollo credits</span>
            <span className="i-note">finding and revealing people</span>
          </div>
          <div className="i-stat">
            <span className="i-num num">{money(companies.inQueue ? runs.spent / companies.inQueue : 0)}</span>
            <span className="i-label">Per company</span>
            <span className="i-note">
              {money(runs.spent)} over {num(companies.inQueue)} companies
            </span>
            <span className="i-foot">every run, including the failed ones</span>
          </div>
          <div className="i-stat">
            <span className="i-num num">
              {sendable ? money(runs.spent / sendable) : "—"}
            </span>
            <span className="i-label">Per sendable email</span>
            <span className="i-note">
              {sendable ? "what one email that passes has cost" : "nothing passes, so there is no figure"}
            </span>
          </div>
        </div>
        {runs.elsewhere.runs ? (
          <p className="i-note" style={{ lineHeight: 1.6, maxWidth: "78ch", marginTop: 12 }}>
            A further <b>{money(runs.elsewhere.spent)}</b> across {num(runs.elsewhere.runs)} runs
            was spent on {num(runs.elsewhere.companies)} companies that are not in this queue —
            the hand-typed test accounts and the unresolvable domains. Real money, on work this
            page is not about, so it is named here rather than folded into the figures above.
          </p>
        ) : null}
      </section>
    </div>
  );
}
