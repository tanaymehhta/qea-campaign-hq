/**
 * What the chat can read from Campaign HQ, one function per dashboard area.
 *
 * Every number comes from the helper or RPC the page itself uses, so the chat
 * and the tile cannot disagree about what a word means. Scope is resolved here
 * from the session's rep name, never from a model argument: a rep sees the
 * campaigns, call lists, meetings and pushes they own, and tanay@ sees all.
 * Inbound and the pipeline are company-wide on the dashboard too (/inbound has
 * an "All reps" picker), so they are not scoped.
 *
 * Outputs are capped (LIMIT rows) because every row costs the model tokens.
 */
import { callListOwners, callLog, callOwnerOf, contactsFor, gotThrough } from "./calls.js";
import {
  campaignIdsForRep, dailyRange, db, everyRow, mailboxRange, meetingArgs, meetingCounts,
  reachedCounts, responseCounts, responsePeople, shift, today, windowFrom,
} from "./db.js";
import { dateWindow } from "./pipeline.js";
import { filterLeads, loadCompany, loadQueue, tally } from "./inbound/queue.js";
import { repById } from "./inbound/routing.js";
import { staffDb } from "./staff-db.js";
import { splitThread } from "./thread.mjs";

const LIMIT = 40;
const ADMIN = "tanay@qeatech.com";
const clip = (s, n = 300) => (s == null ? null : String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
// Shared mailbox providers: a visitor from aol.com is not the company on our list.
const FREEMAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com", "me.com", "comcast.net", "protonmail.com"]);
const countBy = (rows, key) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] ?? 0) + 1), m), {});

/** The session's reach. `ids` null means every campaign the anon key can see. */
export async function scopeOf(email, repName) {
  if (String(email || "").toLowerCase() === ADMIN) {
    return { all: true, rep: null, ids: null, groupIds: null, callIds: null, label: "every rep" };
  }
  const [{ ids, groupIds }, { data }] = await Promise.all([
    campaignIdsForRep(repName),
    db.from("call_campaigns").select("id").eq("owner", repName),
  ]);
  return { all: false, rep: repName, ids, groupIds, callIds: (data ?? []).map((c) => c.id), label: repName };
}

/** {from, to} as NY calendar dates. A named range wins; neither means all time. */
export function windowOf({ range, from, to } = {}) {
  if (range && range !== "all") {
    const w = windowFrom({ range });
    return { from: w.from, to: w.to };
  }
  if (from || to) return { from: from ?? null, to: to ?? today() };
  return { from: null, to: null };
}

async function groupOfCampaign() {
  const [{ data: members }, { data: groups }] = await Promise.all([
    db.from("campaign_group_members").select("campaign_id, group_id"),
    db.from("campaign_groups").select("id, display_name, owner"),
  ]);
  const name = new Map((groups ?? []).map((g) => [g.id, g]));
  return new Map((members ?? []).map((m) => [m.campaign_id, name.get(m.group_id)]));
}

/** Sends, people reached, responses and meetings over one window — the Overview tiles. */
export async function metrics(scope, { compare_previous = false, ...args } = {}) {
  const w = windowOf(args);
  const now = await metricsFor(scope, w);
  if (!compare_previous || !w.from) return now;
  // The same number of days, ending the day before this window starts.
  const days = Math.round((Date.parse(w.to) - Date.parse(w.from)) / 864e5);
  const to = shift(w.from, -1);
  return { ...now, previous_window: await metricsFor(scope, { from: shift(to, -days), to }) };
}

async function metricsFor(scope, w) {
  const mine = (id) => id && (scope.all || scope.ids.includes(id));
  const [rows, groupOf, reached, responses, meetings] = await Promise.all([
    dailyRange(w.from ?? "2020-01-01", w.to ?? today()),
    groupOfCampaign(),
    reachedCounts({ ...w, campaignIds: scope.ids, rep: scope.rep }),
    responseCounts({ ...w, campaignIds: scope.ids, source: null }),
    meetingCounts({ ...w, campaignIds: scope.ids, groupIds: scope.groupIds, rep: scope.rep }),
  ]);
  const days = {};
  const groups = {};
  let sent = 0;
  let bounced = 0;
  for (const r of rows.filter((r) => mine(r.campaign_id))) {
    sent += r.sent ?? 0;
    bounced += r.bounced ?? 0;
    days[r.metric_date] = (days[r.metric_date] ?? 0) + (r.sent ?? 0);
    const g = groupOf.get(r.campaign_id)?.display_name ?? "ungrouped";
    groups[g] = (groups[g] ?? 0) + (r.sent ?? 0);
  }
  return {
    scope: scope.label, window: w, today: today(),
    emails_sent: sent, bounced_in_notebook: bounced,
    sent_by_campaign_group: groups,
    sent_by_day: Object.entries(days).filter(([, n]) => n).map(([date, n]) => ({ date, sent: n })).slice(-62),
    reached: {
      people_reached: reached.people, via_instantly: reached.instantly, via_lemlist: reached.lemlist,
      by_phone_only: reached.calls, opened: reached.opened, open_trackable: reached.trackable,
    },
    responses: {
      people_responded: responses.responded, interested: responses.interested,
      not_interested: responses.responded == null ? null : responses.responded - responses.interested,
      unread: responses.needs_label, auto_reply_only: responses.robot_only,
      response_rate_pct: reached.people ? Math.round((1000 * responses.responded) / reached.people) / 10 : null,
    },
    meetings: { counted: meetings.meetings, distinct_people: meetings.people, from_calls: meetings.from_calls },
    notes: "people_responded counts people who really answered (not auto-replies), both email tools. Response rate = people_responded / people_reached. Today's sends are partial until the day ends. A null is unknown, not zero.",
  };
}

/** Who wrote back. `pile`: responded | interested | not_interested | needs_label | all. */
export async function replies(scope, { pile = "responded", search = "", tag = null, ...args } = {}) {
  if (!scope.all && !scope.ids.length) return { scope: scope.label, people: [] };
  const w = windowOf(args);
  const people = await responsePeople({ ...w, campaignIds: scope.ids, source: null }, { pile, search, tag, limit: LIMIT });
  // Their own words for the first few, newest message, quoted thread stripped.
  const emails = people.slice(0, 10).map((p) => p.lead_email);
  let bodies = [];
  if (emails.length) {
    let q = db.from("replies").select("lead_email, received_at, body, sentiment, campaign_id").in("lead_email", emails).order("received_at", { ascending: false });
    if (!scope.all) q = q.in("campaign_id", scope.ids);
    bodies = (await q).data ?? [];
  }
  const groupOf = await groupOfCampaign();
  return {
    scope: scope.label, window: w, pile, count_shown: people.length,
    people: people.map((p) => {
      const last = bodies.find((b) => b.lead_email === p.lead_email);
      const said = last ? splitThread(last.body, p.lead_email).find((m) => !m.mine)?.text ?? last.body : null;
      return {
        name: p.lead_name, email: p.lead_email, company: p.company, labels: p.labels, tools: p.sources,
        messages: p.msgs, first_at: p.first_at, last_at: p.last_at, interested: p.interested,
        unread: p.needs_label, auto_reply_only: p.robot_only,
        campaign: last ? groupOf.get(last.campaign_id)?.display_name ?? null : undefined,
        latest_reply: clip(said, 500),
      };
    }),
  };
}

/** Meetings, dated by the day they were booked. `status`: counted | all | removed. */
export async function meetings(scope, { status = "all", ...args } = {}) {
  const w = windowOf(args);
  const { data, error } = await db.rpc("meeting_rows", meetingArgs({ ...w, campaignIds: scope.ids, groupIds: scope.groupIds, rep: scope.rep, status }));
  if (error) throw new Error(error.message);
  return {
    scope: scope.label, window: w, today: today(), status_filter: status,
    note: "counted = booked + held, what every KPI counts. Window is on the day it was booked.",
    meetings: (data ?? []).slice(0, LIMIT).map((m) => ({
      person: m.prospect_name, email: m.prospect_email, company: m.company,
      meeting_date: m.meeting_date, booked_on: m.booked_on, status: m.status, rep: m.rep,
      campaign: m.scope_label, from_a_call: !!m.source_call_id, note: clip(m.note, 200),
    })),
  };
}

/** Logged calls, outcomes, callbacks due and do-not-call, for the call lists in scope. */
export async function calls(scope, args = {}) {
  const w = windowOf(args);
  const [log, { ownerOf, listOf }] = await Promise.all([callLog(w.from ? w : {}), callListOwners()]);
  const mine = scope.all ? log : log.filter((c) => callOwnerOf(c, ownerOf) === scope.rep);
  const lists = [...listOf.values()].filter((l) => scope.all || l.owner?.trim() === scope.rep);
  const contacts = (await Promise.all(lists.map((l) => contactsFor(l.id)))).flat();
  const listName = (id) => listOf.get(id)?.display_name ?? null;
  const t = today();
  const talkedTo = new Set(mine.filter((c) => gotThrough(c.outcome) && c.contact_id).map((c) => c.contact_id));
  return {
    scope: scope.label, window: w, today: t, call_lists: lists.map((l) => l.display_name),
    calls_logged: mine.length,
    by_outcome: countBy(mine, (c) => c.outcome),
    by_month: countBy(mine, (c) => c.call_date.slice(0, 7)),
    by_list: countBy(mine, (c) => listName(c.call_contacts?.call_campaign_id) ?? "no list"),
    people_talked_to: talkedTo.size,
    note: "Got through = booked_meeting, follow_up or not_interested. not_reached, left_email and made_call did not reach a person.",
    follow_up_calls: mine.filter((c) => c.outcome === "follow_up").map((c) => ({
      date: c.call_date, person: c.call_contacts?.full_name ?? c.prospect_name, org: c.call_contacts?.org_name ?? c.company, note: clip(c.note, 200),
    })),
    callbacks_due: contacts.filter((c) => !c.dnc && c.callback_date && c.callback_date <= t)
      .map((c) => ({ name: c.full_name, org: c.org_name, callback_date: c.callback_date, list: listName(c.call_campaign_id) })),
    do_not_call: contacts.filter((c) => c.dnc)
      .map((c) => ({ name: c.full_name, org: c.org_name, reason: c.dnc_reason, list: listName(c.call_campaign_id) })),
    recent_calls: mine.slice(0, LIMIT).map((c) => ({
      date: c.call_date, person: c.call_contacts?.full_name ?? c.prospect_name, org: c.call_contacts?.org_name ?? c.company,
      outcome: c.outcome, callback_date: c.callback_date, note: clip(c.note, 200),
    })),
  };
}

/** The /leads list: counts and people, searchable by name, email or company. */
export async function leads(scope, { search = "", reached = null, group = "" } = {}) {
  if (!scope.all && !scope.groupIds.length && !scope.callIds.length) return { scope: scope.label, people: [] };
  let groupIds = scope.groupIds;
  if (group) {
    const { data } = await db.from("campaign_groups").select("id, display_name").ilike("display_name", `%${group.replace(/[,()%*]/g, "")}%`);
    groupIds = (data ?? []).map((g) => g.id).filter((id) => scope.all || scope.groupIds.includes(id));
    if (!groupIds.length) return { scope: scope.label, people: [], note: `No campaign group named like "${group}" in scope.` };
  }
  const args = {
    p_groups: groupIds?.length ? groupIds : null,
    p_calls: group ? null : scope.callIds?.length ? scope.callIds : null,
    p_channel: null, p_status: null,
    p_reached: reached === "yes" || reached === "no" ? reached : null,
    p_contactable: null,
    p_search: search.replace(/[,()%*]/g, "").trim() || null,
  };
  const [{ data: facets }, { data: rows }] = await Promise.all([
    db.rpc("lead_facets", args),
    db.rpc("lead_rows", args).range(0, LIMIT - 1),
  ]);
  const emails = (rows ?? []).map((p) => p.email).filter(Boolean);
  let said = [];
  if (emails.length) {
    let q = db.from("replies").select("lead_email, sentiment, received_at").in("lead_email", emails);
    if (!scope.all) q = q.in("campaign_id", scope.ids);
    said = (await q).data ?? [];
  }
  const counts = {};
  for (const f of facets ?? []) {
    // total:* ignores every filter and is the whole company's universe.
    if (f.facet === "total" && !scope.all) continue;
    if (f.facet === "list") continue;
    counts[`${f.facet}:${f.key}`] = f.n;
  }
  const [{ data: gs }, { data: cls }] = await Promise.all([
    db.from("campaign_groups").select("id, display_name"),
    db.from("call_campaigns").select("id, display_name"),
  ]);
  const groupOf = new Map([...(gs ?? []), ...(cls ?? [])].map((g) => [g.id, g.display_name]));
  return {
    scope: scope.label,
    counts,
    note: "shown:all is the number matching these filters. reached:yes = contacted, reached:no = never contacted.",
    people: (rows ?? []).map((p) => ({
      name: p.name, email: p.email, company: p.company, title: p.title, phone: p.phone,
      list: groupOf.get(p.group_id) ?? groupOf.get(p.call_campaign_id) ?? null, status: p.status,
      first_contacted_at: p.first_contacted_at, calls: p.calls, call_outcome: p.call_outcome,
      callback_date: p.callback_date, dnc: p.dnc, buildings: p.buildings_count,
      meetings: p.meetings, meeting_status: p.meeting_status, contactable: p.contactable,
      replies: said.filter((r) => r.lead_email === p.email).map((r) => ({ at: r.received_at, label: r.sentiment })),
    })),
  };
}

/** The inbound queue (/inbound). Company-wide. Windows are rolling 24h blocks, as on the page. */
export async function inbound(scope, { range = "all", search = "", outbound = false } = {}) {
  const q = await loadQueue();
  const inWindow = filterLeads(q.companies, { rep: null, range: ["1", "7", "30"].includes(range) ? range : "all" });
  const card = (l) => ({
    name: l.name, domain: l.domain, visits: l.visitCount, last_visit: l.lastVisit?.seen_at ?? null,
    region: l.place || l.region, routed_to: l.reps.map((id) => repById(id)?.name ?? id),
    people_found: l.contacts.length, ready_to_email: l.ready, research: l.chip.state, lane: l.lane,
    reached_out: l.touch ? { by: repById(l.company.reached_out_by)?.name ?? l.company.reached_out_by, at: l.company.reached_out_at } : null,
  });
  const out = {
    scope: "company-wide (inbound is not owned by a rep)", range,
    note: "range 1/7/30 = rolling 24-hour blocks back from now, on the company's latest visit. Nothing in inbound is ever sent; drafts only.",
    header_for_range: tally(inWindow),
    header_all_time: tally(q.companies),
    companies: inWindow.slice(0, 20).map(card),
    most_visited: [...q.companies].sort((a, b) => b.visitCount - a.visitCount).slice(0, 10).map((l) => ({ name: l.name, domain: l.domain, visits: l.visitCount })),
    reached_out: q.companies.filter((l) => l.touch).map(card),
  };
  const [{ data: hits }, { data: buildings }, { data: companies }] = await Promise.all([
    db.from("inbound_compliance_hits").select("company_id, rule_name"),
    db.from("inbound_buildings").select("company_id"),
    db.from("inbound_companies").select("id, name, domain"),
  ]);
  const nameOf = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const ruleCompanies = {};
  for (const h of hits ?? []) (ruleCompanies[h.rule_name] ??= new Set()).add(h.company_id);
  out.compliance_rules_by_companies = Object.entries(ruleCompanies).map(([rule, s]) => ({ rule, companies: s.size })).sort((a, b) => b.companies - a.companies).slice(0, 15);
  out.companies_with_compliance_hits = new Set((hits ?? []).map((h) => h.company_id)).size;
  const perCo = countBy(buildings ?? [], (b) => b.company_id);
  out.buildings = {
    total: (buildings ?? []).length, companies: Object.keys(perCo).length,
    most: Object.entries(perCo).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ company: nameOf.get(id), buildings: n })),
  };
  if (outbound) out.also_in_outbound = await crossover(scope, q.companies);
  if (search) {
    const s = search.toLowerCase();
    const hit = (companies ?? []).find((c) => c.name?.toLowerCase().includes(s) || c.domain?.toLowerCase().includes(s));
    out.company = hit ? await companyCard(hit.id) : `No inbound company named like "${search}".`;
  }
  return out;
}

/**
 * Visiting companies whose domain also appears in our outbound: people on our
 * lists, and people who wrote back. Matched on email domain. Outbound is scoped
 * to the session even though inbound is not.
 */
async function crossover(scope, companies) {
  const domainOf = (e) => String(e ?? "").split("@")[1]?.toLowerCase() ?? null;
  const [people, responders] = await Promise.all([
    !scope.all && !scope.groupIds.length && !scope.callIds.length ? [] : everyRow(() => {
      const q = db.from("v_lead_people").select("email, group_id, call_campaign_id").not("email", "is", null).order("email");
      if (scope.all) return q;
      const ors = [];
      if (scope.groupIds.length) ors.push(`group_id.in.(${scope.groupIds.join(",")})`);
      if (scope.callIds.length) ors.push(`call_campaign_id.in.(${scope.callIds.join(",")})`);
      return q.or(ors.join(","));
    }),
    scope.all || scope.ids.length
      ? responsePeople({ from: null, to: null, campaignIds: scope.ids, source: null }, { pile: "all", limit: 1000 })
      : [],
  ]);
  const onLists = countBy(people, (p) => domainOf(p.email));
  return companies
    .filter((c) => c.domain && !FREEMAIL.has(c.domain.toLowerCase()) && (onLists[c.domain.toLowerCase()] || responders.some((r) => domainOf(r.lead_email) === c.domain.toLowerCase())))
    .map((c) => ({
      company: c.name, domain: c.domain, visits: c.visitCount,
      people_on_our_lists: onLists[c.domain.toLowerCase()] ?? 0,
      wrote_back: responders.filter((r) => domainOf(r.lead_email) === c.domain.toLowerCase())
        .map((r) => ({ name: r.lead_name, email: r.lead_email, labels: r.labels, auto_reply_only: r.robot_only })),
    }))
    .sort((a, b) => b.people_on_our_lists - a.people_on_our_lists)
    .slice(0, LIMIT);
}

async function companyCard(id) {
  const c = await loadCompany(id);
  const co = c.company ?? {};
  return {
    name: co.name, domain: co.domain, vertical: co.vertical, hq: [co.hq_city, co.hq_state, co.hq_country].filter(Boolean).join(", "),
    account_type: co.account_type, why: clip(co.account_type_reason, 400), summary: clip(co.summary, 600),
    research_status: co.research_status, portfolio_scale: co.portfolio_scale,
    reached_out: co.reached_out_by ? { by: repById(co.reached_out_by)?.name ?? co.reached_out_by, at: co.reached_out_at } : null,
    visits: c.visits?.length ?? 0, last_visit: c.visits?.[0]?.seen_at ?? null,
    buildings: (c.buildings ?? []).length,
    compliance: [...new Set((c.hits ?? []).map((h) => h.rule_name))],
    intent_signals: (c.signals ?? []).slice(0, 5).map((s) => clip(s.claim_or_target, 200)),
    people: (c.people ?? []).slice(0, 10).map((p) => ({ name: p.full_name, title: p.title, email: p.email, status: p.status })),
    drafts: (c.emails ?? []).length, drafts_passing_gate: (c.emails ?? []).filter((e) => e.validator_status === "sent").length,
  };
}

/** Inbound pipeline health and spend (/inbound?tab=pipeline). Company-wide. */
export async function pipeline(_scope, { range = "7" } = {}) {
  const win = dateWindow({ range: ["1", "7", "30"].includes(range) ? range : "all" });
  const [runs, drafts, webhooks, { data: companies }] = await Promise.all([
    everyRow(() => {
      let q = db.from("inbound_graph_runs").select("id, company_id, graph_name, stage_no, status, started_at, total_cost_usd, apollo_credits, error").order("started_at", { ascending: false });
      if (win.start) q = q.gte("started_at", win.start);
      return q;
    }),
    everyRow(() => db.from("inbound_emails").select("id, validator_status").order("id")),
    everyRow(() => db.from("inbound_webhook_events").select("id, parse_status").order("id")),
    db.from("inbound_companies").select("id, name"),
  ]);
  const nameOf = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const sum = (f) => Math.round(runs.reduce((t, r) => t + (Number(f(r)) || 0), 0) * 100) / 100;
  const last = runs[0];
  return {
    scope: "company-wide", range, window_start: win.start,
    runs: runs.length, by_status: countBy(runs, (r) => r.status),
    cost_usd: sum((r) => r.total_cost_usd), apollo_credits: sum((r) => r.apollo_credits),
    last_run: last ? { at: last.started_at, stage: last.stage_no, graph: last.graph_name, status: last.status, company: nameOf.get(last.company_id) } : null,
    problems: runs.filter((r) => r.status === "error" || r.status === "needs_review").slice(0, 15)
      .map((r) => ({ at: r.started_at, company: nameOf.get(r.company_id), stage: r.stage_no, status: r.status, error: clip(r.error, 200) })),
    drafts_all_time: { total: drafts.length, passing_gate: drafts.filter((d) => d.validator_status === "sent").length },
    webhooks_all_time: { total: webhooks.length, failed_to_parse: webhooks.filter((w) => w.parse_status === "failed").length },
    note: "validator_status 'sent' means the draft passes the gate. Nothing is actually sent.",
  };
}

/** Mailboxes (/inboxes): which send for whom, which are idle, bounces over a window. */
export async function inboxes(scope, args = {}) {
  const w = windowOf(args);
  const [{ data: accounts }, { data: camps }, groupOf] = await Promise.all([
    db.from("email_accounts").select("email, domain, source, status, warmup_enabled, warmup_score, daily_limit"),
    db.from("campaigns").select("id, name, sender_emails, daily_limit, status"),
    groupOfCampaign(),
  ]);
  const usedBy = new Map();
  for (const c of camps ?? []) {
    for (const e of c.sender_emails ?? []) {
      if (!usedBy.has(e)) usedBy.set(e, new Set());
      usedBy.get(e).add(c.id);
    }
  }
  const mineCamps = (camps ?? []).filter((c) => scope.all || scope.ids.includes(c.id));
  const mineBoxes = new Set(mineCamps.flatMap((c) => c.sender_emails ?? []));
  const boxes = (accounts ?? []).filter((a) => scope.all || mineBoxes.has(a.email));
  const daily = w.from || w.to ? await mailboxRange(w.from ?? "2020-01-01", w.to ?? today()) : await mailboxRange("2020-01-01", today());
  const sent = {};
  const bounced = {};
  for (const d of daily) {
    if (!scope.all && !mineBoxes.has(d.email)) continue;
    sent[d.email] = (sent[d.email] ?? 0) + (d.sent ?? 0);
    bounced[d.email] = (bounced[d.email] ?? 0) + (d.bounced ?? 0);
  }
  const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  return {
    scope: scope.label, window: w,
    note: "Mailbox sends/bounces come from a nightly pull and lag a day. Idle = in no visible campaign's sender list.",
    mailboxes: boxes.length,
    domains: new Set(boxes.map((b) => b.domain)).size,
    by_source: countBy(boxes, (b) => b.source),
    idle: scope.all ? boxes.filter((b) => !usedBy.has(b.email)).length : undefined,
    campaigns: mineCamps.filter((c) => c.sender_emails?.length).map((c) => ({
      campaign: c.name, group: groupOf.get(c.id)?.display_name ?? null, status: c.status,
      daily_limit: c.daily_limit, mailboxes: c.sender_emails,
    })),
    window_sent: total(sent), window_bounced: total(bounced),
    worst_bouncing: Object.entries(bounced).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([email, n]) => ({ email, bounced: n, sent: sent[email] ?? 0 })),
  };
}

/** Open data conflicts (/conflicts) on campaigns in scope. */
export async function conflicts(scope) {
  const [{ data }, groupOf] = await Promise.all([db.from("v_conflicts").select("*"), groupOfCampaign()]);
  const rows = (data ?? []).filter((c) => scope.all || (c.campaign_id && scope.ids.includes(c.campaign_id)));
  return {
    scope: scope.label, open: rows.length,
    conflicts: rows.slice(0, LIMIT).map((c) => ({
      kind: c.kind, date: c.conflict_date, campaign: groupOf.get(c.campaign_id)?.display_name ?? null,
      title: c.title, detail: clip(c.detail, 200), items: c.items,
    })),
  };
}

/** HubSpot pushes. RLS has no read policy on this table, so it is read with the service key, scoped here. */
export async function hubspot(scope) {
  let q = staffDb().from("hubspot_pushes").select("email, deal_id, deal_name, owner, campaign_id, pushed_at, attempts, last_error").order("pushed_at", { ascending: false });
  if (!scope.all) q = q.eq("owner", scope.rep);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    scope: scope.label, pushed: rows.length, stuck_without_deal: rows.filter((r) => !r.deal_id).length,
    by_owner: countBy(rows, (r) => r.owner ?? "none"),
    note: "Only people labelled plain 'interested' are pushed; referral and not_now replies are never pushed, by design. Campaign HQ stores that a deal exists, not its amount or stage.",
    pushes: rows.slice(0, LIMIT).map((r) => ({ email: r.email, deal: r.deal_name, has_deal: !!r.deal_id, owner: r.owner, pushed_at: r.pushed_at, error: clip(r.last_error, 150) })),
  };
}
