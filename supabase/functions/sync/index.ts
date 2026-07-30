// QEA Campaign HQ — sync
//
// Pulls Instantly and lemlist into Supabase. Idempotent: every write is an
// upsert keyed on (campaign, date), so running twice equals running once and a
// missed run heals itself on the next pass.
//
// Modes:
//   incremental (default) — today + yesterday. Runs every 30 minutes.
//   nightly               — last 14 days, plus templates, steps and mailboxes.
//   weekly                — last 90 days.
//   backfill              — explicit ?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Auth: send the project's service-role key (or anon key) as a Bearer token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TZ = "America/New_York";
const INSTANTLY = "https://api.instantly.ai/api/v2";
const LEMLIST = "https://api.lemlist.com/api";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------------------------------------------------------------- helpers

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const shift = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function secret(name: string): Promise<string> {
  const { data, error } = await db.rpc("get_secret", { p_name: name });
  if (error || !data) throw new Error(`secret ${name}: ${error?.message ?? "missing"}`);
  return data as string;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getJSON(url: string, headers: Record<string, string>): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`${r.status} ${url.split("?")[0]} — ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error(`gave up after 3 attempts: ${url.split("?")[0]}`);
}

async function postJSON(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`${r.status} ${url.split("?")[0]} — ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error(`gave up after 3 attempts: ${url.split("?")[0]}`);
}

/** ET calendar date for a timestamp — the same normalisation the whole app uses. */
const etDate = (ts: string | number | Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ts));

/** Write activity rows in chunks; the unique key makes a re-run a no-op. */
async function writeActivities(rows: any[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    await db.from("activities").upsert(rows.slice(i, i + 500), {
      onConflict: "source,source_activity_id", ignoreDuplicates: true,
    });
    n += Math.min(500, rows.length - i);
  }
  return n;
}

const INSTANTLY_STATUS: Record<number, string> = {
  0: "draft", 1: "running", 2: "paused", 3: "completed", 4: "running", "-1": "errored",
};

// Instantly's per-lead status, which is a different vocabulary to campaign status.
const INSTANTLY_LEAD_STATUS: Record<string, string> = {
  "1": "active", "2": "paused", "3": "completed",
  "-1": "bounced", "-2": "unsubscribed", "-3": "skipped",
};

// Nothing in Instantly's payload marks a message as an auto-reply: i_status and
// ai_interest_value are interest labels, so an unlabelled real reply looks
// identical to an out-of-office. All we have is the subject line, which is a
// guess. It is treated as one — v_reply_conflicts compares this labelling
// against Instantly's own per-day count and surfaces every disagreement for a
// person to settle. Never overwrite a row someone has already confirmed.
const AUTO_SUBJECT =
  /^\s*(automatic reply|auto[\s-]?reply|out of office|out of the office|<out of office>|automatische|réponse automatique|respuesta automática|abwesenheit)/i;
const AUTO_BODY = /\b(out of (the )?office|on (annual |parental )?leave|away from my desk|maternity leave|返信|不在)\b/i;

function looksAutomatic(subject: string, preview: string): boolean {
  if (AUTO_SUBJECT.test(subject ?? "")) return true;
  // "Re: ..." threads are replies; only fall back to the body when the subject
  // carries no signal either way.
  if (/^\s*(re|fw|fwd)\s*:/i.test(subject ?? "")) return false;
  return AUTO_BODY.test(preview ?? "");
}

// -------------------------------------------------- grouping (auto + override)

const EM_DASH = "—";

function splitName(name: string): { parent: string; sub: string } {
  const i = name.indexOf(EM_DASH);
  if (i === -1) return { parent: "Ungrouped", sub: name.trim() };
  return { parent: name.slice(0, i).trim(), sub: name.slice(i + 1).trim() };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ungrouped";

/** Assign every campaign to a group by name prefix. Never touches an override. */
async function regroup(): Promise<number> {
  const { data: campaigns } = await db.from("campaigns").select("id,name");
  if (!campaigns?.length) return 0;

  const { data: overrides } = await db
    .from("campaign_group_members").select("campaign_id").eq("assignment_source", "override");
  const locked = new Set((overrides ?? []).map((o: any) => o.campaign_id));

  const { data: groups } = await db.from("campaign_groups").select("id,slug");
  const bySlug = new Map((groups ?? []).map((g: any) => [g.slug, g.id]));

  const rows: any[] = [];
  for (const c of campaigns) {
    if (locked.has(c.id)) continue;
    const { parent, sub } = splitName(c.name);
    const slug = slugify(parent);
    if (!bySlug.has(slug)) {
      const { data: created } = await db.from("campaign_groups")
        .insert({ slug, display_name: parent, status: "live" })
        .select("id").single();
      if (created) bySlug.set(slug, created.id);
    }
    const gid = bySlug.get(slug);
    if (gid) rows.push({ group_id: gid, campaign_id: c.id, sub_campaign_label: sub, assignment_source: "auto" });
  }
  if (rows.length) await db.from("campaign_group_members").upsert(rows, { onConflict: "campaign_id" });
  return rows.length;
}

// ------------------------------------------------------------------ Instantly

async function syncInstantly(from: string, to: string, deep: boolean) {
  const key = await secret("INSTANTLY_API_KEY");
  const H = { Authorization: `Bearer ${key}` };
  let wrote = 0;

  // --- campaigns + sequence copy
  const campaigns: any[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("starting_after", cursor);
    const page = await getJSON(`${INSTANTLY}/campaigns?${q}`, H);
    campaigns.push(...(page.items ?? []));
    cursor = page.next_starting_after;
  } while (cursor);

  const idOf = new Map<string, string>();
  for (const c of campaigns) {
    const row = {
      source: "instantly",
      source_campaign_id: c.id,
      name: c.name,
      status: INSTANTLY_STATUS[c.status] ?? "unknown",
      status_raw: String(c.status),
      daily_limit: c.daily_limit ?? null,
      open_tracking: c.open_tracking ?? null,
      link_tracking: c.link_tracking ?? null,
      text_only: c.text_only ?? null,
      sender_emails: c.email_list ?? [],
      schedule_timezone: c.campaign_schedule?.schedules?.[0]?.timezone ?? null,
      started_on: c.campaign_schedule?.start_date ?? null,
      raw: c,
      last_synced: new Date().toISOString(),
    };
    const { data } = await db.from("campaigns")
      .upsert(row, { onConflict: "source,source_campaign_id" }).select("id").single();
    if (!data) continue;
    idOf.set(c.id, data.id);
    wrote++;

    if (deep) {
      const steps = c.sequences?.[0]?.steps ?? [];
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        for (let v = 0; v < (st.variants?.length ?? 0); v++) {
          const va = st.variants[v];
          const hash = await sha256(`${va.subject ?? ""} ${va.body ?? ""}`);
          await db.from("template_versions").upsert({
            campaign_id: data.id, step_index: i, variant: String(v),
            channel: st.type ?? "email", delay_days: st.delay ?? null,
            subject: va.subject ?? "", body: va.body ?? "",
            content_hash: hash, last_seen: new Date().toISOString(),
          }, { onConflict: "campaign_id,step_index,variant,content_hash", ignoreDuplicates: false });
        }
      }
    }
  }

  // --- lifetime totals
  for (const t of await getJSON(`${INSTANTLY}/campaigns/analytics`, H)) {
    const cid = idOf.get(t.campaign_id);
    if (!cid) continue;
    await db.from("campaign_totals").upsert({
      campaign_id: cid, as_of: new Date().toISOString(),
      leads: t.leads_count ?? 0, contacted: t.contacted_count ?? 0,
      sent: t.emails_sent_count ?? 0,
      delivered: (t.emails_sent_count ?? 0) - (t.bounced_count ?? 0),
      bounced: t.bounced_count ?? 0, opened: t.open_count ?? 0,
      replied: t.reply_count ?? 0, clicked: t.link_click_count ?? 0,
      opportunities: t.total_opportunities ?? 0,
      unsubscribed: t.unsubscribed_count ?? 0, completed: t.completed_count ?? 0,
      raw: t,
    }, { onConflict: "campaign_id" });
    wrote++;
  }

  // --- daily, per campaign
  for (const [srcId, cid] of idOf) {
    const q = new URLSearchParams({ campaign_id: srcId, start_date: from, end_date: to });
    const days = await getJSON(`${INSTANTLY}/campaigns/analytics/daily?${q}`, H);
    if (!Array.isArray(days) || !days.length) continue;
    const rows = days.map((d: any) => ({
      campaign_id: cid, metric_date: d.date,
      sent: d.sent ?? 0, contacted: d.contacted ?? 0,
      new_leads_contacted: d.new_leads_contacted ?? 0,
      opened: d.opened ?? 0, unique_opened: d.unique_opened ?? 0,
      replied: d.replies ?? 0, unique_replied: d.unique_replies ?? 0,
      replies_automatic: d.replies_automatic ?? 0,
      clicked: d.clicks ?? 0, unique_clicked: d.unique_clicks ?? 0,
      opportunities: d.opportunities ?? 0,
      pulled_at: new Date().toISOString(),
    }));
    await db.from("daily_metrics").upsert(rows, { onConflict: "campaign_id,metric_date" });
    wrote += rows.length;

    if (deep) {
      const steps = await getJSON(`${INSTANTLY}/campaigns/analytics/steps?campaign_id=${srcId}`, H);
      if (Array.isArray(steps) && steps.length) {
        await db.from("step_metrics").upsert(steps.map((s: any) => ({
          campaign_id: cid, step_index: Number(s.step), variant: String(s.variant ?? "0"),
          sent: s.sent ?? 0, opened: s.opened ?? 0, replied: s.replies ?? 0,
          replies_automatic: s.replies_automatic ?? 0, clicked: s.clicks ?? 0,
          as_of: new Date().toISOString(),
        })), { onConflict: "campaign_id,step_index,variant" });
      }
    }
  }

  // --- people, one row per lead per campaign
  //
  // Instantly exposes lifetime per-lead counters but no per-event timestamps: it
  // will tell you a lead opened three times, never when. So opens/clicks/replies
  // land in `people` as lifetime state, and the only activity row we can honestly
  // date is the last send, which `status_summary.lastStep` does timestamp.
  for (const [srcId, cid] of idOf) {
    const acts: any[] = [];
    let after: string | undefined;
    for (let page = 0; page < 30; page++) {
      const body: Record<string, unknown> = { campaign: srcId, limit: 100 };
      if (after) body.starting_after = after;
      const res = await postJSON(`${INSTANTLY}/leads/list`, H, body);
      const items = res.items ?? [];
      if (!items.length) break;

      const rows = items.map((l: any) => {
        const last = l.status_summary?.lastStep?.timestamp_executed ?? l.timestamp_last_contact ?? null;
        if (last) {
          acts.push({
            campaign_id: cid, source: "instantly",
            source_activity_id: `${l.id}:${last}`,
            event_type: "sent", occurred_at: last, activity_date: etDate(last),
            email: l.email ?? null,
            name: [l.first_name, l.last_name].filter(Boolean).join(" ") || null,
            company: l.company_name ?? null,
          });
        }
        return {
          campaign_id: cid, source: "instantly", email: l.email,
          name: [l.first_name, l.last_name].filter(Boolean).join(" ") || null,
          company: l.company_name ?? null,
          status: INSTANTLY_LEAD_STATUS[String(l.status)] ?? String(l.status ?? ""),
          sent_count: last ? 1 : 0,
          opened_count: l.email_open_count ?? 0,
          clicked_count: l.email_click_count ?? 0,
          replied_count: l.email_reply_count ?? 0,
          bounced: String(l.status) === "-1",
          first_contacted_at: l.timestamp_last_contact ?? last,
          last_contacted_at: l.timestamp_last_contact ?? last,
          raw: l, last_synced: new Date().toISOString(),
        };
      }).filter((r: any) => r.email);

      if (rows.length) {
        await db.from("people").upsert(rows, { onConflict: "campaign_id,email" });
        wrote += rows.length;
      }
      after = res.next_starting_after;
      if (!after || items.length < 100) break;
    }
    if (acts.length) wrote += await writeActivities(acts);
  }

  // --- inbound replies, from the Unibox
  //
  // The daily analytics endpoint reports that a reply happened but never hands
  // over the message, which is why this table was Instantly-blind until now.
  // /emails is the only endpoint that carries the person, the subject and the body.
  {
    const inboundRows: any[] = [];
    const inboundActs: any[] = [];
    let after: string | undefined;
    const floor = `${from}T00:00:00.000Z`;
    let done = false;

    for (let page = 0; page < 40 && !done; page++) {
      const q = new URLSearchParams({ limit: "100", email_type: "received" });
      if (after) q.set("starting_after", after);
      const res = await getJSON(`${INSTANTLY}/emails?${q}`, H);
      const items = res.items ?? [];
      if (!items.length) break;

      for (const e of items) {
        const ts = e.timestamp_email ?? e.timestamp_created;
        // The feed is newest-first, so the first message older than the window
        // means every remaining page is older too.
        if (ts && ts < floor) { done = true; break; }
        const cid = idOf.get(e.campaign_id);
        if (!cid || !ts) continue;

        const auto = looksAutomatic(e.subject ?? "", e.content_preview ?? "");
        inboundRows.push({
          campaign_id: cid, source: "instantly", source_message_id: e.id,
          lead_email: e.lead ?? e.from_address_email ?? null,
          lead_name: e.from_address_json?.name ?? null,
          company: null,
          channel: "email",
          received_at: ts,
          subject: e.subject ?? null,
          body: (e.content_preview ?? "").slice(0, 4000) || null,
          sentiment: auto ? "auto_reply" : "unclassified",
          classified_by: "ai",
          classified_at: new Date().toISOString(),
        });
        inboundActs.push({
          campaign_id: cid, source: "instantly", source_activity_id: `reply:${e.id}`,
          event_type: auto ? "auto_reply" : "replied",
          occurred_at: ts, activity_date: etDate(ts),
          email: e.lead ?? null, name: e.from_address_json?.name ?? null, company: null,
        });
      }
      after = res.next_starting_after;
      if (!after) break;
    }

    // ignoreDuplicates keeps a human's confirmed label intact: once a reply row
    // exists, later syncs never touch its sentiment.
    if (inboundRows.length) {
      for (let i = 0; i < inboundRows.length; i += 500) {
        await db.from("replies").upsert(inboundRows.slice(i, i + 500), {
          onConflict: "source,source_message_id", ignoreDuplicates: true,
        });
      }
      wrote += inboundRows.length;
      wrote += await writeActivities(inboundActs);
    }
  }

  // --- mailboxes
  if (deep) {
    const accts = await getJSON(`${INSTANTLY}/accounts?limit=100`, H);
    for (const a of accts.items ?? []) {
      await db.from("email_accounts").upsert({
        source: "instantly", email: a.email,
        domain: (a.email ?? "").split("@")[1] ?? null,
        warmup_enabled: a.warmup_status === 1,
        warmup_score: a.stat_warmup_score ?? null,
        daily_limit: a.daily_limit ?? null,
        status: String(a.status ?? ""), raw: a,
        last_synced: new Date().toISOString(),
      }, { onConflict: "source,email" });
      wrote++;
    }
  }
  return wrote;
}

// -------------------------------------------------------------------- lemlist

// lemlist activity type -> our own event vocabulary.
//
// linkedinVisitDone is deliberately absent: viewing someone's profile is not a
// connection request, and counting it as one inflated "LinkedIn requests sent".
const ACTIVITY_MAP: Record<string, string> = {
  emailsSent: "sent",
  emailsOpened: "opened",
  emailsClicked: "clicked",
  emailsReplied: "replied",
  emailsBounced: "bounced",
  emailsFailed: "bounced",
  outOfOffice: "auto_reply",
  emailsUnsubscribed: "unsubscribed",
  linkedinSent: "linkedin_sent",
  linkedinInviteDone: "linkedin_sent",
  linkedinInviteAccepted: "linkedin_accepted",
  linkedinReplied: "replied",
  linkedinInterested: "replied",
};

const REPLY_TYPES = new Set(["emailsReplied", "linkedinReplied", "outOfOffice"]);

async function syncLemlist(from: string, to: string, deep: boolean) {
  const key = await secret("LEMLIST_API_KEY");
  const H = { Authorization: `Basic ${btoa(`:${key}`)}` };
  let wrote = 0;

  // --- campaigns
  const campaigns: any[] = [];
  for (let page = 0; page < 20; page++) {
    const list = await getJSON(`${LEMLIST}/campaigns?limit=100&offset=${page * 100}`, H);
    if (!Array.isArray(list) || !list.length) break;
    campaigns.push(...list);
    if (list.length < 100) break;
  }

  const idOf = new Map<string, string>();
  for (const c of campaigns) {
    const { data } = await db.from("campaigns").upsert({
      source: "lemlist", source_campaign_id: c._id, name: c.name,
      status: ["running", "paused", "draft", "completed", "errored"].includes(c.status) ? c.status : "unknown",
      status_raw: c.status, started_on: (c.createdAt ?? "").slice(0, 10) || null,
      raw: c, last_synced: new Date().toISOString(),
    }, { onConflict: "source,source_campaign_id" }).select("id").single();
    if (data) { idOf.set(c._id, data.id); wrote++; }
  }

  // --- lifetime totals (stats needs an explicit window, so use a wide one)
  for (const [srcId, cid] of idOf) {
    try {
      const q = new URLSearchParams({ startDate: "2020-01-01", endDate: shift(to, 1) });
      const s = await getJSON(`${LEMLIST}/campaigns/${srcId}/stats?${q}`, H);
      // lemlist's /stats endpoint disagrees with itself across windows, so only
      // leadTotal is taken from it. Every message metric (sent, delivered,
      // bounced, opened, clicked, replied) is derived from the activity stream
      // by refresh_lemlist_totals().
      await db.from("campaign_totals").upsert({
        campaign_id: cid, as_of: new Date().toISOString(),
        leads: s.leadTotal ?? 0, raw: s,
      }, { onConflict: "campaign_id" });
      wrote++;
    } catch (_) { /* a campaign with no sequence returns Bad params — skip it */ }
  }

  // --- daily, built from the activity stream (one pass, all campaigns)
  const replyRows: any[] = [];
  const activityRows: any[] = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const q = new URLSearchParams({
      limit: "100", offset: String(offset),
      startDate: `${from}T00:00:00.000Z`, endDate: `${shift(to, 1)}T00:00:00.000Z`,
    });
    const acts = await getJSON(`${LEMLIST}/activities?${q}`, H);
    if (!Array.isArray(acts) || !acts.length) break;

    for (const a of acts) {
      const event = ACTIVITY_MAP[a.type];
      const cid = idOf.get(a.campaignId);
      if (!cid) continue;
      const date = etDate(a.createdAt);
      const email = a.leadEmail ?? a.email ?? null;
      const name =
        [a.leadFirstName ?? a.firstName, a.leadLastName ?? a.lastName].filter(Boolean).join(" ") || null;
      const company = a.leadCompanyName ?? a.companyName ?? null;

      if (event) {
        // lemlist timestamps every single event, so unlike Instantly its rows
        // survive a date filter intact.
        activityRows.push({
          campaign_id: cid, source: "lemlist", source_activity_id: a._id,
          event_type: event, occurred_at: a.createdAt, activity_date: date,
          email, name, company,
        });
      }

      if (REPLY_TYPES.has(a.type)) {
        replyRows.push({
          campaign_id: cid, source: "lemlist", source_message_id: a._id,
          lead_email: email,
          lead_name: name,
          company,
          channel: a.type.startsWith("linkedin") ? "linkedin" : "email",
          received_at: a.createdAt, subject: a.subject ?? null,
          body: a.messagePreview ?? null,
          sentiment: a.type === "outOfOffice" ? "auto_reply" : "unclassified",
        });
      }
    }
    if (acts.length < 100) break;
  }

  if (replyRows.length) {
    await db.from("replies").upsert(replyRows, {
      onConflict: "source,source_message_id", ignoreDuplicates: true,
    });
    wrote += replyRows.length;
  }
  if (activityRows.length) wrote += await writeActivities(activityRows);

  // daily_metrics used to be tallied here in memory from the same page loop
  // above — a second, independent count of the same feed. Two readings of one
  // paginated feed can disagree with each other (a page fetched while lemlist
  // is still writing new activity can skip or shuffle rows), and an additive
  // tally never gets revisited once wrong. Deriving it in SQL from what
  // `activities` actually holds, *after* activities is written, makes it a
  // single source of truth: it can only ever be behind until the next sync
  // recomputes it, never permanently wrong.
  const { data: recomputed } = await db.rpc("refresh_lemlist_daily_metrics", { p_from: from, p_to: to });
  wrote += recomputed ?? 0;
  return wrote;
}

// --------------------------------------------------------------------- entry

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "incremental";
  const to = url.searchParams.get("to") ?? today();
  const from = url.searchParams.get("from") ??
    (mode === "nightly" ? shift(to, -14)
      : mode === "weekly" ? shift(to, -90)
      : shift(to, -1));
  const deep = mode !== "incremental";

  const { data: run } = await db.from("sync_runs")
    .insert({ source: "both", mode, status: "running" }).select("id").single();

  const detail: Record<string, unknown> = { from, to, mode };
  let wrote = 0, status = "ok", err: string | null = null;

  try {
    const i = await syncInstantly(from, to, deep);
    detail.instantly_rows = i; wrote += i;
  } catch (e) {
    status = "partial"; err = `instantly: ${e.message}`; detail.instantly_error = e.message;
  }
  try {
    const l = await syncLemlist(from, to, deep);
    detail.lemlist_rows = l; wrote += l;
  } catch (e) {
    status = status === "partial" ? "error" : "partial";
    err = [err, `lemlist: ${e.message}`].filter(Boolean).join(" | ");
    detail.lemlist_error = e.message;
  }
  try {
    detail.grouped = await regroup();
  } catch (e) { detail.group_error = e.message; }

  try {
    const { data: n } = await db.rpc("refresh_lemlist_totals");
    detail.lemlist_totals_refreshed = n;
  } catch (e) { detail.totals_error = e.message; }

  // lemlist's per-person counters are rebuilt from the cumulative activity log
  // rather than accumulated in the loop above: an incremental run only sees a
  // two-day window, and upserting that would overwrite a lifetime count with it.
  try {
    const { data: n } = await db.rpc("refresh_lemlist_people");
    detail.lemlist_people_refreshed = n;
  } catch (e) { detail.people_error = e.message; }

  await db.from("sync_runs").update({
    finished_at: new Date().toISOString(), status, rows_upserted: wrote, detail, error: err,
  }).eq("id", run?.id);

  return new Response(JSON.stringify({ status, wrote, ...detail }, null, 2), {
    status: status === "error" ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
});
