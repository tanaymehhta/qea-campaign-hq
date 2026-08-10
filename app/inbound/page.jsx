import "./inbound.css";
import { prettyWhen, num } from "../../lib/db";
import { Seg, Reps } from "../../components/ui";
import { ALL_REPS, REGIONS, repById } from "../../lib/inbound/routing";
import { verdict } from "../../lib/inbound/words";
import {
  loadQueue, filterLeads, byLane, pageOf, pathOf, CO_LANES, RANGES,
} from "../../lib/inbound/queue";

export const dynamic = "force-dynamic";

/**
 * The inbound queue, as a salesperson opens it.
 *
 * One list, of companies: everything inbound produces hangs off one — the person
 * RB2B named, the colleagues research found around them, the buildings, the
 * laws, the drafts. Open a company and its people are inside.
 *
 * Territory decides whose queue a lead lands in. Nothing here writes; the whole
 * `inbound_*` schema is read-only to this app by design.
 *
 * The pipeline's own view of itself — did each stage run, what did it cost, which
 * node failed — is a different question for a different reader, and lives at
 * `/pipeline`.
 */

const href = ({ rep, range, as }) => `/inbound?rep=${rep}&range=${range}&as=${as}`;

/** Where they are. How we worked it out is a tooltip, not something to read. */
function Where({ lead }) {
  return (
    <div className="lab-where" title={`Territory read from the ${lead.basis}`}>
      {lead.place || "location unknown"} · {REGIONS[lead.region].label}
    </div>
  );
}

function Visit({ lead, verb = "No visit — found by research" }) {
  if (!lead.lastVisit) return <div className="lab-visit none">{verb}</div>;
  return (
    <div className="lab-visit">
      <b>{lead.visitCount} visit{lead.visitCount === 1 ? "" : "s"}</b>
      <span className="when">{prettyWhen(lead.lastVisit.seen_at)}</span>
      <span className="page" title={pathOf(lead.lastVisit)}>{pageOf(lead.lastVisit)}</span>
    </div>
  );
}

/**
 * What research found, on every card without exception.
 *
 * Rendering this row only when there is something to say made the grid read as
 * if half the cards were still loading — a card with no chips looked broken
 * rather than researched-and-empty. Silence and nothing are different answers,
 * so the empty case says which one it is.
 */
function Hooks({ hooks }) {
  if (!hooks?.length) {
    return <div className="lab-hooks empty"><span>No research findings yet</span></div>;
  }
  return (
    <div className="lab-hooks">
      {hooks.slice(0, 3).map((h, k) => <span key={k} title={h}>{h}</span>)}
    </div>
  );
}

function RepMark({ reps }) {
  const rep = repById(reps[0]);
  return (
    <span className="rep" title={reps.map((r) => repById(r).name).join(" and ")}>
      <i style={{ background: rep.tint }}>{rep.initials}</i>
      {reps.length > 1 ? `+${reps.length - 1}` : ""}
    </span>
  );
}

/** A company: an account, with everything known about it one click away. */
function CompanyCard({ lead, i }) {
  return (
    <a className="lab-card co" href={`/inbound/company/${lead.id}`}
       style={{ animationDelay: `${Math.min(i, 14) * 0.03}s` }}>
      <div className="lab-top">
        <div className="lab-name">{lead.name}</div>
        <div className="lab-marks">
          {lead.ready ? <span className="lab-b ready">{lead.ready} ready</span> : null}
        </div>
      </div>

      {/* Every slot filled on every card, including the ones with nothing in
          them — a missing line reads as a different kind of company, not as a
          company we know less about. */}
      <div className="lab-who">
        {lead.domain ?? "no domain"} · <b title={lead.verdict.long}>{lead.verdict.short}</b>
        {lead.verdict.conflict
          ? <span className="dim"> (typed {lead.verdict.conflict})</span> : null}
      </div>
      <Where lead={lead} />
      <Visit lead={lead} verb="No visit recorded" />
      <Hooks hooks={lead.hooks} />

      <div className="lab-foot">
        <span className="mail">
          {lead.contacts.length
            ? `${lead.contacts.length} name${lead.contacts.length === 1 ? "" : "s"} found`
            : "nobody found yet"}
        </span>
        <RepMark reps={lead.reps} />
      </div>
    </a>
  );
}

function CompanyTable({ rows }) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id}>
              <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
              <td className="name">
                <a href={`/inbound/company/${l.id}`}>{l.name}</a>
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
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={9} className="empty">Nothing here.</td></tr> : null}
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

  const { companies } = await loadQueue();
  const inRange = filterLeads(companies, { rep: null, range });
  const rows = filterLeads(companies, { rep, range });
  const lanes = CO_LANES.map((l) => ({ ...l, rows: byLane(rows, l.id) }));

  const chip = repById(rep);
  const rangeLabel = (RANGES.find(([k]) => k === range)?.[1] ?? "").toLowerCase();
  const unrouted = companies.filter((l) => l.region === "UNKNOWN").length;
  const unvisited = companies.filter((l) => !l.visited).length;
  const named = companies.reduce((t, c) => t + c.contacts.length, 0);

  return (
    <>
      <div className="rise">
        <h1>Inbound queue</h1>
        <p className="sub">
          One row per company that visited the site, in the queue of the rep who covers where
          they were. Open one for its people — whoever RB2B named is marked <b>visited</b>, the
          rest are colleagues research found around them. Whether each run succeeded, and what
          it cost, is at <a href="/pipeline">/pipeline</a>.
        </p>
      </div>

      <Reps
        big
        reps={ALL_REPS}
        current={rep}
        hrefFor={(id) => href({ rep: id, range, as })}
        subtitleFor={(r) => {
          const mine = r.id === "all" ? inRange : inRange.filter((l) => l.reps.includes(r.id));
          const ready = mine.reduce((t, c) => t + c.ready, 0);
          return `${num(mine.length)} compan${mine.length === 1 ? "y" : "ies"}${ready ? ` · ${ready} ready` : ""}`;
        }}
      />

      <div className="segrow">
        <Seg options={RANGES} current={range} hrefFor={(k) => href({ rep, range: k, as })} />
        <Seg options={[["cards", "Cards"], ["table", "Table"]]} current={as}
             hrefFor={(k) => href({ rep, range, as: k })} />
        <span className="note">
          {num(rows.length)} compan{rows.length === 1 ? "y" : "ies"}
          {rep !== "all" ? ` for ${chip.name}` : ""} · seen in the last {rangeLabel}
        </span>
      </div>

      {!rows.length ? (
        <div className="lab-empty">
          <b>Nothing new here.</b> No {rep === "all" ? "" : `${chip.name.split(" ")[0]} `}
          company visited in this window.{" "}
          <a href={href({ rep, range: "all", as })}>All time</a> holds{" "}
          {num(filterLeads(companies, { rep, range: "all" }).length)}.
        </div>
      ) : as === "table" ? (
        <CompanyTable rows={rows} />
      ) : (
        lanes.map((lane) => (
          <div key={lane.id}>
            <div className="lab-lane">
              <h2>{lane.label}</h2>
              <span className="n">{num(lane.rows.length)}</span>
            </div>
            {lane.rows.length ? (
              <div className="lab-grid">
                {lane.rows.map((l, i) => <CompanyCard key={l.id} lead={l} i={i} />)}
              </div>
            ) : (
              <div className="lab-empty">None in this window.</div>
            )}
          </div>
        ))
      )}

      <p className="note" style={{ marginTop: 24 }}>
        {num(companies.length)} companies and the {num(named)} people found at them.{" "}
        {num(unvisited)} were typed in by hand to test the pipeline and never visited — they
        keep their own lane at the bottom rather than being counted as inbound.{" "}
        {num(unrouted)} companies sit under Unrouted because nothing on the record says where
        they are. Ready and Needs a check come from the pipeline itself, not from this page.
      </p>
    </>
  );
}
