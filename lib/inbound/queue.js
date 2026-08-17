// Extensions spelled out: `scripts/test-routing.mjs` imports this file in bare
// Node, which does not do webpack's extensionless resolution.
import { db } from "../db.js";
import { STAGES, latestByStage, nodeErrors, nodeState } from "../pipeline.js";
import { locate, repsFor, RESERVED_TLD } from "./routing.js";
import { pageTitle, verdict, errorReason, researchChip } from "./words.js";

/**
 * The inbound queue as a salesperson reads it.
 *
 * `/pipeline` is organised around the run: one row per company, a dot per stage,
 * cost per node. This is organised around the next action: who to contact, and
 * what to say to them.
 *
 * Every query in this file reads. The section's only writes live in
 * `app/inbound/actions.js` — three hand controls a rep uses to overrule the
 * pipeline — and they go through validating database functions rather than
 * touching a table.
 *
 * One list, of companies. Everything inbound produces hangs off one: the person
 * RB2B named, the colleagues research found around them, the buildings, the
 * laws, the drafts. All 387 named people carry a company_id and every one of
 * those resolves — checked, not assumed — so a list of companies repeats nobody
 * and loses nobody. People keep their own page, reached through the company they
 * belong to rather than through a parallel list saying the same thing twice.
 */

/**
 * Companies split on whether they are worth selling to at all.
 *
 * The earlier split — has contacts / has none — described the pipeline's
 * progress rather than the company. A rep scanning this wants the sentence
 * "these are prospects, those are not", so the lanes say exactly that and the
 * ruled-out half is named rather than described as missing something.
 */
export const CO_LANES = [
  { id: "relevant", label: "Relevant companies" },
  { id: "irrelevant", label: "Not relevant companies" },
];

/**
 * Every row, not the first thousand.
 *
 * PostgREST caps a response at 1,000 rows whatever `.limit()` asks for, and
 * there are 2,446 people. The queue read the first thousand and called it the
 * total, so every count built on them — contacts at a company, who has nobody —
 * went quietly wrong the day the table passed the cap. Takes a factory rather
 * than a query because a Supabase builder cannot be awaited twice.
 */
export async function everyRow(build, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const { data } = await build().range(from, from + size - 1);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

export const RANGES = [
  ["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["all", "All"],
];

/** Build every lead once; the page filters the array rather than re-querying. */
export async function loadQueue() {
  const [people, companies, visits, emails, buildings, hits, signals, rules,
         webhooks, runs] = await Promise.all([
    // `inbound_people_view` rather than the table: the backend derives `status`
    // (Ready / Needs a check) and one plain-English `note` from list_status,
    // sendable, company_match and email_status, and it owns those columns. A
    // second derivation here would say something different the first time one of
    // them changes meaning. Verified 417 of 417 rows survive the view's join.
    // `rank` rather than `priority`: the view resolves a hand-set manual_rank
    // over the pipeline's priority, so a reordered list stays reordered after
    // the next stage-2 run rewrites priority underneath it.
    // Paged: 2,446 rows against a 1,000-row ceiling. `id` breaks ties in the
    // sort, without which a page boundary can repeat a row and drop another.
    everyRow(() => db.from("inbound_people_view")
      .select("id,company_id,full_name,first_name,title,email,email_status,role_bucket,role_hypothesis,source,priority,rank,manual_sendable,city,state,linkedin_url,status,note")
      .order("rank", { ascending: true }).order("id", { ascending: true })),
    db.from("inbound_companies")
      .select("id,name,domain,hq_city,hq_state,hq_country,vertical,account_type,account_type_reason,research_status,portfolio_scale,summary,first_seen_at,last_visited_at")
      .then((r) => r.data ?? []),
    db.from("inbound_visits").select("person_id,company_id,seen_at,captured_url")
      .order("seen_at", { ascending: false }).limit(1000).then((r) => r.data ?? []),
    db.from("inbound_emails")
      // No `send_status` or `pushed_at`: nothing sends, so both are NULL on every
      // row and no page reads them. They stay in the table — the pipeline's
      // already-emailed guard is the one thing that still reads them, and it is
      // what stops a re-run mailing somebody twice the day sending exists.
      .select("id,person_id,person_email,company_id,subject,body,validator_status,validator_reasons,opener_fact,evidence_urls,created_at")
      .order("created_at", { ascending: false }).then((r) => r.data ?? []),
    // city/state/country because buildings are the last word on where a company
    // is — see the note on step 4 in `locate`.
    db.from("inbound_buildings").select("company_id,city,state,country").then((r) => r.data ?? []),
    db.from("inbound_compliance_hits").select("company_id,rule_id,rule_name").then((r) => r.data ?? []),
    db.from("inbound_intent_signals").select("company_id,claim_or_target,signal_type").then((r) => r.data ?? []),
    // Which of those laws actually carry a penalty. Half the commonest ones do
    // not — LL84, LL87 and LL33/95 are all reporting-only — and pitching a
    // reporting duty as a fine is the fastest way to lose the account.
    db.from("inbound_compliance_rules").select("id,name,must_do,has_teeth,severity")
      .then((r) => r.data ?? []),
    // Inbound traffic that never became a company: 37 of 206 RB2B posts failed
    // to parse and appear nowhere else in this dashboard.
    db.from("inbound_webhook_events").select("parse_status").then((r) => r.data ?? []),
    db.from("inbound_graph_runs").select("company_id,total_cost_usd,apollo_credits")
      .then((r) => r.data ?? []),
  ]);
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  const companyById = new Map(companies.map((c) => [c.id, c]));

  const visitsOf = new Map();
  const visitsAt = new Map();
  for (const v of visits) {
    if (v.person_id) {
      if (!visitsOf.has(v.person_id)) visitsOf.set(v.person_id, []);
      visitsOf.get(v.person_id).push(v);
    }
    if (v.company_id) {
      if (!visitsAt.has(v.company_id)) visitsAt.set(v.company_id, []);
      visitsAt.get(v.company_id).push(v);
    }
  }

  // `person_id` is set on every draft as of 2026-08-10 and is the join key.
  // `person_email` is the opposite — NULL on 320 of 355 rows — so it is kept
  // only as a fallback for anything written before that change, and `claim`
  // ignores a null key rather than collapsing every addressless draft into one
  // bucket.
  const draftsOf = new Map();
  const claim = (key, e) => {
    if (!key) return;
    if (!draftsOf.has(key)) draftsOf.set(key, []);
    draftsOf.get(key).push(e);
  };
  for (const e of emails) {
    claim(e.person_id, e);
    claim(e.person_email?.toLowerCase(), e);
  }

  const count = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.company_id, (m.get(r.company_id) ?? 0) + 1);
    return m;
  };
  const nBuildings = count(buildings), nHits = count(hits);

  const builtAt = new Map();
  for (const b of buildings) {
    if (!builtAt.has(b.company_id)) builtAt.set(b.company_id, []);
    builtAt.get(b.company_id).push(b);
  }
  // A card has room for one law, so it shows one that bites in preference to one
  // that only has to be reported. Both are true of most of these companies; only
  // one of them is a reason to pick up the phone.
  // Three states, not two. 35 of 117 hits carry no `rule_id` — laws the model
  // found that are not in the 20-rule seed table, from UK Part L to a Charlotte
  // programme whose own name says "voluntary". Treating a missing rule as
  // `has_teeth = false` would label those "reporting only", which is a claim we
  // cannot support and the same mistake as calling a report a fine.
  const bitesOf = new Map(), reportsOf = new Map(), unknownOf = new Map();
  const claimOf = new Map();
  for (const h of hits) {
    if (!h.rule_name) continue;
    const teeth = ruleById.get(h.rule_id)?.has_teeth;
    const to = teeth === true ? bitesOf : teeth === false ? reportsOf : unknownOf;
    if (!to.has(h.company_id)) to.set(h.company_id, h.rule_name);
  }
  const ruleOf = new Map();
  for (const id of new Set([...bitesOf.keys(), ...unknownOf.keys(), ...reportsOf.keys()])) {
    ruleOf.set(id, bitesOf.get(id)
      ?? unknownOf.get(id)
      ?? `${reportsOf.get(id)} (reporting only)`);
  }
  for (const s of signals) if (s.claim_or_target && !claimOf.has(s.company_id)) claimOf.set(s.company_id, s.claim_or_target);

  const hooksFor = (companyId) => {
    const out = [];
    const nb = nBuildings.get(companyId) ?? 0;
    if (nb) out.push(`${nb} building${nb === 1 ? "" : "s"} found`);
    if (ruleOf.get(companyId)) out.push(ruleOf.get(companyId));
    else if (nHits.get(companyId)) out.push(`${nHits.get(companyId)} compliance rules in play`);
    if (claimOf.get(companyId)) out.push(claimOf.get(companyId));
    return out;
  };

  const leads = people.map((p) => {
    const company = p.company_id ? companyById.get(p.company_id) : null;
    const { region, place, basis } = locate(p, company, builtAt.get(p.company_id) ?? []);
    const owners = repsFor(region);
    const vs = visitsOf.get(p.id) ?? [];
    const drafts = [
      ...(draftsOf.get(p.id) ?? []),
      ...(p.email ? draftsOf.get(p.email.toLowerCase()) ?? [] : []),
    ].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
    const draft = drafts[0] ?? null;

    const identity = p.source === "visitor" ? (p.full_name ? "visited" : "anon") : "research";

    // Two words, and a sentence saying what to do about it — both read straight
    // off the view. There is deliberately no third state for "sent": stage 3 has
    // no send step at all — the node that would have had one was removed rather
    // than left dark — so a lane for it would be an empty lane forever.
    const ready = p.status === "Ready";

    return {
      hooks: hooksFor(p.company_id),
      id: p.id,
      name: p.full_name,
      first: p.first_name,
      title: p.title,
      company, region, place, basis,
      reps: owners.map((r) => r.id),
      identity, ready, status: p.status, note: p.note,
      email: p.email, emailStatus: p.email_status,
      linkedin: p.linkedin_url,
      why: p.role_hypothesis,
      priority: p.rank ?? p.priority ?? 99,
      manualled: p.manual_sendable != null,
      visitCount: vs.length,
      lastVisit: vs[0] ?? null,
      draft, draftCount: drafts.length,
    };
  });

  // Newest visit first, because the queue is a morning read; never-visited
  // research contacts sort under everyone who actually showed up.
  const byRecency = (a, b) => {
    const ta = a.lastVisit ? Date.parse(a.lastVisit.seen_at) : 0;
    const tb = b.lastVisit ? Date.parse(b.lastVisit.seen_at) : 0;
    if (ta !== tb) return tb - ta;
    return (a.priority ?? 99) - (b.priority ?? 99);
  };

  // A name RB2B never produced is a company visit, so it leaves the people list
  // and becomes one row on the company it came from.
  const named = leads.filter((l) => l.identity !== "anon").sort(byRecency);

  const contactsAt = new Map();
  for (const l of named) {
    if (!l.company?.id) continue;
    if (!contactsAt.has(l.company.id)) contactsAt.set(l.company.id, []);
    contactsAt.get(l.company.id).push(l);
  }

  // Per company, so every header number can be re-counted over whatever subset
  // the page is showing. A tile that reads the whole database while the list
  // under it reads one rep's last seven days is two answers to one question.
  const draftsAt = new Map();
  for (const e of emails) {
    if (!e.company_id) continue;
    if (!draftsAt.has(e.company_id)) draftsAt.set(e.company_id, []);
    draftsAt.get(e.company_id).push(e);
  }
  const spendAt = new Map();
  for (const r of runs) {
    if (!r.company_id) continue;
    const a = spendAt.get(r.company_id) ?? { usd: 0, apollo: 0 };
    a.usd += Number(r.total_cost_usd ?? 0);
    a.apollo += Number(r.apollo_credits ?? 0);
    spendAt.set(r.company_id, a);
  }

  const companyLeads = companies
    // Real inbound has to clear two bars: somebody actually visited, and the
    // domain has to be one that can exist. `.example`/`.test`/`.invalid`/
    // `.localhost` are reserved by RFC 2606 and RFC 6761 and never resolve, so a
    // company under one was typed in, whatever its visit row says.
    //
    // The eleven that fail are excluded outright. They hold most of the drafted
    // work — Durst's five are the only drafts that pass the send gate — so the
    // queue counts them out loud in its footer rather than letting the number
    // quietly go missing.
    .filter((c) => visitsAt.has(c.id) && !RESERVED_TLD.test(c.domain ?? ""))
    .map((c) => {
      const vs = (visitsAt.get(c.id) ?? []).sort(
        (a, b) => Date.parse(b.seen_at) - Date.parse(a.seen_at));
      // A company's territory is read off whoever visited it, falling back to
      // the company's own record — same order the person cards use.
      // Any visitor-sourced row, named or not — the same rule `loadCompany` uses.
      // Matching only the anonymous ones ignored the geo on 13 companies whose
      // visitor RB2B *did* name: New Horizons Preschool's card fell through to
      // its .au domain and read "New York, NY · Elsewhere · Unrouted" while its
      // own page said "United States · Mark Vasu". A card that contradicts
      // itself is worse than either answer alone.
      const visitor = leads.find((l) =>
        l.company?.id === c.id && (l.identity === "anon" || l.identity === "visited"));
      const { region, place, basis } = visitor ?? locate(null, c, builtAt.get(c.id) ?? []);
      const mine = contactsAt.get(c.id) ?? [];
      const ready = mine.filter((l) => l.ready).length;
      const drafts = mine.filter((l) => l.draft).length;
      const written = draftsAt.get(c.id) ?? [];
      const spend = spendAt.get(c.id) ?? { usd: 0, apollo: 0 };
      return {
        // Everything the header counts, carried on the company that owns it.
        draftCount: written.length,
        passing: written.filter((e) => e.validator_status === "sent").length,
        verified: mine.filter((l) => l.emailStatus === "verified").length,
        spent: spend.usd, credits: spend.apollo,
        id: c.id, name: c.name, domain: c.domain, company: c,
        region, place: place || visitor?.place || "", basis,
        reps: repsFor(region).map((r) => r.id),
        visitCount: vs.length, lastVisit: vs[0] ?? null,
        hooks: hooksFor(c.id),
        contacts: mine, ready, drafts,
        verdict: verdict(c),
        lane: verdict(c).lane,
        // What happened to research, which the lane used to carry and get
        // wrong. One derivation, read by the card, the page and the counts.
        chip: researchChip(c),
        isNew: c.first_seen_at ? new Date(c.first_seen_at) >= daysAgo(7) : false,
        researched: c.research_status,
        accountType: c.account_type,
      };
    })
    .sort(byRecency);

  // The count of what the filter above removed, so the page can say it out loud
  // rather than hardcode a number that goes stale the next time one appears.
  return {
    people: named, companies: companyLeads,
    // Traffic that never became a company, so it can never be counted per
    // company either: a webhook that failed to parse has no company_id to
    // attach to. It is the one header number that cannot follow the filters,
    // and the card says so rather than pretending.
    traffic: {
      dropped: webhooks.filter((w) => w.parse_status === "failed").length,
      total: webhooks.length,
    },
    excluded: companies.length - companyLeads.length,
  };
}

/**
 * Every header number, over whatever set of companies is on screen.
 *
 * The header used to read the whole database while the list under it read one
 * rep's last seven days, so pressing "Today" left "85 companies · 2,380 people"
 * sitting above the words "no company matches this window". A number that does
 * not move when the filter moves is not a summary of anything.
 *
 * Pure, and the same function for every scope — the all-time footer and the
 * one-rep-one-day header cannot disagree because there is only one of them.
 */
export function tally(leads = []) {
  const sum = (f) => leads.reduce((t, l) => t + f(l), 0);
  return {
    companies: leads.length,
    people: sum((l) => l.contacts.length),
    ready: sum((l) => l.ready),
    // Two different questions, and the header wants the second. `draftCount` is
    // every row in inbound_emails for the company; `drafted` is people who have
    // one, which is the number that divides into `people`. They agree today —
    // 673 rows across 673 distinct person_ids, exactly one draft each — and the
    // day the pipeline writes a second draft for anyone, or writes one against a
    // person this company's list does not hold, only `drafted` stays a share of
    // the people found.
    drafts: sum((l) => l.draftCount),
    drafted: sum((l) => l.drafts),
    fresh: leads.filter((l) => l.isNew).length,
    nobody: leads.filter((l) => !l.contacts.length).length,
    // The three states of `researchChip`, counted. They partition the set, so
    // researched + failed + notResearched === companies, always.
    researched: leads.filter((l) => l.chip.state === "done").length,
    failed: leads.filter((l) => l.chip.state === "failed").length,
    notResearched: leads.filter((l) => l.chip.state === "none").length,
    verified: sum((l) => l.verified),
    passing: sum((l) => l.passing),
    spent: sum((l) => l.spent),
    credits: sum((l) => l.credits),
  };
}

/** A share of a total, or an em dash — never "NaN%" or a percentage of nothing. */
export const share = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "—");

/**
 * Where a company stopped — the first outcome it is missing, in funnel order.
 *
 * Every company is in exactly one bucket, which is the property worth keeping: a
 * reader can add the column up and get the queue total. First-missing is what
 * makes that true. A company with nobody found also has no drafts and nothing
 * passing the gate, and counting it under all three would say 90 companies are
 * stuck in 200 places.
 *
 * Read off the fields the cards already read — `chip` is `researchChip`,
 * `passing` is the validator's own verdict — so a bucket, the number on it and
 * the company page it opens are the same claim rather than three of them.
 *
 * `stops` is "does it get no further than here", so the last bucket's is `true`:
 * anything that reaches it has cleared everything above and stops there by
 * definition.
 */
export const DROPOFF = [
  { id: "at-research", label: "Stuck at research",
    stops: (l) => l.chip.state !== "done",
    fix: "Research never returned a verdict on these, so nothing downstream has anything to work from. Top up OpenRouter, then re-run stage 1." },
  { id: "at-people", label: "Researched, nobody found",
    stops: (l) => !l.contacts.length,
    fix: "Research finished and the people search came back empty. Top up Apollo, then re-run stage 2." },
  { id: "at-drafts", label: "People found, nothing written",
    stops: (l) => !l.draftCount,
    fix: "There are people here and not one email addressed to any of them. Re-run stage 3." },
  { id: "at-gate", label: "Drafts written, none pass the gate",
    stops: (l) => !l.passing,
    fix: "The emails exist and the validator refused them. Re-running writes the same mail and gets the same answer — these are blocked on missing facts and deliberate refusals, not on a failure." },
  { id: "through", label: "All the way through",
    stops: () => true,
    fix: "A draft here passes the send gate. Sending it is a person's job — the pipeline has no send step." },
];

/** Which bucket a company is in. Pure, and the only derivation of it. */
export const stoppedAt = (lead) => DROPOFF.find((b) => b.stops(lead)).id;

/**
 * What each stat card filters the list to.
 *
 * One table, so a card, its count and the list it opens can never disagree —
 * the tile reads `of` for its number and the page reads the same `of` for its
 * rows. A card with no `of` is a fact about the machine that no company filter
 * can express; it links out or it does not link at all.
 */
export const VIEWS = {
  all: { label: "Companies", of: () => true },
  people: { label: "People found", of: (l) => l.contacts.length > 0 },
  ready: { label: "Ready to email", of: (l) => l.ready > 0 },
  drafted: { label: "Emails drafted", of: (l) => l.drafts > 0 },
  fresh: { label: "New this week", of: (l) => l.isNew },
  nobody: { label: "Nobody found", of: (l) => !l.contacts.length },
  // The three research states, each openable from its own card. `failed` and
  // `researched` are the two a rep asked to be able to separate; `unresearched`
  // is the remainder, and having all three means the counts on the card and the
  // rows behind it are read off the same predicate.
  researched: { label: "Researched", of: (l) => l.chip.state === "done" },
  failed: { label: "Research failed", of: (l) => l.chip.state === "failed" },
  unresearched: { label: "Not researched", of: (l) => l.chip.state === "none" },
  // The drop-off buckets, each openable from its bar on /inbound/system. Same
  // `stoppedAt` the bar counts with, so the bar and the list it opens hold the
  // same companies — the bar links here with `range=all`, because the system
  // page has no window and a seven-day one would show twelve of the sixty-one.
  ...Object.fromEntries(DROPOFF.map((b) => [
    b.id, { label: b.label, of: (l) => stoppedAt(l) === b.id },
  ])),
};

// ── what has happened to this company, in order ─────────────────────────────

/**
 * The dots along the top of a company page.
 *
 * Four, not three: arrival is the rep's freshness signal and the runs cannot
 * tell you it. Four, not five: a "Sent" dot could never go green, because the
 * pipeline has no send step — stage 3 ends at `persist` — and 0 of 639 drafts
 * have ever left the building. It goes in the day sending is wired, not before.
 */
export const DOTS = [
  { stage: 0, label: "Visited" },
  { stage: 1, label: "Researched", work: "Research the company" },
  // `none` is what the dot says when the stage ran cleanly and produced nothing.
  // "People found ✓" over a panel reading "No contacts found" is the dot
  // reporting on the run when a rep is asking about the company.
  { stage: 2, label: "People found", work: "Find the people",
    none: "Nobody found", why: "it found nobody" },
  { stage: 3, label: "Emails written", work: "Write the emails",
    none: "No emails written", why: "nothing was written" },
];

/** Which stage a run belongs to. `stage_no` is NULL on 99 of the rows. */
const stageOf = (r) => r.stage_no ?? STAGES.find((s) => s.graph === r.graph_name)?.no ?? null;

/**
 * Green, red, or not reached — per stage, from the nodes rather than the run.
 *
 * A run's own `status` column cannot pick between them. Canaccord's stage 1
 * says `needs_review` while three nodes inside it returned 402, and its earlier
 * attempt says a flat `ok` with the same failure; ScanSource's says `ok` over a
 * node that hard-errored. So the dot reads `nodeState`, which already knows
 * that a node reporting ok while carrying `output_summary.errors` failed.
 *
 * Two colours, no amber. A stage that half-worked is a stage a rep cannot rely
 * on, so it reads the same as one that never ran at all.
 *
 * Green also has to mean something came out. `produced` is what each stage
 * actually left behind — people for stage 2, drafts for stage 3 — and a stage
 * that ran clean on zero of them goes grey rather than ticked. IBM Research is
 * the case: four green ticks over "No contacts found", because no node failed.
 * A stage with no count in `produced` is not judged this way; nothing counts
 * stage 1's output.
 *
 * Ordered by stage number and never by time: Canaccord's stage 3 ran at 19:58
 * and its stage 2 at 21:52 the same day, and a timeline that believed the
 * clock would show them the wrong way round.
 *
 * Pure, so `scripts/test-routing.mjs` can hold it to the rows that produced the
 * complaint.
 */
export function timeline(firstSeenAt, runs = [], nodesByRun = new Map(), produced = {}) {
  const latest = latestByStage(runs);
  const tries = new Map();
  for (const r of runs) {
    const s = stageOf(r);
    if (s) tries.set(s, (tries.get(s) ?? 0) + 1);
  }

  return DOTS.map(({ stage, label, none, why }) => {
    const base = { stage, label, attempts: tries.get(stage) ?? 0, failures: [], reason: null };
    if (stage === 0) {
      return { ...base, state: firstSeenAt ? "ok" : "todo", when: firstSeenAt ?? null };
    }
    const run = latest.get(stage) ?? null;
    if (!run) return { ...base, state: "todo", when: null };

    // Working right now. This has to come before the tests below, because a
    // stage in flight has produced nothing YET, and `empty` would file it as
    // "ran, found nobody" — the dot claiming an answer the run has not reached.
    // It is also what a rep watches after pressing Restart, so it says how long
    // it has been going rather than when it finished, which is not yet a fact.
    if (run.status === "running") {
      return {
        ...base, run, state: "running", when: run.started_at ?? null,
        reason: "it is running now",
      };
    }

    const failures = (nodesByRun.get(run.id) ?? [])
      .filter((n) => ["error", "degraded"].includes(nodeState(n)))
      .map((n) => ({ node: n.node_name, raw: nodeErrors(n).join("\n") }));
    if (run.error) failures.push({ node: "the run itself", raw: String(run.error) });

    const dead = ["error", "cancelled"].includes(run.status);
    const broke = Boolean(failures.length || dead);
    // Ran, nothing broke, nothing came out.
    const empty = !broke && produced[stage] === 0;
    const reason = broke
      ? (failures.length ? errorReason(failures[0].raw)
        : run.status === "cancelled" ? "the run was cancelled" : "the run failed")
      : empty ? why ?? "it produced nothing"
      : null;

    return {
      ...base, run, failures, reason,
      label: empty && none ? none : label,
      state: broke ? "bad" : empty ? "none" : "ok",
      when: run.finished_at ?? run.started_at ?? null,
    };
  });
}

/**
 * What this company cost, by the work it paid for.
 *
 * Every run, not the latest of each: Barings was researched twice and the first
 * attempt's $1.45 was spent whatever the second one found. No per-name figure —
 * most of the money is stage 1, which costs the same whether twenty people turn
 * up or none, so dividing it by a head count invents a number.
 */
export function costs(runs = []) {
  const per = new Map();
  for (const r of runs) {
    const s = stageOf(r);
    if (!s) continue;
    const a = per.get(s) ?? { usd: 0, llm: 0, search: 0, apollo: 0, runs: 0 };
    a.usd += Number(r.total_cost_usd ?? 0);
    a.llm += Number(r.llm_calls ?? 0);
    a.search += Number(r.search_calls ?? 0);
    a.apollo += Number(r.apollo_credits ?? 0);
    a.runs += 1;
    per.set(s, a);
  }
  const rows = DOTS.filter((d) => d.stage && per.has(d.stage))
    .map((d) => ({ ...d, ...per.get(d.stage) }));
  return { rows, total: rows.reduce((t, r) => t + r.usd, 0) };
}

/**
 * Why there is nobody here — which is three different answers.
 *
 * 46 of the 85 visited companies have no contacts, and a rep reading one blank
 * panel cannot tell "we never looked" from "Apollo has never heard of them"
 * from "we found forty and none of them buy". Each is a different next move, so
 * each gets its own sentence, read off the stage-2 nodes rather than guessed.
 */
export function whyNobody(dot, nodes = [], domain, ruledOut) {
  const say = (out, key) => Number(out?.output_summary?.[key] ?? 0);
  if (!dot || dot.state === "todo") {
    return ruledOut
      ? { head: "Nobody looked for.",
          tail: "Research ruled this company out, so the people search was skipped on purpose." }
      : { head: "Nobody found yet.", tail: "The search for people has not run." };
  }
  if (dot.state === "bad") {
    return { head: "The search for people failed.",
             tail: `It ran, but ${dot.reason} — so this is not an answer about ${domain ?? "them"}.` };
  }
  const orgs = say(nodes.find((n) => n.node_name === "apollo_sweep"), "org_total");
  const web = say(nodes.find((n) => n.node_name === "web_supplement"), "found");
  if (!orgs && !web) {
    return { head: "No contacts found.",
             tail: `Apollo has no record of ${domain ?? "this company"}, and a web search found nobody either.` };
  }
  return { head: "No contacts found.",
           tail: `Apollo held ${orgs} matching ${orgs === 1 ? "organisation" : "organisations"}, and nobody at ${orgs === 1 ? "it" : "them"} matched the buyer profile.` };
}

/**
 * Compliance hits with their rule attached.
 *
 * A hit records that a law applies; the rule says what the law makes you *do*
 * and whether ignoring it costs money. `has_teeth = false` means reporting only
 * — Chicago's benchmarking, NYC LL84 and LL87 — and a rep who reads a reporting
 * duty as a fine has just burned the account. The obligation is never inferred
 * from the rule's name.
 */
async function withRules(hits) {
  const ids = [...new Set(hits.map((h) => h.rule_id).filter(Boolean))];
  if (!ids.length) return hits.map((h) => ({ ...h, rule: null }));
  const rules = await db.from("inbound_compliance_rules")
    .select("id,name,must_do,has_teeth,severity,refs").in("id", ids)
    .then((r) => r.data ?? []);
  const by = new Map(rules.map((r) => [r.id, r]));
  return hits.map((h) => ({ ...h, rule: by.get(h.rule_id) ?? null }));
}

/**
 * Everything about one company, on one page.
 *
 * The shipped `/inbound/[companyId]` splits this across a pipeline trace and a
 * research section; here it is the whole account — what they own, what law
 * applies, what they have said publicly, who visited, and who we found.
 */
export async function loadCompany(companyId) {
  const [company, buildings, hits, signals, visits, people, emails, runs] = await Promise.all([
    db.from("inbound_companies").select("*").eq("id", companyId).maybeSingle().then((r) => r.data),
    db.from("inbound_buildings").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_compliance_hits").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_intent_signals").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_visits").select("*").eq("company_id", companyId)
      .order("seen_at", { ascending: false }).then((r) => r.data ?? []),
    db.from("inbound_people_view").select("*").eq("company_id", companyId)
      .order("rank", { ascending: true }).then((r) => r.data ?? []),
    db.from("inbound_emails").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    // Newest first, which is the order `latestByStage` reads.
    db.from("inbound_graph_runs")
      .select("id,graph_name,stage_no,status,started_at,finished_at,total_cost_usd,llm_calls,search_calls,apollo_credits,error")
      .eq("company_id", companyId).order("started_at", { ascending: false })
      .then((r) => r.data ?? []),
  ]);
  if (!company) return { company: null };

  // Only the nodes of this company's runs, and only the four columns the
  // timeline reads. `output_summary` is where a tool that caught its own
  // failure hides it, so it cannot be dropped for being verbose.
  const nodesByRun = new Map();
  if (runs.length) {
    const nodes = await db.from("inbound_graph_node_events")
      .select("run_id,node_name,status,error,output_summary,sequence")
      .in("run_id", runs.map((r) => r.id)).order("sequence").then((r) => r.data ?? []);
    for (const n of nodes) {
      if (!nodesByRun.has(n.run_id)) nodesByRun.set(n.run_id, []);
      nodesByRun.get(n.run_id).push(n);
    }
  }

  const visitor = people.find((p) => p.source === "visitor");
  const geo = locate(visitor ?? null, company, buildings);

  // Who among them actually came to the site. That is the difference between a
  // lead and a guess, so it is carried on the person rather than inferred from
  // `source` — a row can be sourced from RB2B without a visit of its own.
  const visitsBy = new Map();
  for (const v of visits) {
    if (!v.person_id) continue;
    if (!visitsBy.has(v.person_id)) visitsBy.set(v.person_id, []);
    visitsBy.get(v.person_id).push(v);
  }

  const named = people
    .filter((p) => p.full_name)
    .map((p) => ({ ...p, visits: visitsBy.get(p.id) ?? [] }))
    // The person who visited leads the list; everyone else is a colleague
    // research found around them, in the pipeline's own priority order — until
    // somebody reorders the list by hand, at which point `manual_rank` is the
    // whole answer and the visitor rule stops applying. `inbound_move_person`
    // seeds itself in exactly this order, so the first click swaps two
    // neighbours instead of appearing to shuffle the page.
    .sort((a, b) => (a.manual_rank != null && b.manual_rank != null)
      ? a.manual_rank - b.manual_rank
      : (b.visits.length ? 1 : 0) - (a.visits.length ? 1 : 0)
        || (a.rank ?? 99) - (b.rank ?? 99));

  return {
    company, buildings, signals, visits, emails, geo, runs, nodesByRun,
    hits: await withRules(hits),
    people: named,
    reps: repsFor(geo.region),
    // `first_seen_at` is the company's own arrival stamp; the earliest visit is
    // the fallback for the rows written before that column existed. The last
    // argument is what the stages left behind, counted the same way the panels
    // below the timeline count it — `named` is the People found list, `emails`
    // is every draft on the company — so a dot and the panel under it cannot
    // disagree about whether anything came out.
    dots: timeline(
      company.first_seen_at ?? visits[visits.length - 1]?.seen_at ?? null,
      runs, nodesByRun, { 2: named.length, 3: emails.length }),
  };
}

/**
 * One person, with the company research inline rather than a link away — a rep
 * reading a name should not have to leave the page to find out why the company
 * is worth the call.
 */
export async function loadPerson(personId) {
  const person = await db.from("inbound_people_view").select("*").eq("id", personId)
    .maybeSingle().then((r) => r.data);
  if (!person) return { person: null };
  const cid = person.company_id;

  const [company, visits, emails, buildings, hits, signals, coPeople, coVisits, coDrafts] = await Promise.all([
    cid ? db.from("inbound_companies").select("*").eq("id", cid).maybeSingle().then((r) => r.data) : null,
    db.from("inbound_visits").select("*").eq("person_id", personId)
      .order("seen_at", { ascending: false }).then((r) => r.data ?? []),
    // Keyed on person_id alone. The old `or()` interpolated the address into an
    // ILIKE pattern, where `_` and `%` are wildcards — `a_b@x.com` would have
    // matched a colleague's `axb@x.com` and shown their draft as this person's,
    // and a comma in an address would have broken the expression outright,
    // leaving `.data` null and the page claiming no draft exists. No address in
    // the table contains either character today, which made it a latent bug
    // rather than a live one. person_id is set on all 355 rows, so the address
    // was never needed to find them.
    db.from("inbound_emails").select("*").eq("person_id", personId)
      .order("created_at", { ascending: false }).then((r) => r.data ?? []),
    cid ? db.from("inbound_buildings").select("*").eq("company_id", cid).then((r) => r.data ?? []) : [],
    cid ? db.from("inbound_compliance_hits").select("*").eq("company_id", cid).then((r) => r.data ?? []) : [],
    cid ? db.from("inbound_intent_signals").select("*").eq("company_id", cid).then((r) => r.data ?? []) : [],
    // The company-wide counts, so the research block reads the same numbers on
    // a person's page as it does on the company's. `loadCompany` counts only
    // named rows, so this must too — otherwise the same block said "28 people
    // found here" on one page and "25" on the other.
    cid ? db.from("inbound_people").select("id,email,email_status,full_name").eq("company_id", cid)
      .not("full_name", "is", null).then((r) => r.data ?? []) : [],
    cid ? db.from("inbound_visits").select("id").eq("company_id", cid).then((r) => r.data ?? []) : [],
    cid ? db.from("inbound_emails").select("id").eq("company_id", cid).then((r) => r.data ?? []) : [],
  ]);

  // If nothing was written for them, a colleague's draft still shows what this
  // person would be sent — the pitch is the company's, not the individual's.
  // It has to have a body: six rows are consultant refusals that carry a reason
  // and nothing else, and borrowing one of those renders an empty box. Newest
  // first so the same person shows the same colleague's draft on every load —
  // an unordered limit(1) let Postgres pick, and it did not always pick twice.
  let siblingDraft = null;
  if (!emails.length && cid) {
    siblingDraft = await db.from("inbound_emails").select("*").eq("company_id", cid)
      .not("body", "is", null)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle().then((r) => r.data);
  }

  const geo = locate(person, company, buildings);
  return {
    person, company, visits, emails, buildings, signals, siblingDraft, geo,
    hits: await withRules(hits),
    coPeople, coVisits, coDrafts,
    reps: repsFor(geo.region),
  };
}

/**
 * Every draft the pipeline has written, in one list.
 *
 * Until this existed a draft could only be read through the person or the
 * company it belongs to, so "what has it actually written" — 455 rows, 5 of
 * which pass the send gate — was a question the dashboard could not answer at
 * all. The lanes are the validator's own verdict, not a second opinion:
 * `validator_status` is the send gate and `validator_reasons` is already plain
 * English and already deduped.
 *
 * Blocked drafts keep their body on purpose. When 450 of 455 do not ship, the
 * reason has to sit next to the words, or the only visible fact is a number.
 */
export async function loadDrafts() {
  const [emails, companies, people] = await Promise.all([
    db.from("inbound_emails")
      .select("id,person_id,person_email,company_id,subject,body,validator_status,validator_reasons,opener_fact,opener_id,evidence_urls,icp_key,full_name,first_name,title,role_bucket,created_at")
      .order("created_at", { ascending: false }).limit(1000).then((r) => r.data ?? []),
    db.from("inbound_companies").select("id,name,domain,account_type,research_status,assigned_to")
      .then((r) => r.data ?? []),
    db.from("inbound_people_view").select("id,status,note,email,email_status")
      .limit(1000).then((r) => r.data ?? []),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const personById = new Map(people.map((p) => [p.id, p]));

  const rows = emails.map((e) => ({
    ...e,
    company: companyById.get(e.company_id) ?? null,
    person: personById.get(e.person_id) ?? null,
    passes: e.validator_status === "sent",
  }));

  // Why the blocked ones are blocked, commonest first. The reasons are the
  // backend's sentences verbatim — rewriting them here is how the two versions
  // start disagreeing about what stopped a send.
  const reasons = new Map();
  for (const r of rows) {
    if (r.passes) continue;
    for (const why of r.validator_reasons ?? []) {
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
    }
  }

  return {
    rows,
    passing: rows.filter((r) => r.passes).length,
    noBody: rows.filter((r) => !r.body).length,
    noAddress: rows.filter((r) => !r.person_email).length,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Leads in a rep's territory, inside a time window measured on the last visit. */
export function filterLeads(leads, { rep, range }) {
  const cut = range === "all" ? null : daysAgo(Number(range));
  return leads.filter((l) => {
    if (rep && rep !== "all" && !l.reps.includes(rep)) return false;
    if (!cut) return true;
    return l.lastVisit ? new Date(l.lastVisit.seen_at) >= cut : false;
  });
}

export const byLane = (leads, id) => leads.filter((l) => l.lane === id);

/** The page they were on, said as a person would say it. */
export const pageOf = (v) => pageTitle(v?.captured_url);

/** The raw path, for the tooltip — the name is for reading, this is for checking. */
export const pathOf = (v) => (v?.captured_url ?? "").replace(/^https?:\/\/[^/]+/, "") || "/";
