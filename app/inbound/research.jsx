import { num } from "../../lib/db";
import { accountType, bullets, tidy } from "../../lib/inbound/words";

/**
* the research, inline and in bullets.
 *
 * The pipeline writes its findings as one unbroken 400-word paragraph. Nobody
 * reads that with a phone in their hand, so nothing here is a paragraph: the
 * facts that carry the pitch are their own lines, and the prose the model wrote
 * is split at its sentence ends and stacked underneath.
 *
 * The same block renders on a person and on a company, because it answers the
 * same question in both places: why would this account care.
 */

/** Where the buildings are, said once instead of listed fifty times. */
function placesOf(buildings) {
  const seen = new Map();
  for (const b of buildings) {
    const k = b.city || b.state;
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  if (!top.length) return "";
  return ` — ${top.join(", ")}${seen.size > 3 ? ` and ${seen.size - 3} more` : ""}`;
}

export function Research({ company, buildings = [], hits = [], signals = [],
                           people = [], visits = [], drafts = [] }) {
  if (!company) return null;

  const type = accountType(company.account_type);
  const back = bullets(company.summary, 10);
  const scale = bullets(company.portfolio_scale, 3);

  // The counts the pipeline already holds. They were only ever implied — a
  // company with 28 contacts and 6 visits said neither number anywhere, and
  // those two are the whole reason to look at it twice.
  const tallies = [];
  if (visits.length) tallies.push(`${num(visits.length)} visit${visits.length === 1 ? "" : "s"} from this company`);
  if (people.length) tallies.push(`${num(people.length)} people found here`);
  if (people.filter((p) => p.email).length) {
    tallies.push(`${num(people.filter((p) => p.email).length)} with an email address, ${num(people.filter((p) => p.email_status === "verified").length)} verified`);
  }
  if (drafts.length) tallies.push(`${num(drafts.length)} draft${drafts.length === 1 ? "" : "s"} written`);

  // The facts a rep would open with, each on its own line, most useful first.
  const facts = [];
  if (type) facts.push(type.long);
  // Portfolio size before building count, and the count says what it is. The
  // rows are the flagships research could source — Durst has 19 of them against
  // ~16 million sq ft — so reading the count as the portfolio understates these
  // companies by an order of magnitude.
  if (scale.length) facts.push(scale[0]);
  if (buildings.length) {
    facts.push(`${num(buildings.length)} of their buildings researched by name${placesOf(buildings)}`);
  }
  // The laws with real penalties lead. A company under LL97 and LL84 is under
  // both, but only one of them is a reason to call, and a rep who quotes a
  // reporting duty as a fine has lost the account.
  const biting = hits.filter((h) => h.rule?.has_teeth);
  const reporting = hits.filter((h) => !h.rule?.has_teeth);
  if (biting.length) {
    facts.push(`Subject to ${biting.map((h) => h.rule_name).slice(0, 3).join(", ")}${biting.length > 3 ? ` and ${biting.length - 3} more with penalties` : ""}`);
  }
  if (reporting.length) {
    facts.push(`${num(reporting.length)} more ${reporting.length === 1 ? "law" : "laws"} they only have to report under — no penalty to lean on`);
  }
  if (signals.length) facts.push(`${num(signals.length)} public commitment${signals.length === 1 ? "" : "s"} on record`);
  if (company.employee_count) facts.push(`About ${company.employee_count} staff`);
  if (company.estimate_revenue) facts.push(`Estimated revenue ${company.estimate_revenue}`);
  if (company.sustainability_report_year) {
    facts.push(`Publishes a sustainability report — most recent ${company.sustainability_report_year}`);
  }

  if (!facts.length && !back.length && !signals.length && !tallies.length) {
    return (
      <div className="lab-box lab-sec">
        <h3>Research — {company.name}</h3>
        <p className="lab-flat">
          Nothing researched yet. Status is <b>{(company.research_status ?? "unknown").replace(/_/g, " ")}</b>.
        </p>
      </div>
    );
  }

  return (
    <div className="lab-box lab-sec">
      <h3>Research — {company.name}</h3>

      {tallies.length ? (
        <ul className="lab-bul num">{tallies.map((t, i) => <li key={i}>{t}</li>)}</ul>
      ) : null}

      {facts.length ? <ul className="lab-bul">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : null}

      {signals.length ? (
        <>
          <h4 className="lab-h4">What they have said publicly</h4>
          <ul className="lab-bul">
            {signals.slice(0, 4).map((s) => (
              <li key={s.id}>
                <b>{tidy(s.claim_or_target ?? s.signal_type)}</b>
                {s.target_year ? ` by ${s.target_year}` : ""}
                {s.quote ? <div className="said">&ldquo;{tidy(s.quote).slice(0, 180)}&rdquo;</div> : null}
                {s.source_url ? (
                  <a className="src" href={s.source_url} target="_blank" rel="noreferrer">source</a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {back.length ? (
        <>
          <h4 className="lab-h4">Background</h4>
          <ul className="lab-bul">{back.slice(0, 4).map((b, i) => <li key={i}>{b}</li>)}</ul>
          {back.length > 4 ? (
            <details className="lab-more">
              <summary>{back.length - 4} more<span className="chev">&rsaquo;</span></summary>
              <div className="lab-more-body">
                <ul className="lab-bul">{back.slice(4).map((b, i) => <li key={i}>{b}</li>)}</ul>
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      {hits.length ? (
        <details className="lab-more">
          <summary>Which laws, and why they bite — {num(hits.length)}<span className="chev">&rsaquo;</span></summary>
          <div className="lab-more-body">
            <ul className="lab-bul">
              {[...biting, ...reporting].map((h) => (
                <li key={h.id}>
                  <b>{h.rule_name}</b>
                  {h.jurisdiction ? <span className="dim"> · {h.jurisdiction}</span> : null}
                  {/* Whether it bites, said before what it asks for — it is the
                      difference between a deadline and a bill. */}
                  <span className={h.rule?.has_teeth ? "lab-b" : "lab-b dim"}>
                    {h.rule?.has_teeth ? "has penalties" : "reporting only"}
                  </span>
                  {h.rule?.must_do ? <div className="said">They must {h.rule.must_do}.</div> : null}
                  {h.summary ? <div className="said">{tidy(h.summary)}</div> : null}
                  {(h.source_urls ?? []).slice(0, 1).map((u, i) => (
                    <a className="src" key={i} href={u} target="_blank" rel="noreferrer">source</a>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {buildings.length ? (
        <details className="lab-more">
          <summary>Every building — {num(buildings.length)}<span className="chev">&rsaquo;</span></summary>
          <div className="lab-more-body">
            <ul className="lab-trail">
              {buildings.map((b) => (
                <li key={b.id}>
                  <span className="page">
                    {b.name || b.address || "unnamed"}
                    {b.address && b.name ? <span className="dim"> · {b.address}</span> : null}
                  </span>
                  <span className="when">
                    {[b.city, b.state].filter(Boolean).join(", ")}
                    {b.size_hint ? ` · ${b.size_hint}` : ""}
                    {b.year_built ? ` · ${b.year_built}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {company.sustainability_report_url ? (
        <p className="lab-receipt">
          <b>Their sustainability report:</b>{" "}
          <a href={company.sustainability_report_url} target="_blank" rel="noreferrer">
            {company.sustainability_program_name || "read it"}
            {company.sustainability_report_year ? ` (${company.sustainability_report_year})` : ""}
          </a>
        </p>
      ) : null}
    </div>
  );
}
