#!/usr/bin/env node
/**
 * Widen `nyc-ll11-unsafe` from the 127-building Manhattan pilot to the whole
 * UNSAFE universe: 1,838 buildings, ~1,124 people.
 *
 * WHY THIS EXISTS. The pilot is 7% of the UNSAFE buildings, and that slice
 * decided which of Mark's calls looked like SAFE work. Stanford Chan, Jennifer
 * Sze, John Monroe and James Monahan were filed on the SAFE list because they
 * are not in the 127 — but they carry 1, 7, 15 and 2 UNSAFE buildings each.
 * Every person ever dialled carries UNSAFE buildings.
 *
 * IT DOES NOT MERGE THE TWO LISTS. `nyc-ll11-safe` is untouched. What it does
 * do is put ~313 humans on both, up from 37, because one engineer signs
 * filings for both kinds of building — Lloyd Valdez carries 422 UNSAFE and 115
 * SAFE. That is a fact about engineers, not a modelling choice.
 *
 * WHAT IT PROTECTS. A person already on the list (the pilot's 173, or anyone a
 * rep has edited) keeps their phone, email, linkedin, dnc and callback. Only
 * the buildings are rewritten, because the pilot rows carry the 127-slice of a
 * person's buildings and the truth is wider: Krepcio's row says 10, he signs
 * for 31.
 *
 * Contact details are merged from three places, first non-empty wins:
 * this file, then whatever `call_contacts` already holds for that name on any
 * list. That lifts dialable from 208 to ~275 and makes 27 of the top 32
 * engineers reachable — they cover 1,005 of the 1,838 buildings.
 *
 * Usage:
 *   node scripts/import_unsafe_full.mjs --dry-run
 *   node scripts/import_unsafe_full.mjs --only="Stanford Chan,Jennifer Sze"
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/import_unsafe_full.mjs --write
 *   node scripts/import_unsafe_full.mjs --emit=<dir>     # SQL, for the MCP path
 */
import { writeFile, mkdir } from "node:fs/promises";
import XLSX from "xlsx";

const FILE = "data/FISP_Targets_UNSAFE_SWARMP.xlsx";
const SLUG = "nyc-ll11-unsafe";
const SUPABASE_URL = "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY = process.argv.includes("--dry-run");
const WRITE = process.argv.includes("--write");
const EMIT = process.argv.find((a) => a.startsWith("--emit="))?.slice(7);
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7)
  ?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const norm = (s) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const val = (s) => {
  const v = typeof s === "string" ? s.trim() : s;
  return v === "" || v == null ? null : String(v);
};
/** Title-case the SHOUTED names this file carries ("BASHKIM  CACI"), and leave
 *  the already-cased ones alone. A rep reads this off a screen mid-dial. */
const display = (s) => {
  const v = (s ?? "").trim().replace(/\s+/g, " ");
  if (!v || v !== v.toUpperCase()) return v;
  return v.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

// ---------------------------------------------------------------- parse

const wb = XLSX.readFile(FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["UNSAFE_Contacts"], { defval: null });
const targets = XLSX.utils.sheet_to_json(wb.Sheets["Targets"], { defval: null });

/** The 90-day repair clock. UNSAFE_Contacts has no filing date; Targets does,
 *  for all 1,838. `overdue` is days past the deadline, 0 while it still runs. */
const filedOn = new Map(targets.map((r) => [String(r.BIN), r.Filing_Date]));
const TODAY = new Date("2026-08-21T00:00:00Z");
const overdueDays = (bin) => {
  const d = filedOn.get(String(bin));
  if (!d) return null;
  const [m, day, y] = String(d).split("/").map(Number);
  if (!y) return null;
  const days = Math.floor((TODAY - Date.UTC(y, m - 1, day)) / 86400000);
  return Math.max(0, days - 90);
};

const people = new Map();
function add(role, rawName, r, email, phone, linkedin, org) {
  const key = norm(rawName);
  if (!key) return;
  const id = `${role}:${key}`;
  let p = people.get(id);
  if (!p) {
    p = { source_key: id, role, full_name: display(rawName), org_name: null,
          phone: null, email: null, linkedin: null, seen: new Set(), buildings: [] };
    people.set(id, p);
  }
  p.org_name = p.org_name ?? val(org);
  p.email = p.email ?? val(email);
  p.phone = p.phone ?? val(phone);
  p.linkedin = p.linkedin ?? val(linkedin);
  const bin = String(r.BIN);
  if (p.seen.has(bin)) return;
  p.seen.add(bin);
  p.buildings.push({
    bin,
    address: val(r.Address),
    borough: val(r.Borough),
    rank: r.Priority ?? r.Priority_Rank ?? null,
    score: r.Urgency_Score ?? null,
    ecb: r.ecb_balance_due ?? 0,
    overdue: overdueDays(bin),
  });
}

for (const r of rows) {
  // The human behind the licence where Apollo found one, else the licence
  // holder — the same preference the pilot's By_Engineer tab was built on.
  add("engineer", r.QEWI_Contact_Name || r.QEWI_Name, r,
      r.QEWI_Email, r.QEWI_Phone, r.QEWI_LinkedIn, r.QEWI_Company || r.QEWI_Bus_Name);
  add("owner", r.Owner_Contact_Name || r.Owner_Name, r,
      r.Owner_Email, r.Owner_Phone, r.Owner_LinkedIn, r.Owner_Company || r.Owner_Bus_Name);
}

// ---------------------------------------------------------------- enrich

/** Everything call_contacts already knows about these humans, from any list.
 *  Reads are public, so the anon key is enough. */
async function page(url) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(url, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Range: `${from}-${from + 999}` },
    });
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error(JSON.stringify(d));
    out.push(...d);
    if (d.length < 1000) break;
  }
  return out;
}

const known = await page(`${SUPABASE_URL}/rest/v1/call_contacts?select=full_name,phone,email,linkedin,call_campaign_id,source_key`);
const camps = await page(`${SUPABASE_URL}/rest/v1/call_campaigns?select=id,slug`);
const unsafeId = camps.find((c) => c.slug === SLUG)?.id;
if (!unsafeId) throw new Error(`no campaign ${SLUG}`);

const held = new Map();
for (const r of known) {
  const k = norm(r.full_name);
  if (!k) continue;
  const cur = held.get(k) ?? {};
  held.set(k, {
    phone: cur.phone ?? r.phone, email: cur.email ?? r.email, linkedin: cur.linkedin ?? r.linkedin,
  });
}
/** Rows already on this list. They keep their contact details untouched — a
 *  rep may have corrected them mid-call — and only their buildings change. */
const already = new Set(known.filter((r) => r.call_campaign_id === unsafeId).map((r) => r.source_key));

let contacts = [...people.values()].map((p) => {
  const h = held.get(norm(p.full_name)) ?? {};
  const buildings = p.buildings.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return {
    ...p, buildings,
    phone: p.phone ?? h.phone ?? null,
    email: p.email ?? h.email ?? null,
    linkedin: p.linkedin ?? h.linkedin ?? null,
    buildings_count: buildings.length,
    best_rank: buildings[0]?.rank ?? null,
    existing: already.has(p.source_key),
  };
});
if (ONLY) contacts = contacts.filter((c) => ONLY.includes(c.full_name.toLowerCase()));

// ---------------------------------------------------------------- reconcile

/** The pilot import keyed people through `person()`, which strips ", RA" and
 *  "JR."; this one keys through plain `norm()`. If those ever disagree for the
 *  same human, the widened list grows a second row for them and the panel
 *  splits their calls in half. Checked, not assumed. */
const onList = new Map(
  known.filter((r) => r.call_campaign_id === unsafeId).map((r) => [norm(r.full_name), r.source_key])
);
const dupes = contacts
  .filter((c) => onList.has(norm(c.full_name)) && onList.get(norm(c.full_name)) !== c.source_key)
  .map((c) => `${c.full_name}: existing "${onList.get(norm(c.full_name))}" vs new "${c.source_key}"`);

const eng = contacts.filter((c) => c.role === "engineer");
const dial = contacts.filter((c) => c.phone || c.email).length;
const bins = new Set(contacts.flatMap((c) => c.buildings.map((b) => b.bin)));
console.log(`
== ${FILE} -> ${SLUG}${ONLY ? ` (--only, ${contacts.length} of them)` : ""} ==
Buildings in source:  ${rows.length}
People:               ${contacts.length}  (${eng.length} engineers, ${contacts.length - eng.length} owner-side)
Already on this list: ${contacts.filter((c) => c.existing).length}  (contact details preserved, buildings refreshed)
New:                  ${contacts.filter((c) => !c.existing).length}
Dialable:             ${dial}
Buildings covered:    ${bins.size}
Past the 90 days:     ${new Set(contacts.flatMap((c) => c.buildings.filter((b) => b.overdue > 0).map((b) => b.bin))).size} buildings
No named person:      ${rows.length - bins.size} buildings (no engineer and no owner name on the filing)
${dupes.length ? `\nDUPLICATE HUMANS — same name, two source_keys on this list:\n${dupes.map((d) => `  ${d}`).join("\n")}\n` : "No duplicate humans against the rows already on this list. \u2713"}
`);

if (DRY) { console.log("Dry run — nothing written."); process.exit(0); }

// ---------------------------------------------------------------- write

const q = (v) => (v == null ? "null" : `$q$${String(v)}$q$`);
const row = (c) =>
  `((select id from call_campaigns where slug = ${q(SLUG)}), ${q(c.source_key)}, ${q(c.full_name)}, ${q(c.role)}, ${q(c.org_name)}, ${q(c.phone)}, ${q(c.email)}, ${q(c.linkedin)}, ${c.buildings_count}, ${q(JSON.stringify(c.buildings))}::jsonb, ${c.best_rank ?? "null"}, ${q("FISP UNSAFE universe, 1,838 buildings")}, false)`;

// `do update` on buildings only — never on phone/email/linkedin/dnc/callback,
// which are a rep's to change and this file's to leave alone.
const CONFLICT = `on conflict (call_campaign_id, source_key) do update set
  buildings = excluded.buildings,
  buildings_count = excluded.buildings_count,
  best_rank = excluded.best_rank,
  org_name = coalesce(call_contacts.org_name, excluded.org_name),
  phone = coalesce(call_contacts.phone, excluded.phone),
  email = coalesce(call_contacts.email, excluded.email),
  linkedin = coalesce(call_contacts.linkedin, excluded.linkedin),
  updated_at = now()`;
const HEAD = `insert into call_contacts (call_campaign_id, source_key, full_name, role, org_name, phone, email, linkedin, buildings_count, buildings, best_rank, contact_source, dnc)
values`;

if (EMIT) {
  await mkdir(EMIT, { recursive: true });
  const CHUNK = 22;
  for (let i = 0; i < contacts.length; i += CHUNK) {
    await writeFile(`${EMIT}/${String(i / CHUNK + 1).padStart(3, "0")}.sql`,
      `${HEAD}\n${contacts.slice(i, i + CHUNK).map(row).join(",\n")}\n${CONFLICT};`);
  }
  console.log(`Wrote ${Math.ceil(contacts.length / CHUNK)} SQL files to ${EMIT}.`);
  process.exit(0);
}

if (!WRITE) { console.log("Pass --write (needs SUPABASE_SERVICE_ROLE_KEY) or --emit=<dir>."); process.exit(0); }
if (!SERVICE) { console.error("SUPABASE_SERVICE_ROLE_KEY is required to write."); process.exit(1); }

let done = 0;
for (let i = 0; i < contacts.length; i += 500) {
  const chunk = contacts.slice(i, i + 500).map((c) => ({
    call_campaign_id: unsafeId, source_key: c.source_key, full_name: c.full_name,
    role: c.role, org_name: c.org_name, phone: c.phone, email: c.email, linkedin: c.linkedin,
    buildings_count: c.buildings_count, buildings: c.buildings, best_rank: c.best_rank,
    contact_source: "FISP UNSAFE universe, 1,838 buildings",
  }));
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/call_contacts?on_conflict=call_campaign_id,source_key`,
    { method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
                 "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(chunk) });
  if (!res.ok) { console.error(`chunk at ${i} failed:`, res.status, await res.text()); process.exit(1); }
  done += chunk.length;
  console.log(`  ${done}/${contacts.length}`);
}
console.log(`Upserted ${done} contacts into '${SLUG}'.`);
