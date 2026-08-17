import { num } from "../../lib/db";
import { accountType, bullets, tidy, isApiError } from "../../lib/inbound/words";

/**
 * The research, inline and in bullets.
 *
 * The pipeline writes its findings as one unbroken 400-word paragraph. Nobody
 * reads that with a phone in their hand, so nothing here is a paragraph: the
 * facts that carry the pitch are their own lines, and the prose the model wrote
 * is split at its sentence ends and stacked underneath.
 *
 * Each fact is a line with a rule down its left rather than a dot beside it.
 * A dot is punctuation; a rule is a card, and these are the things a rep quotes
 * on a call — they should look like something you can pick up.
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

/** A group of findings, one rule per finding. */
function Lines({ items, className = "" }) {
  return (
    <ul className={`i-lbs${className ? ` ${className}` : ""}`}>
      {items.map((t, i) => <li className="i-lb" key={i}>{t}</li>)}
    </ul>
  );
}

export function Research({ company, buildings = [], hits = [], signals = [],
                           people = [], visits = [], drafts = [] }) {
  if (!company) return null;

  const type = accountType(company.account_type);
  // `summary` catches the same 402 that `account_type_reason` does — the run
  // writes the failure into both. Bulleting a stack trace under "Background"
  // is the same mistake as bulleting it under "why it decided that"; the
  // company page says plainly that research failed, and this stays quiet.
  const back = isApiError(company.summary) ? [] : bullets(company.summary, 10);
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
  // The laws with real penalties lead: a company under both LL97 and LL84 is
  // under both, but only one is a reason to call, and a rep who quotes a
  // reporting duty as a fine has lost the account.
  //
  // Three states, not two. A law we hold no rule row for is *unknown*, not
  // toothless — 35 of 117 hits are laws the model found outside the 20-rule seed
  // table, and some of them bite. Calling those "reporting only" is the same
  // error as calling a report a fine, pointing the other way.
  const biting = hits.filter((h) => h.rule?.has_teeth === true);
  const reporting = hits.filter((h) => h.rule?.has_teeth === false);
  const unknown = hits.filter((h) => !h.rule);
  if (biting.length) {
    facts.push(`Subject to ${biting.map((h) => h.rule_name).slice(0, 3).join(", ")}${biting.length > 3 ? ` and ${biting.length - 3} more with penalties` : ""}`);
  }
  if (unknown.length) {
    facts.push(`${num(unknown.length)} more ${unknown.length === 1 ? "law" : "laws"} apply that we have not checked for penalties — read them before leaning on one`);
  }
  if (reporting.length) {
    facts.push(`${num(reporting.length)} they only have to report under — no penalty to lean on`);
  }
  if (signals.length) facts.push(`${num(signals.length)} public commitment${signals.length === 1 ? "" : "s"} on record`);
  if (company.employee_count) facts.push(`About ${company.employee_count} staff`);
  if (company.estimate_revenue) facts.push(`Estimated revenue ${company.estimate_revenue}`);
  if (company.sustainability_report_year) {
    facts.push(`Publishes a sustainability report — most recent ${company.sustainability_report_year}`);
  }

  const head = (
    <div className="i-sec">
      {/* "Research — Acme" on a person's page reads as research about that
          person. Every row in this block is keyed on company_id — the
          buildings, the compliance hits, the intent signals — and is
          byte-identical for everyone at the same company. */}
      <h2 className="i-h2">About the company</h2>
      <span className="line" />
    </div>
  );

  if (!facts.length && !back.length && !signals.length && !tallies.length) {
    return (
      <section>
        {head}
        <div className="i-card">
          <p className="i-body" style={{ margin: 0, color: "var(--ink-2)" }}>
            Nothing researched yet. Status is{" "}
            <b>{(company.research_status ?? "unknown").replace(/_/g, " ")}</b>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      {head}
      <div className="i-card" style={{ display: "grid", gap: 18 }}>
        {tallies.length ? <Lines items={tallies} className="num" /> : null}
        {facts.length ? <Lines items={facts} /> : null}

        {signals.length ? (
          <div>
            <div className="i-label" style={{ marginBottom: 8 }}>What they have said publicly</div>
            <ul className="i-lbs">
              {signals.slice(0, 4).map((s) => (
                <li className="i-lb" key={s.id}>
                  <b>{tidy(s.claim_or_target ?? s.signal_type)}</b>
                  {s.target_year ? ` by ${s.target_year}` : ""}
                  {s.quote ? <div className="said">&ldquo;{tidy(s.quote).slice(0, 180)}&rdquo;</div> : null}
                  {s.source_url ? (
                    <div className="said">
                      <a className="src" href={s.source_url} target="_blank" rel="noreferrer">source</a>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {back.length ? (
          <div>
            <div className="i-label" style={{ marginBottom: 8 }}>Background</div>
            <Lines items={back.slice(0, 4)} />
            {back.length > 4 ? (
              <details className="i-show">
                <summary>{back.length - 4} more</summary>
                <div className="body"><Lines items={back.slice(4)} /></div>
              </details>
            ) : null}
          </div>
        ) : null}

        {hits.length ? (
          <details className="i-show">
            <summary>Which laws, and what each one asks for — {num(hits.length)}</summary>
            <div className="body">
              <ul className="i-lbs">
                {[...biting, ...unknown, ...reporting].map((h) => (
                  <li className="i-lb" key={h.id}>
                    <b>{h.rule_name}</b>
                    {h.jurisdiction ? <span className="said" style={{ display: "inline", marginLeft: 6 }}>{h.jurisdiction}</span> : null}
                    {/* Whether it bites, said before what it asks for — it is the
                        difference between a deadline and a bill. The square mark
                        is the one that costs money. */}
                    {" "}
                    <span className={h.rule?.has_teeth ? "i-chip failed" : "i-chip none"}>
                      <span className="mark" />
                      {h.rule?.has_teeth ? "has penalties"
                        : h.rule ? "reporting only" : "penalties not checked"}
                    </span>
                    {h.rule?.must_do ? <div className="said">They must {h.rule.must_do}.</div> : null}
                    {h.summary ? <div className="said">{tidy(h.summary)}</div> : null}
                    {(h.source_urls ?? []).slice(0, 1).map((u, i) => (
                      <div className="said" key={i}>
                        <a className="src" href={u} target="_blank" rel="noreferrer">source</a>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}

        {buildings.length ? (
          <details className="i-show">
            <summary>Every building — {num(buildings.length)}</summary>
            <div className="body">
              <ul className="i-rows">
                {buildings.map((b) => (
                  <li key={b.id}>
                    <span className="p">
                      {b.name || b.address || "unnamed"}
                      {b.address && b.name ? <span className="dim"> · {b.address}</span> : null}
                    </span>
                    <span className="t">
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
          <div className="i-links">
            <span className="i-note">Their sustainability report</span>
            <span className="sep">·</span>
            <a href={company.sustainability_report_url} target="_blank" rel="noreferrer">
              {company.sustainability_program_name || "read it"}
              {company.sustainability_report_year ? ` (${company.sustainability_report_year})` : ""}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
