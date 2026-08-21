import { Fragment } from "react";
import "./inbound.css";
import { prettyWhen, num } from "../../lib/db";
import { money, dateWindow } from "../../lib/pipeline";
import { ALL_REPS, REGIONS, repById } from "../../lib/inbound/routing";
import { cap, errorReason, isCreditError, RUNNING_CHIP } from "../../lib/inbound/words";
import { RelevanceToggle, RestartButton, ReachedOut } from "./controls";
import { Live } from "./live";
import { Running } from "./running";
import {
  loadQueue, filterLeads, byLane, pageOf, pathOf, CO_LANES, RANGES, VIEWS, tally, share,
} from "../../lib/inbound/queue";

export const dynamic = "force-dynamic";

/**
 * The inbound queue, as a salesperson opens it.
 *
 * One list, of companies: everything inbound produces hangs off one — the person
 * RB2B named, the colleagues research found around them, the buildings, the
 * laws, the drafts. Open a company and its people are inside.
 *
 * Territory decides whose queue a lead lands in.
 *
 * This section reads `inbound_*` and writes to it in exactly three places, all
 * of them a rep overruling the pipeline — see `actions.js`. Everything else is
 * read-only, and the anon key still cannot UPDATE any inbound table directly:
 * the three writes go through `security definer` functions that validate their
 * own arguments.
 *
 * The pipeline's own view of itself — did each stage run, what did it cost, which
 * node failed — is a different question for a different reader, and lives at
 * `/pipeline`.
 */

/**
 * Every link on this page carries the whole filter, picked dates included —
 * changing the rep must not silently widen the window back to seven days.
 * Pressing a preset passes `from: null, to: null`, which is how a preset gets
 * to win: the dates leave the URL rather than being overridden in place.
 */
// No future dates in the pickers. Evaluated per request — the page is
// force-dynamic, so this is today rather than the day of the last build.
const TODAY = () => new Date().toISOString().slice(0, 10);

const href = ({ rep, range, as, show = "all", from = null, to = null }) =>
  `/inbound?rep=${rep}&range=${range}&as=${as}&show=${show}`
  + (from ? `&from=${from}` : "") + (to ? `&to=${to}` : "");

/**
 * The window, as a sentence. Slotting the option's own label into "seen in the
 * last …" worked for the two middle options and produced "seen in the last all"
 * and "seen in the last today" for the other two.
 */
const seenWhen = (range, win) =>
  win?.custom
    ? (win.from && win.to
        ? (win.from === win.to ? `seen on ${win.from}` : `seen ${win.from} to ${win.to}`)
        : win.from ? `seen since ${win.from}` : `seen up to ${win.to}`)
    : range === "all" ? "all time"
    : range === "1" ? "seen today"
    : `seen in the last ${range} days`;

/**
 * A figure, and the whole card is the way into it.
 *
 * Number first, label under it, note under that — the reverse of the dashboard's
 * `Tile`, and the reason this header scans faster: the eye lands on the figure
 * without reading a label to find it. `Tile` keeps its own order, because six
 * other pages are built around it.
 *
 * `note` is the figure as a share of something and `foot` is the second fact
 * about it — usually the remainder — across a hairline at the bottom. A count
 * with no denominator is a number nobody can judge: 506 emails drafted is good
 * or terrible depending on how many people it left out, and the card now says.
 * Keep both short; at six to a row a card is about twenty characters wide.
 */
function Stat({ label, value, note, foot, tone, href: to, on }) {
  const inner = (
    <>
      <span className={`i-num num${tone ? ` ${tone}` : ""}`}>{value}</span>
      <span className="i-label">{label}</span>
      {note ? <span className="i-note">{note}</span> : null}
      {foot ? <span className="i-foot">{foot}</span> : null}
    </>
  );
  const cls = `i-stat${on ? " on" : ""}`;
  return to ? <a className={cls} href={to}>{inner}</a> : <div className={cls}>{inner}</div>;
}

/** Section label, a rule, and the count on the end of it. */
function Sec({ title, right }) {
  return (
    <div className="i-sec">
      <h2 className="i-h2">{title}</h2>
      <span className="line" />
      {right != null ? <span className="n">{right}</span> : null}
    </div>
  );
}

function RepMark({ reps }) {
  const rep = repById(reps[0]);
  return (
    <span className="rep" title={reps.map((r) => repById(r).name).join(" and ")}>
      <i style={{ background: rep.tint }}>{rep.initials}</i>
      {rep.name.split(" ")[0]}{reps.length > 1 ? ` +${reps.length - 1}` : ""}
    </span>
  );
}

/**
 * What research found, on every card without exception.
 *
 * Rendering this row only when there is something to say made the grid read as
 * if half the cards were still loading — a card with no findings looked broken
 * rather than researched-and-empty. Silence and nothing are different answers,
 * so the empty case says which one it is.
 */
function Hooks({ hooks }) {
  if (!hooks?.length) {
    return <div className="i-tags empty"><span>No research findings yet</span></div>;
  }
  return (
    <div className="i-tags">
      {hooks.slice(0, 3).map((h, k) => <span key={k} title={h}>{h}</span>)}
    </div>
  );
}

/** A company: an account, with everything known about it one click away.
 *
 *  The lane control sits outside the anchor rather than inside it: a <form>
 *  nested in a link is invalid HTML, and browsers resolve it by dropping one of
 *  the two — usually the one you wanted. It sits in a links row under the card
 *  rather than a floating strip, because moving a company out of the queue is a
 *  sideways move like every other link on these pages. */
function CompanyCard({ lead, i, touch, rep }) {
  // A card mid-restart is not a failed card. The red block explains the run
  // being replaced right now, so it collapses with the button inside it — the
  // same mistake the timeline already stopped making, which is showing a stale
  // reading beside a live one as though they were a sequence. The line that
  // takes its place sits in the same slot at the foot, so the card does not
  // rearrange itself around the reader.
  const failed = lead.chip.state === "failed" && !lead.busy;
  const chip = lead.busy ? RUNNING_CHIP : lead.chip;
  const why = failed ? errorReason(lead.company?.account_type_reason) : null;
  return (
    <div className={`i-cowrap${failed ? " failed" : ""}${lead.busy ? " busy" : ""}${touch ? " touched" : ""}`}
         style={{ animationDelay: `${Math.min(i, 14) * 0.03}s` }}>
      {/* The rep rides along: open a company from Mark Vasu's queue and the
          tick on that page is already his, with no dropdown. */}
      <a className="i-co" href={`/inbound/company/${lead.id}${rep && rep !== "all" ? `?rep=${rep}` : ""}`}>
        <div className="top">
          <div className="nm">{lead.name}</div>
          {/* What happened to research, on every card. This is what the deleted
              "Not researched yet" lane was trying to say and said wrongly: those
              companies were researched, and the research crashed. */}
          <span className={`i-chip ${chip.state}`} title={chip.long}>
            <span className="mark" />{chip.label}
          </span>
        </div>

        {/* Every slot filled on every card, including the ones with nothing in
            them — a missing line reads as a different kind of company, not as a
            company we know less about. */}
        <div className="who i-body">
          {lead.domain ?? "no domain"} · <b title={lead.verdict.long}>{lead.verdict.short}</b>
          {lead.verdict.conflict
            ? <span className="dim"> (typed {lead.verdict.conflict})</span> : null}
          {lead.ready ? <span className="dim"> · {lead.ready} ready to email</span> : null}
        </div>

        <Hooks hooks={lead.hooks} />

        {/* Four questions, in the same four places on every card. */}
        <div className="i-strip">
          <div>
            <div className="i-label">Visited from</div>
            <div className={`v${lead.place ? "" : " dim"}`}
                 title={`Territory read from the ${lead.basis}`}>
              {lead.place || REGIONS[lead.region].short}
            </div>
          </div>
          <div>
            <div className="i-label">Rep</div>
            <div className="v"><RepMark reps={lead.reps} /></div>
          </div>
          <div>
            <div className="i-label">Visits</div>
            <div className={`v${lead.visitCount ? "" : " dim"}`}
                 title={lead.lastVisit ? `${pageOf(lead.lastVisit)} · ${prettyWhen(lead.lastVisit.seen_at)}` : undefined}>
              {num(lead.visitCount)}
            </div>
          </div>
          <div>
            <div className="i-label">Cost</div>
            <div className={`v${lead.spent ? "" : " dim"}`}>{money(lead.spent)}</div>
          </div>
        </div>
      </a>

      <div className="i-cofoot">
        {lead.busy ? <RestartButton companyId={lead.id} busy={lead.busy} /> : null}
        {failed ? (
          <div className="i-tone bad">
            <b>Research failed.</b> {cap(why)}.
            <div style={{ marginTop: 10 }}><RestartButton companyId={lead.id} stage={1} small wasCredit={isCreditError(why)} /></div>
          </div>
        ) : null}
        <div className="i-links">
          {/* First in the row, and the only control here anybody presses daily.
              Moving a company out of the queue is a rarer, heavier decision, so
              it keeps its place on the right. */}
          <ReachedOut companyId={lead.id} touch={touch} rep={rep} />
          <span className="push" />
          <RelevanceToggle companyId={lead.id} relevant={lead.lane !== "irrelevant"} />
        </div>
      </div>
    </div>
  );
}

function CompanyTable({ rows, rep }) {
  return (
    <div className="card tw">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th style={{ textAlign: "left" }}>Company</th>
            <th style={{ textAlign: "left" }}>Where</th>
            <th style={{ textAlign: "left" }}>Type</th>
            <th>Visits</th>
            <th style={{ textAlign: "left" }}>Last seen</th>
            <th>Contacts</th>
            <th>Ready</th>
            <th style={{ textAlign: "left" }}>Rep</th>
            <th style={{ textAlign: "left" }}>Reached out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id}>
              <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
              <td className="name">
                <a href={`/inbound/company/${l.id}${rep && rep !== "all" ? `?rep=${rep}` : ""}`}>{l.name}</a>
                <div className="dim">{l.domain}</div>
              </td>
              <td className="dim" style={{ textAlign: "left" }}>
                {l.place || "—"} · {REGIONS[l.region].short}
              </td>
              <td className="dim" style={{ textAlign: "left" }}>
                {l.verdict.short}
              </td>
              <td className={l.visitCount ? "" : "zero"}>{num(l.visitCount)}</td>
              <td className="dim" style={{ textAlign: "left" }}>
                {l.lastVisit ? prettyWhen(l.lastVisit.seen_at) : "—"}
              </td>
              <td className={l.contacts.length ? "" : "zero"}>{num(l.contacts.length)}</td>
              <td className={l.ready ? "" : "zero"}>{num(l.ready)}</td>
              <td className="dim" style={{ textAlign: "left" }}>
                {l.reps.map((r) => repById(r).name.split(" ")[0]).join(" + ")}
              </td>
              {/* The same fact as the tick on the card. The table is a scan, so
                  it reads rather than presses — the control lives on the card
                  and on the company page. */}
              <td className="dim" style={{ textAlign: "left" }}>
                {l.touch
                  ? `${repById(l.touch.by)?.name.split(" ")[0] ?? l.touch.by} · ${prettyWhen(l.touch.at)}`
                  : "—"}
              </td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={10} className="empty">Nothing here.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export default async function Inbound({ searchParams }) {
  // Every one of the three has to be checked against its own set. An id that no
  // longer exists — a stale bookmark, a renamed rep — used to reach `chip.name`
  // on a null and 500 the whole queue, which is a bad answer to a typo.
  const rep = repById(searchParams?.rep) ? searchParams.rep : "all";
  const range = RANGES.some(([k]) => k === searchParams?.range) ? searchParams.range : "7";
  const as = searchParams?.as === "table" ? "table" : "cards";
  // A picked window. `dateWindow` throws out anything that is not a yyyy-mm-dd,
  // so a mangled bookmark falls back to the preset instead of filtering to zero.
  const from = searchParams?.from ?? null;
  const to = searchParams?.to ?? null;
  const win = dateWindow({ range, from, to });

  const show = VIEWS[searchParams?.show] ? searchParams.show : "all";
  const { companies, traffic, excluded } = await loadQueue();

  const inRange = filterLeads(companies, { rep: null, range, from, to });
  // What the header counts and what the list shows are the same set, minus the
  // tile the reader is standing on — the tiles are the picker for that last
  // filter, so they must not count themselves out of existence.
  const scope = filterLeads(companies, { rep, range, from, to });
  const rows = scope.filter(VIEWS[show].of);
  const stats = tally(scope);
  // The footer talks about the whole queue, whatever the header is filtered to.
  const everything = tally(companies);
  const lanes = CO_LANES.map((l) => ({ ...l, rows: byLane(rows, l.id) }));

  const chip = repById(rep);
  const unrouted = companies.filter((l) => l.region === "UNKNOWN").length;
  const here = { rep, range, as, show, from: win.from, to: win.to };
  const pickers = [{ id: "all", name: "All reps", initials: "ALL", tint: "var(--tint-n)" }, ...ALL_REPS];

  // Everything in flight, not just what this filter shows. A run the window
  // hides is still the run yours is queued behind — the workflow's concurrency
  // group is section-wide — so hiding it would leave that wait unexplained.
  const busy = companies.filter((l) => l.busy);

  return (
    <div className="i-page">
      {/* This page was a photograph: it never asked the database a second time,
          so a restart pressed here could not have changed it however long you
          stared. The interval exists for as long as the work does. */}
      {busy.length ? <Live /> : null}
      {searchParams?.err
        ? <div className="i-tone bad">That didn&rsquo;t save — {searchParams.err}</div> : null}
      {/* Refused on purpose, which is not the same as broken. "That didn't
          save" tells a rep to press again; this tells them why not to. */}
      {searchParams?.nope
        ? <div className="i-tone bad">Not started — {searchParams.nope}.</div> : null}
      {/* The banner that used to stand here said "Restart asked for … Reload to
          see it". The dock says it better and the page reloads itself now, so
          both halves of that sentence were retired rather than reworded. */}

      <header className="i-head rise">
        <h1 className="i-h1">Inbound queue</h1>
        <p className="i-sub">
          Every company that visited the site, in the queue of the rep who covers them.
        </p>
      </header>

      {/* Two rows, and they answer two different questions. The first is the
          work available to a rep this morning; the second is whether the
          machine that produced it is healthy — which nothing on this page could
          say before, so 56 crashed companies looked like 56 quiet ones.

          Every number counts the same companies the list below shows, so the
          window and the rep chips move them. The caption says which set, out
          loud, because a number with an unstated scope is a number nobody can
          check. */}
      <section>
        <Sec title="This morning"
             right={`Counting ${rep === "all" ? "every rep" : chip.name} · ${seenWhen(range, win)}`} />
        {/* Every card that is a share of something says so, and says of what.
            "2,296 people found" over "506 emails drafted" reads as a pair of
            unrelated facts until the second one says 22% of the first; then it
            reads as the thing to go and fix. Checked against the database on
            2026-08-17: every figure on this row agrees with a direct count. */}
        <div className="i-stats">
          <Stat label="Companies" value={num(stats.companies)}
                on={show === "all"} href={href({ ...here, show: "all" })} />
          <Stat label="People found" value={num(stats.people)}
                note={`across ${num(stats.companies)} companies`}
                on={show === "people"} href={href({ ...here, show: "people" })} />
          <Stat label="Researched" value={num(stats.researched)}
                note={`${share(stats.researched, stats.companies)} of companies`}
                foot={`${num(stats.notResearched)} not researched`}
                on={show === "researched"} href={href({ ...here, show: "researched" })} />
          <Stat label="Emails drafted" value={num(stats.drafted)}
                note={`${share(stats.drafted, stats.people)} of the people found`}
                foot={`${num(stats.people - stats.drafted)} with no draft`}
                on={show === "drafted"} href={href({ ...here, show: "drafted" })} />
          <Stat label="New this week" value={num(stats.fresh)}
                note="first seen in 7 days"
                on={show === "fresh"} href={href({ ...here, show: "fresh" })} />
          <Stat label="Spent" value={money(stats.spent)} note="on these companies" />
        </div>
        <div className="i-stats">
          <Stat label="Apollo credits" value={num(stats.credits)} note="finding these people" />
          <Stat label="Verified emails" value={num(stats.verified)}
                note={`${share(stats.verified, stats.people)} of the people found`}
                foot={`${num(stats.people - stats.verified)} not verified`} />
          <Stat label="Passing the send gate" value={num(stats.passing)}
                note={`${share(stats.passing, stats.drafts)} of ${num(stats.drafts)} drafts`}
                href="/inbound/drafts" />
          <Stat label="Research failed" value={num(stats.failed)}
                tone={stats.failed ? "bad" : undefined}
                note={`${share(stats.failed, stats.companies)} of companies`}
                foot="never returned a verdict"
                on={show === "failed"} href={href({ ...here, show: "failed" })} />
          {/* The one number that cannot follow the filters: a webhook that failed
              to parse never got a company_id, so there is nothing to filter it
              by. It says "all time" rather than quietly ignoring the window. */}
          <Stat label="Visits dropped" value={num(traffic.dropped)}
                tone={traffic.dropped ? "bad" : undefined}
                note={`${share(traffic.dropped, traffic.total)} of ${num(traffic.total)} · all time`}
                foot="never became a company" />
        </div>
      </section>

      <section>
        <Sec title="Whose queue" />
        <div className="i-reps">
          {pickers.map((r) => {
            const mine = r.id === "all" ? inRange : inRange.filter((l) => l.reps.includes(r.id));
            const ready = mine.reduce((t, c) => t + c.ready, 0);
            return (
              <a key={r.id} href={href({ ...here, rep: r.id })}
                 className={`i-rep${rep === r.id ? " on" : ""}`}>
                <i style={{ background: r.tint }}>{r.initials}</i>
                <span>
                  <span className="nm">{r.id === "all" ? "All reps" : r.name}</span>
                  <span className="sub">
                    {num(mine.length)} compan{mine.length === 1 ? "y" : "ies"}
                    {ready ? ` · ${ready} ready` : ""}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </section>

      <div className="i-controls">
      <div className="i-segrow">
        <div className="i-seg">
          {RANGES.map(([k, label]) => (
            <a key={k} href={href({ ...here, range: k, from: null, to: null })}
               className={!win.custom && String(range) === String(k) ? "on" : ""}>{label}</a>
          ))}
        </div>
        {/* The window the presets cannot say — last Tuesday, or the four days
            somebody is asking about in a meeting. Native `<input type="date">`,
            so the calendar, the keyboard handling and the locale all come from
            the browser: no picker library, no client component, and the window
            ends up in the URL where it can be pasted to somebody else. The
            hidden fields carry the rest of the filter through the GET, which a
            form would otherwise drop. */}
        <form className="i-dates" method="GET" action="/inbound">
          <input type="hidden" name="rep" value={rep} />
          <input type="hidden" name="as" value={as} />
          <input type="hidden" name="show" value={show} />
          <label>From <input type="date" name="from" max={TODAY()}
                             defaultValue={win.from ?? ""} /></label>
          <label>To <input type="date" name="to" max={TODAY()}
                           defaultValue={win.to ?? ""} /></label>
          <button type="submit">Apply</button>
          {win.custom
            ? <a href={href({ ...here, range: "7", from: null, to: null })}>Clear</a>
            : null}
        </form>

        <div className="i-seg">
          {[["cards", "Cards"], ["table", "Table"]].map(([k, label]) => (
            <a key={k} href={href({ ...here, as: k })}
               className={as === k ? "on" : ""}>{label}</a>
          ))}
        </div>
        <span className="i-note">
          {num(rows.length)} compan{rows.length === 1 ? "y" : "ies"}
          {rep !== "all" ? ` for ${chip.name}` : ""} · {seenWhen(range, win)}
          {show !== "all" ? ` · ${VIEWS[show].label.toLowerCase()}` : ""}
        </span>
        {show !== "all" ? (
          <span className="i-links">
            <a href={href({ ...here, show: "all" })}>Clear filters</a>
          </span>
        ) : null}
      </div>

      {/* Not a filter — a way down the page. The lanes are both worth reading
          and the second one starts below the fold, so this walks you to it
          rather than hiding the other half behind a chip you have to press
          twice. Plain anchors: the browser already knows how to do this. */}
      {as === "cards" && rows.length ? (
        <div className="i-links i-jump">
          <span className="i-note">Jump to</span>
          {lanes.map((lane, i) => (
            <Fragment key={lane.id}>
              {i ? <span className="sep">·</span> : null}
              <a href={`#${lane.id}`}>{lane.label} <b>{num(lane.rows.length)}</b></a>
            </Fragment>
          ))}
        </div>
      ) : null}
      </div>

      {!rows.length ? (
        <div className="i-empty">
          <b>Nothing here.</b> No {rep === "all" ? "" : `${chip.name.split(" ")[0]} `}
          company matches this window{show === "all" ? "" : " and this filter"}.{" "}
          <a href={href({ rep, range: "all", as })}>All time, no filters</a> holds{" "}
          {num(filterLeads(companies, { rep, range: "all" }).length)}.
        </div>
      ) : as === "table" ? (
        <CompanyTable rows={rows} rep={rep} />
      ) : (
        lanes.map((lane) => (
          <section key={lane.id} id={lane.id}>
            <Sec title={lane.label} right={num(lane.rows.length)} />
            {lane.rows.length ? (
              <div className="i-grid">
                {lane.rows.map((l, i) => (
                  <CompanyCard key={l.id} lead={l} i={i} touch={l.touch} rep={rep} />
                ))}
              </div>
            ) : (
              <div className="i-empty">None in this window.</div>
            )}
          </section>
        ))
      )}

      <p className="i-note" style={{ lineHeight: 1.6, maxWidth: "78ch" }}>
        {num(everything.companies)} companies in all and the {num(everything.people)} people
        found at them.{" "}
        {num(excluded)} more accounts are left out — typed in by hand to test the pipeline,
        never visited, or sitting on a domain that cannot resolve. They hold most of the
        drafted emails, so the number is said here rather than left to be noticed.{" "}
        {num(unrouted)} companies sit under Unrouted because nothing on the record says where
        they are. Ready and Needs a check come from the pipeline itself, not from this page.
      </p>

      {/* The queue is one rep and one window by design. The question that filter
          cannot answer — of everything that ever arrived, how much came out —
          has its own page rather than a thirteenth card up top. */}
      <div className="i-links">
        <a href="/inbound/system">How the whole system is doing</a>
        <span className="sep">·</span>
        <a href="/inbound/drafts">Every draft it has written</a>
      </div>

      <Running rows={busy} />
    </div>
  );
}
