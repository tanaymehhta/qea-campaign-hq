#!/usr/bin/env node
/**
 * Import Campaign 02's call list into call_campaigns + call_contacts.
 *
 * Re-runnable, not a one-shot: contacts upsert on (call_campaign_id,
 * source_key), so running it twice equals running it once — the same
 * guarantee the sync job gives, and for the same reason. Hand-edited
 * details (phone/email/linkedin via update_contact_detail) and workspace
 * state (dnc, callback_date) are preserved on re-run: the existing value
 * wins, the source only fills blanks.
 *
 * One row is one PERSON, not one building. The source is 2,119 buildings
 * but ~1,250 distinct people; a rep dials Christopher Krepcio once.
 *
 * Usage:
 *   node scripts/import_call_list.mjs --dry-run       # parse + reconcile, no writes
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import_call_list.mjs
 */
import { readFile } from "node:fs/promises";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const FILE = "data/Campaign02_SAFE_Reliable_2119.xlsx";
const SLUG = "nyc-ll11-safe";
const OWNER = "Mark Vasu";
const DRY = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------- helpers

/** Defect 1: case/whitespace variants inflate the person count.
 *  `Nicholas Ferrara` and `Nicholas  Ferrara` are one man. The normalized
 *  form builds source_key; the best-formatted variant is kept for display. */
const norm = (s) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Prefer the variant with no doubled spaces and mixed case. */
function betterDisplay(a, b) {
  const score = (s) => (/\s{2,}/.test(s) ? 2 : 0) + (s === s.toUpperCase() ? 1 : 0);
  const ca = (a ?? "").trim().replace(/\s+/g, " ");
  const cb = (b ?? "").trim().replace(/\s+/g, " ");
  if (!ca) return cb;
  if (!cb) return ca;
  return score(cb) < score(ca) ? cb : ca;
}

/** Defect 2: "PR" is not a company — a junk owner business name on 119
 *  unrelated buildings. Treat it as null, never group on it. */
const cleanOrg = (s) => {
  const v = (s ?? "").trim();
  return !v || v.toUpperCase() === "PR" ? null : v;
};

const val = (s) => {
  const v = typeof s === "string" ? s.trim() : s;
  return v === "" || v == null ? null : String(v);
};

// ---------------------------------------------------------------- parse

const wb = XLSX.readFile(FILE);
const sheet = (name) => {
  if (!wb.SheetNames.includes(name)) throw new Error(`missing tab: ${name}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
};

const ranked = sheet("Ranked_Targets");
const byEng = sheet("By_Engineer");
const byOwn = sheet("By_Owner");

// One entry per person. Key = role + normalized name.
const people = new Map();
let skippedNoName = 0;
let skippedNoOwner = 0;

function addBuilding(role, rawName, row, extra) {
  const n = norm(rawName);
  if (!n) return false;
  const key = `${role}:${n}`;
  let p = people.get(key);
  if (!p) {
    p = {
      source_key: key, role, full_name: "", org_name: null, license_no: null,
      phone: null, email: null, linkedin: null, contact_source: null,
      city: null, state: null, zip: null,
      buildings: [], dnc: false, dnc_reason: null,
    };
    people.set(key, p);
  }
  p.full_name = betterDisplay(p.full_name, rawName);
  p.org_name = p.org_name ?? cleanOrg(extra.org);
  p.license_no = p.license_no ?? val(extra.license);
  p.city = p.city ?? val(extra.city);
  p.state = p.state ?? val(extra.state);
  p.zip = p.zip ?? val(extra.zip);
  p.buildings.push({
    bin: val(row.BIN), address: val(row.Address), borough: val(row.Borough),
    rank: row.Rank, score: row.Reliability_Score,
  });
  // Defect 3: NYCHA — 169 buildings behind 4 names. Public housing,
  // procurement-gated, almost certainly not the buyer. Imported but tagged
  // so it filters out of the working list without being deleted.
  if ((extra.org ?? "").trim().toUpperCase() === "NYCHA") {
    p.dnc = true;
    p.dnc_reason = "institutional — review";
  }
  return true;
}

for (const row of ranked) {
  const gotEng = addBuilding("engineer", row.QEWI_Name, row, {
    org: row.QEWI_Bus_Name, license: row.QEWI_License,
    city: row.QEWI_City, state: row.QEWI_State, zip: row.QEWI_Zip,
  });
  const gotOwn = addBuilding("owner", row.Owner_Name, row, {
    org: row.Owner_Bus_Name,
    city: row.Owner_City, state: row.Owner_State, zip: row.Owner_Zip,
  });
  // Defect 4: buildings with no name on either channel cannot become a row.
  if (!gotEng && !gotOwn) skippedNoName++;
  else if (gotEng && !gotOwn) skippedNoOwner++;
}

// Merge contact details from the directory tabs, matched on normalized name.
// The tabs themselves carry case-variant duplicate rows; first non-null wins.
let unmatchedDirectory = 0;
function mergeDirectory(rows, role, nameField) {
  for (const row of rows) {
    const p = people.get(`${role}:${norm(row[nameField])}`);
    if (!p) { unmatchedDirectory++; continue; }
    p.full_name = betterDisplay(p.full_name, row[nameField]);
    p.email = p.email ?? val(row.Email);
    p.phone = p.phone ?? val(row.Phone);
    p.linkedin = p.linkedin ?? val(row.LinkedIn);
    p.contact_source = p.contact_source ?? val(row.Contact_Source);
    p.city = p.city ?? val(row.City);
    p.state = p.state ?? val(row.State);
    p.zip = p.zip ?? val(row.Zip);
  }
}
mergeDirectory(byEng, "engineer", "QEWI_Engineer");
mergeDirectory(byOwn, "owner", "Owner_Name");

const contacts = [...people.values()].map((p) => ({
  ...p,
  buildings: p.buildings.sort((a, b) => a.rank - b.rank),
  buildings_count: p.buildings.length,
  best_rank: Math.min(...p.buildings.map((b) => b.rank)),
}));

// ---------------------------------------------------------------- reconcile

const engineers = contacts.filter((c) => c.role === "engineer");
const owners = contacts.filter((c) => c.role === "owner");
const withPhone = contacts.filter((c) => c.phone).length;
const withEmail = contacts.filter((c) => c.email).length;
const dialable = contacts.filter((c) => c.phone || c.email).length;
const nycha = contacts.filter((c) => c.dnc).length;

const engBuildings = new Set(engineers.flatMap((c) => c.buildings.map((b) => b.bin))).size;
const ownBuildings = new Set(owners.flatMap((c) => c.buildings.map((b) => b.bin))).size;

console.log(`
== Reconciliation — ${FILE} ==
Rows read:            Ranked_Targets ${ranked.length} · By_Engineer ${byEng.length} · By_Owner ${byOwn.length}
Contacts to load:     ${contacts.length}  (${engineers.length} engineers, ${owners.length} owners)
Buildings skipped:    ${skippedNoName} with no name on either channel
                      ${skippedNoOwner} with an engineer but no owner (engineer row still created)
Directory rows that matched no ranked-list person: ${unmatchedDirectory}
Contacts with phone:  ${withPhone}
Contacts with email:  ${withEmail}
Dialable (phone or email): ${dialable}
Tagged institutional (NYCHA, dnc): ${nycha}
Buildings covered:    engineers ${engBuildings} · owners ${ownBuildings} (of ${ranked.length} in source)
`);

// The source README documents 253 engineers / 999 owners after normalization,
// and 48 no-name buildings. If we don't land there, say so before proceeding.
const expect = [
  ["engineers", engineers.length, 253],
  ["owners", owners.length, 999],
  ["no-name buildings", skippedNoName, 48],
];
let mismatch = false;
for (const [what, got, want] of expect) {
  if (got !== want) { mismatch = true; console.error(`MISMATCH: ${what} = ${got}, source README says ${want}`); }
}
if (mismatch) {
  console.error("Numbers do not reconcile to the source. Not proceeding.");
  process.exit(1);
}
console.log("Reconciles to the source README. ✓");

if (DRY) {
  console.log("Dry run — nothing written.");
  process.exit(0);
}

// No service key at hand? EMIT_SQL=<dir> writes the same upsert as chunked
// SQL files (dollar-quoted), to be applied over an admin connection instead.
if (process.env.EMIT_SQL) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const dir = process.env.EMIT_SQL;
  await mkdir(dir, { recursive: true });
  const q = (v) => (v == null ? "null" : `$q$${String(v)}$q$`);
  let md = null;
  try { md = await readFile("data/campaign02_summary.md", "utf8"); } catch {}
  const head = `insert into call_campaigns (slug, display_name, description, objective, owner, source_file, status${md ? ", summary_md" : ""})
values (${q(SLUG)}, ${q("NYC LL11 — SAFE / Reliable owners")},
  ${q("Buildings whose latest FISP status is SAFE with zero fines — owners who already budget for facade compliance. Phone-first.")},
  ${q("Book meetings via the QEWI-engineer referral channel: the top 32 engineers reach 50% of the 2,119 buildings.")},
  ${q(OWNER)}, ${q(FILE)}, 'active'${md ? `, ${q(md)}` : ""})
on conflict (slug) do update set display_name = excluded.display_name, owner = excluded.owner, source_file = excluded.source_file${md ? ", summary_md = excluded.summary_md" : ""};`;
  await writeFile(`${dir}/000_campaign.sql`, head);
  const CHUNK = 150;
  for (let i = 0; i < contacts.length; i += CHUNK) {
    const values = contacts.slice(i, i + CHUNK).map((c) =>
      `((select id from call_campaigns where slug = ${q(SLUG)}), ${q(c.source_key)}, ${q(c.full_name)}, ${q(c.role)}, ${q(c.org_name)}, ${q(c.license_no)}, ${q(c.phone)}, ${q(c.email)}, ${q(c.linkedin)}, ${q(c.city)}, ${q(c.state)}, ${q(c.zip)}, ${c.buildings_count}, ${q(JSON.stringify(c.buildings))}::jsonb, ${c.best_rank}, ${q(c.contact_source)}, ${c.dnc}, ${q(c.dnc_reason)})`
    ).join(",\n");
    const sql = `insert into call_contacts (call_campaign_id, source_key, full_name, role, org_name, license_no, phone, email, linkedin, city, state, zip, buildings_count, buildings, best_rank, contact_source, dnc, dnc_reason)
values\n${values}\non conflict (call_campaign_id, source_key) do nothing;`;
    await writeFile(`${dir}/${String(i / CHUNK + 1).padStart(3, "0")}_contacts.sql`, sql);
  }
  console.log(`Wrote ${Math.ceil(contacts.length / CHUNK) + 1} SQL files to ${dir}.`);
  process.exit(0);
}

// IMPORT_FN_TOKEN routes writes through the token-guarded import-call-list
// edge function (which holds the service key server-side); otherwise a local
// SUPABASE_SERVICE_ROLE_KEY writes directly. Reads stay on the anon key —
// the new tables are public-read like everything else.
const FN_TOKEN = process.env.IMPORT_FN_TOKEN;
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";

if (!SERVICE_KEY && !FN_TOKEN) {
  console.error("SUPABASE_SERVICE_ROLE_KEY or IMPORT_FN_TOKEN is required to write (anon key cannot).");
  process.exit(1);
}

async function fnWrite(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/import-call-list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ token: FN_TOKEN, ...payload }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`edge function ${res.status}: ${JSON.stringify(out)}`);
  return out;
}

// ---------------------------------------------------------------- upsert

const db = createClient(SUPABASE_URL, SERVICE_KEY ?? ANON_KEY, { auth: { persistSession: false } });

let summaryMd = null;
try { summaryMd = await readFile("data/campaign02_summary.md", "utf8"); } catch {}

const campaignRow = {
  slug: SLUG,
  display_name: "NYC LL11 — SAFE / Reliable owners",
  description:
    "Buildings whose latest FISP status is SAFE with zero fines — owners who already budget for facade compliance. Phone-first.",
  objective:
    "Book meetings via the QEWI-engineer referral channel: the top 32 engineers reach 50% of the 2,119 buildings.",
  owner: OWNER,
  source_file: FILE,
  status: "active",
};
// Only set summary_md when we have content, so a re-run never blanks
// an edited Context panel.
if (summaryMd) campaignRow.summary_md = summaryMd;

let camp;
if (FN_TOKEN) {
  camp = await fnWrite({ campaign: campaignRow });
} else {
  const { data, error: cErr } = await db
    .from("call_campaigns")
    .upsert(campaignRow, { onConflict: "slug" })
    .select("id")
    .single();
  if (cErr) { console.error("campaign upsert failed:", cErr.message); process.exit(1); }
  camp = data;
}

// Preserve hand-edits: fetch what's already there and let the existing value
// win for rep-editable fields (phone/email/linkedin) and workspace state
// (dnc, dnc_reason, callback_date). The source only fills blanks.
const existing = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("call_contacts")
    .select("source_key, phone, email, linkedin, dnc, dnc_reason, callback_date")
    .eq("call_campaign_id", camp.id)
    .range(from, from + 999);
  if (error) { console.error("fetch existing failed:", error.message); process.exit(1); }
  for (const r of data) existing.set(r.source_key, r);
  if (data.length < 1000) break;
}

const rows = contacts.map((c) => {
  const old = existing.get(c.source_key);
  return {
    call_campaign_id: camp.id,
    source_key: c.source_key,
    full_name: c.full_name,
    role: c.role,
    org_name: c.org_name,
    license_no: c.license_no,
    phone: old?.phone ?? c.phone,
    email: old?.email ?? c.email,
    linkedin: old?.linkedin ?? c.linkedin,
    city: c.city, state: c.state, zip: c.zip,
    buildings_count: c.buildings_count,
    buildings: c.buildings,
    best_rank: c.best_rank,
    contact_source: c.contact_source,
    dnc: old ? old.dnc || c.dnc : c.dnc,
    dnc_reason: old?.dnc_reason ?? c.dnc_reason,
    callback_date: old?.callback_date ?? null,
    updated_at: new Date().toISOString(),
  };
});

let written = 0;
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  if (FN_TOKEN) {
    await fnWrite({ contacts: chunk });
  } else {
    const { error } = await db
      .from("call_contacts")
      .upsert(chunk, { onConflict: "call_campaign_id,source_key" });
    if (error) { console.error(`upsert failed at row ${i}:`, error.message); process.exit(1); }
  }
  written += chunk.length;
}

console.log(`Upserted ${written} contacts into '${SLUG}' (${existing.size} already existed).`);
