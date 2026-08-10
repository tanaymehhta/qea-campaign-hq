import { db } from "../db";
import { locate, repsFor, RESERVED_TLD } from "./routing";
import { pageTitle, verdict } from "./words";

/**
 * The inbound queue as a salesperson reads it.
 *
 * `/pipeline` is organised around the run: one row per company, a dot per stage,
 * cost per node. This is organised around the next action: who to contact, and
 * what to say to them. Read-only — every `inbound_*` table is.
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
  { id: "undecided", label: "Not researched yet" },
  { id: "irrelevant", label: "Not relevant companies" },
  // Accounts that exist to test the pipeline, in two flavours. Ten were typed in
  // by hand and never visited — checked against inbound_webhook_events, which
  // holds no payload for any of them. One more, Metro Harbor Properties, has
  // both a visit and a webhook row and is still not real: its domain ends in
  // `.example`, which RFC 2606 reserves precisely so it can never resolve. Its
  // visit is what testing the webhook looks like.
  //
  // They are not hidden: they hold most of the drafted work — BXP has 25
  // buildings researched, Durst the only five drafts that pass the send gate.
  // Excluding them made the queue look empty. They just do not get to sit among
  // real leads.
  { id: "unvisited", label: "Test accounts — not real inbound" },
];

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
  const [people, companies, visits, emails, buildings, hits, signals, rules] = await Promise.all([
    // `inbound_people_view` rather than the table: the backend derives `status`
    // (Ready / Needs a check) and one plain-English `note` from list_status,
    // sendable, company_match and email_status, and it owns those columns. A
    // second derivation here would say something different the first time one of
    // them changes meaning. Verified 417 of 417 rows survive the view's join.
    db.from("inbound_people_view")
      .select("id,company_id,full_name,first_name,title,email,email_status,role_bucket,role_hypothesis,source,priority,city,state,linkedin_url,status,note")
      .order("priority", { ascending: true }).limit(1000).then((r) => r.data ?? []),
    db.from("inbound_companies")
      .select("id,name,domain,hq_city,hq_state,hq_country,vertical,account_type,research_status,portfolio_scale,summary,last_visited_at")
      .then((r) => r.data ?? []),
    db.from("inbound_visits").select("person_id,company_id,seen_at,captured_url")
      .order("seen_at", { ascending: false }).limit(1000).then((r) => r.data ?? []),
    db.from("inbound_emails")
      .select("id,person_id,person_email,company_id,subject,body,validator_status,validator_reasons,opener_fact,evidence_urls,send_status,pushed_at,created_at")
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
    // off the view. There is deliberately no third state for "sent": nothing has
    // ever been sent from this system and `push_instantly` is a permanent no-op,
    // so a lane for it would be an empty lane forever.
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
      priority: p.priority ?? 99,
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

  const companyLeads = companies
    .map((c) => {
      // Real inbound has to clear two bars: somebody actually visited, and the
      // domain has to be one that can exist. `.example`/`.test`/`.invalid`/
      // `.localhost` are reserved by RFC 2606 and RFC 6761 and never resolve, so
      // a company under one was typed in, whatever its visit row says.
      const visited = visitsAt.has(c.id) && !RESERVED_TLD.test(c.domain ?? "");
      const vs = (visitsAt.get(c.id) ?? []).sort(
        (a, b) => Date.parse(b.seen_at) - Date.parse(a.seen_at));
      // A company's territory is read off whoever visited it, falling back to
      // the company's own record — same order the person cards use.
      // Any visitor-sourced row, named or not — the same rule `loadCompany` uses.
      // Matching only the anonymous ones ignored the geo on 13 companies whose
      // visitor RB2B *did* name: New Horizons Preschool's card fell through to
      // its .au domain and read "New York, NY · Elsewhere · Unrouted" while its
      // own page said "United States · Mark Wasu". A card that contradicts
      // itself is worse than either answer alone.
      const visitor = leads.find((l) =>
        l.company?.id === c.id && (l.identity === "anon" || l.identity === "visited"));
      const { region, place, basis } = visitor ?? locate(null, c, builtAt.get(c.id) ?? []);
      const mine = contactsAt.get(c.id) ?? [];
      const ready = mine.filter((l) => l.ready).length;
      const drafts = mine.filter((l) => l.draft).length;
      return {
        id: c.id, name: c.name, domain: c.domain, company: c, visited,
        region, place: place || visitor?.place || "", basis,
        reps: repsFor(region).map((r) => r.id),
        visitCount: vs.length, lastVisit: vs[0] ?? null,
        hooks: hooksFor(c.id),
        contacts: mine, ready, drafts,
        verdict: verdict(c),
        lane: visited ? verdict(c).lane : "unvisited",
        researched: c.research_status,
        accountType: c.account_type,
      };
    })
    .sort(byRecency);

  return { people: named, companies: companyLeads };
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
  const [company, buildings, hits, signals, visits, people, emails] = await Promise.all([
    db.from("inbound_companies").select("*").eq("id", companyId).maybeSingle().then((r) => r.data),
    db.from("inbound_buildings").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_compliance_hits").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_intent_signals").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
    db.from("inbound_visits").select("*").eq("company_id", companyId)
      .order("seen_at", { ascending: false }).then((r) => r.data ?? []),
    db.from("inbound_people_view").select("*").eq("company_id", companyId)
      .order("priority", { ascending: true }).then((r) => r.data ?? []),
    db.from("inbound_emails").select("*").eq("company_id", companyId).then((r) => r.data ?? []),
  ]);
  if (!company) return { company: null };

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
    // research found around them, in the pipeline's own priority order.
    .sort((a, b) => (b.visits.length ? 1 : 0) - (a.visits.length ? 1 : 0)
      || (a.priority ?? 99) - (b.priority ?? 99));

  return {
    company, buildings, signals, visits, emails, geo,
    hits: await withRules(hits),
    people: named,
    reps: repsFor(geo.region),
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

/** Leads in a rep's territory, inside a time window measured on the last visit. */
export function filterLeads(leads, { rep, range }) {
  const cut = range === "all" ? null : daysAgo(Number(range));
  return leads.filter((l) => {
    if (rep && rep !== "all" && !l.reps.includes(rep)) return false;
    // A company that never visited cannot be filtered by when it visited. The
    // window means "recent inbound activity", and these have none by definition,
    // so hiding them behind a date would hide them permanently.
    if (l.visited === false) return true;
    if (!cut) return true;
    return l.lastVisit ? new Date(l.lastVisit.seen_at) >= cut : false;
  });
}

export const byLane = (leads, id) => leads.filter((l) => l.lane === id);

/** The page they were on, said as a person would say it. */
export const pageOf = (v) => pageTitle(v?.captured_url);

/** The raw path, for the tooltip — the name is for reading, this is for checking. */
export const pathOf = (v) => (v?.captured_url ?? "").replace(/^https?:\/\/[^/]+/, "") || "/";
