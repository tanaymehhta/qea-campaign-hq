import "../inbound.css";
import { num, prettyWhen } from "../../../lib/db";
import { Seg } from "../../../components/ui";
import { loadDrafts } from "../../../lib/inbound/queue";

export const dynamic = "force-dynamic";

/**
 * Every draft the pipeline has written, in one place.
 *
 * Until this page a draft could only be reached through the person or the
 * company it belongs to, which answers "what do I say to Gabe" and never
 * answers "what has this thing actually produced". Both are real questions; this
 * is the second one.
 *
 * Read-only and server-rendered. The editable draft with the copy button lives
 * on the person's page and stays there: mounting four hundred and fifty-five
 * textareas to show a list would be the one place in this section that spins.
 */

const LANES = [
  ["all", "All"],
  ["blocked", "Blocked"],
  ["passing", "Passes the gate"],
];

const SIZES = [["50", "50"], ["100", "100"], ["all", "All"]];

const href = ({ lane, size }) => `/inbound/drafts?lane=${lane}&size=${size}`;

/** One draft. The body is behind a native disclosure — 455 open at once is a wall. */
function DraftRow({ d }) {
  return (
    <details className={`lab-draft ${d.passes ? "passes" : "blocked"}`}>
      <summary>
        <span className="who">
          {d.person_id
            ? <a href={`/inbound/person/${d.person_id}`}>{d.full_name || "unnamed"}</a>
            : (d.full_name || "unnamed")}
          <span className="dim">
            {d.title ? ` · ${d.title}` : ""}
          </span>
        </span>
        <span className="co">
          {d.company
            ? <a href={`/inbound/company/${d.company.id}`}>{d.company.name}</a>
            : <span className="dim">no company</span>}
        </span>
        <span className="addr dim">{d.person_email || "no address"}</span>
        {/* The plain badge for blocked, the loud one for passes — the opposite
            way round from the obvious choice, and the right way round for this
            data: 450 of 455 are blocked, so amber on all of them is wallpaper,
            and the five worth acting on are what has to catch the eye. */}
        <span className={`lab-b ${d.passes ? "ready" : ""}`}>
          {d.passes ? "passes" : "blocked"}
        </span>
      </summary>

      <div className="lab-draftbody">
        {/* The validator's own sentences, verbatim. Rewording them here is how
            this page and the send gate start disagreeing about what stopped a
            send. */}
        {!d.passes && d.validator_reasons?.length ? (
          <ul className="lab-why">
            {d.validator_reasons.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        ) : null}

        <div className="subj">{d.subject || "(no subject)"}</div>
        {d.body
          ? <pre>{d.body}</pre>
          : <div className="lab-nobody">
              No body was written for this row — the draft exists, the words do not.
            </div>}

        {d.opener_fact ? (
          <div className="lab-receipt">
            Leans on: {d.opener_fact}
            {(d.evidence_urls ?? []).map((u, i) => (
              <span key={i}> · <a href={u} target="_blank" rel="noreferrer">source</a></span>
            ))}
            {d.opener_id ? <span className="dim"> · {d.opener_id}</span> : null}
          </div>
        ) : (
          <div className="lab-receipt dim">No opener fact recorded.</div>
        )}
        <div className="lab-receipt dim">
          {d.icp_key ?? "no routing key"} · written {prettyWhen(d.created_at)}
          {d.person?.status ? ` · the person is "${d.person.status}"` : ""}
          {d.person?.note ? ` — ${d.person.note}` : ""}
        </div>
      </div>
    </details>
  );
}

export default async function Drafts({ searchParams }) {
  const lane = LANES.some(([k]) => k === searchParams?.lane) ? searchParams.lane : "all";
  const size = SIZES.some(([k]) => k === searchParams?.size) ? searchParams.size : "50";

  const { rows, passing, noBody, noAddress, reasons } = await loadDrafts();
  const filtered = lane === "all" ? rows
    : lane === "passing" ? rows.filter((d) => d.passes)
    : rows.filter((d) => !d.passes);
  const shown = size === "all" ? filtered : filtered.slice(0, Number(size));

  return (
    <>
      <div className="rise">
        <h1>Drafts</h1>
        <p className="sub">
          Every email stage 3 has written, newest first — including the ones that cannot be
          sent, which is nearly all of them. A blocked draft keeps its words on purpose: when
          {" "}{num(rows.length - passing)} of {num(rows.length)} do not ship, the reason has to
          sit next to the sentence it stopped. The editable copy with the clipboard button is on
          each person&rsquo;s own page. Nothing here has ever been sent —{" "}
          <code>push_instantly</code> is a deliberate no-op.
        </p>
      </div>

      <div className="segrow">
        <Seg options={LANES} current={lane} hrefFor={(k) => href({ lane: k, size })} />
        <Seg options={SIZES} current={size} hrefFor={(k) => href({ lane, size: k })} />
        <span className="note">
          {num(filtered.length)} draft{filtered.length === 1 ? "" : "s"}
          {shown.length < filtered.length ? ` · showing ${num(shown.length)}` : ""} ·{" "}
          {num(passing)} of {num(rows.length)} pass the send gate
        </span>
      </div>

      {reasons.length ? (
        <details className="lab-reasons">
          <summary>Why the blocked ones are blocked</summary>
          <table>
            <thead>
              <tr><th style={{ textAlign: "left" }}>The validator&rsquo;s reason</th><th>Drafts</th></tr>
            </thead>
            <tbody>
              {reasons.map(([why, n]) => (
                <tr key={why}>
                  <td className="name" style={{ textAlign: "left" }}>{why}</td>
                  <td>{num(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            A draft can be stopped by more than one of these, so the column adds up to more than
            the {num(rows.length - passing)} blocked drafts.
          </p>
        </details>
      ) : null}

      {shown.map((d) => <DraftRow key={d.id} d={d} />)}

      {!shown.length ? (
        <div className="lab-empty">
          <b>Nothing here.</b> No draft matches that filter.
        </div>
      ) : null}

      <p className="note" style={{ marginTop: 24 }}>
        {num(rows.length)} drafts · {num(noAddress)} have no address on them ·{" "}
        {num(noBody)} have no body. Whether a person can be written to is the pipeline&rsquo;s
        answer, not this page&rsquo;s — it comes from <code>inbound_people_view</code>, and the
        send gate is <code>validator_status</code>. Which run produced them, and what that run
        cost, is at <a href="/pipeline">/pipeline</a>.
      </p>
    </>
  );
}
