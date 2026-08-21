#!/usr/bin/env node
/**
 * Import Campaign 01 — the Manhattan UNSAFE pilot — into call_campaigns +
 * call_contacts, as a second list beside `nyc-ll11-safe`.
 *
 * Why this is a second script and not a flag on import_call_list.mjs: the two
 * sources share no tab, no column name and no grain. Campaign 02 ships one
 * ranked row per building with the people inline; Campaign 01's person list
 * was flattened by hand in July into the outreach plan's Contacts tab, and
 * the buildings have to be joined back onto it from two different directions.
 * The write is the same shape either way, and that half is 30 lines.
 *
 * ONE ROW IS ONE PERSON. 127 buildings, 173 people (78 engineers, 95
 * owner-side). Names are unique in the source, so the person is the key.
 *
 * WHAT IT DOES NOT IMPORT: the plan's tracking columns — `Call 1`, `Replied?`,
 * `Meeting?`, `Last_Contacted`. All four are empty in the file, and they are
 * empty because calling moved into this app on 16 Jul and the spreadsheet was
 * last written on the 13th. Nine of these people have since been dialled and
 * those calls live in `phone_calls`. Copying the columns would write blanks
 * over the only record that exists.
 *
 * Usage:
 *   node scripts/import_unsafe_list.mjs --dry-run     # parse + reconcile, no SQL
 *   node scripts/import_unsafe_list.mjs --emit=<dir>  # write the upsert as SQL
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import XLSX from "xlsx";

const PLAN = "data/Campaign01_Outreach_Plan.xlsx";
const DATA = "data/Campaign01_Manhattan_UNSAFE_127.xlsx";
const SLUG = "nyc-ll11-unsafe";
const OWNER = "Mark Vasu";
const DRY = process.argv.includes("--dry-run");
const EMIT = process.argv.find((a) => a.startsWith("--emit="))?.slice(7);

// ---------------------------------------------------------------- helpers

const norm = (s) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** A licence holder is filed with their credential and sometimes a suffix:
 *  "JUSTIN  GEORGES, RA" and "JOHN  COCCA JR." are the men the directory tabs
 *  call "Justin Georges" and "John Cocca". Strip both to get a person key. */
const person = (s) =>
  norm(String(s ?? "")
    .replace(/,?\s*(JR|SR|III|II)\.?$/i, "")
    .replace(/,\s*(RA|PE|AIA|R\.A\.|P\.E\.)\.?$/i, ""));

const val = (s) => {
  const v = typeof s === "string" ? s.trim() : s;
  return v === "" || v == null ? null : String(v);
};

const sheet = (wb, name) => {
  if (!wb.SheetNames.includes(name)) throw new Error(`missing tab: ${name}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
};

// ---------------------------------------------------------------- parse

const plan = XLSX.readFile(PLAN);
const data = XLSX.readFile(DATA);

const roster = sheet(plan, "Contacts");
// Pilot_127 carries a two-row header — a merged band ("PAIN / URGENCY") over
// the real column names. The second row is the one to read.
const pilot = XLSX.utils.sheet_to_json(data.Sheets["Pilot_127"], { range: 1, defval: null });
const byOwn = sheet(data, "By_Owner");

const buildingOf = new Map(pilot.map((r) => [String(r.BIN), r]));

/** Buildings by the engineer who signed the filing. Keyed on QEWI_Name, the
 *  licence holder — which is how By_Engineer was built, so the counts here
 *  reconcile to the plan's `Bldgs`. QEWI_Contact_Name (the human Apollo found
 *  behind the licence) is a fallback only: using both as equals merges
 *  "Alan Epstein" with "Alan S Epstein" and double-counts a building across
 *  two rows that are both on the roster. */
const byLicence = new Map();
const byHuman = new Map();
for (const r of pilot) {
  const add = (m, k) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(String(r.BIN));
  };
  add(byLicence, person(r.QEWI_Name));
  add(byHuman, person(r.QEWI_Contact_Name));
}

/** Buildings by owner-side person. The roster's "Entities (owners)" column is
 *  a comma-joined string and the entity names contain commas — "133 WEST LLC,
 *  25 COOPER, LLC" is two entities, not three — so it cannot be split back
 *  apart. By_Owner is the join instead: it holds the entity's BINs and the
 *  three ways a human is attached to it. */
const byOwnerPerson = new Map();
for (const r of byOwn) {
  const bins = String(r.BINs ?? "").split(/[,\s]+/).filter(Boolean).filter((b) => buildingOf.has(b));
  for (const who of [r.Owner_Contact_Name, r.HPD_HeadOfficer, r.HPD_Managing_Agent]) {
    const k = person(who);
    if (!k) continue;
    if (!byOwnerPerson.has(k)) byOwnerPerson.set(k, new Set());
    for (const b of bins) byOwnerPerson.get(k).add(b);
  }
}

/** The building, as the call panel needs it. `rank` is the pilot priority (1 =
 *  most urgent). Two urgency facts travel with it because they are the reason
 *  for the call: the unpaid ECB balance, and how many days past the 90-day
 *  repair deadline the filing is (0 = the clock is still running).
 *
 *  `open_permit_flag` is not carried: it is 0 on all 127 — "nobody has hired a
 *  contractor yet" is one of the three conditions that put a building on this
 *  list, so a column of zeroes would say nothing per row. The filing date is
 *  not carried either; `overdue` is the same fact in the form the rep needs. */
const building = (bin) => {
  const r = buildingOf.get(bin);
  const days = Number(r.Days_Into_90);
  return {
    bin,
    address: val(r.Address),
    borough: val(r.Borough),
    rank: r.Priority,
    score: r.Urgency_Score,
    ecb: r.ecb_balance_due ?? 0,
    overdue: Number.isFinite(days) ? Math.max(0, days - 90) : null,
  };
};

let noBuildings = 0;
const contacts = roster.map((row) => {
  const name = String(row.Name).trim().replace(/\s+/g, " ");
  const role = row.Type === "Engineer" ? "engineer" : "owner";
  const key = person(name);

  let bins;
  if (role === "engineer") bins = byLicence.get(key) ?? byHuman.get(key) ?? [];
  else bins = [...(byOwnerPerson.get(key) ?? [])];

  const buildings = [...new Set(bins)].map(building).sort((a, b) => a.rank - b.rank);
  if (!buildings.length) noBuildings++;

  return {
    source_key: `${role}:${key}`,
    full_name: name,
    role,
    org_name: val(row.Firm),
    license_no: null,
    phone: val(row.Phone),
    email: val(row.Email),
    linkedin: val(row["LinkedIn URL"]),
    city: null, state: null, zip: null,
    buildings,
    buildings_count: buildings.length,
    best_rank: buildings.length ? buildings[0].rank : null,
    contact_source: "Campaign 01 outreach plan, 13 Jul 2026",
    dnc: false,
    dnc_reason: null,
    expected: row.Bldgs,
  };
});

// ---------------------------------------------------------------- reconcile

const engineers = contacts.filter((c) => c.role === "engineer");
const owners = contacts.filter((c) => c.role === "owner");
const withPhone = contacts.filter((c) => c.phone).length;
const withEmail = contacts.filter((c) => c.email).length;
const dialable = contacts.filter((c) => c.phone || c.email).length;
const wrongCount = contacts.filter((c) => c.buildings_count !== c.expected);
const covered = new Set(contacts.flatMap((c) => c.buildings.map((b) => b.bin))).size;
const dupes = contacts.length - new Set(contacts.map((c) => c.source_key)).size;

console.log(`
== Reconciliation — ${PLAN} + ${DATA} ==
Rows read:            Contacts ${roster.length} · Pilot_127 ${pilot.length} · By_Owner ${byOwn.length}
Contacts to load:     ${contacts.length}  (${engineers.length} engineers, ${owners.length} owner-side)
Contacts with phone:  ${withPhone}
Contacts with email:  ${withEmail}
Dialable (phone or email): ${dialable}
No channel at all:    ${contacts.length - dialable}
Buildings covered:    ${covered} of ${pilot.length} in the pilot
People with no building joined: ${noBuildings}
Building count disagrees with the plan: ${wrongCount.length}
Duplicate source_keys: ${dupes}
`);
for (const c of wrongCount) console.error(`  MISMATCH ${c.role} ${c.full_name}: joined ${c.buildings_count}, plan says ${c.expected}`);

// The README and the plan both state these. If we don't land on them the join
// is wrong and a rep would read a wrong building list off the panel.
const expect = [
  ["contacts", contacts.length, 173],
  ["engineers", engineers.length, 78],
  ["owner-side", owners.length, 95],
  ["with phone", withPhone, 114],
  ["with email", withEmail, 97],
  ["buildings covered", covered, 127],
  ["building-count mismatches", wrongCount.length, 0],
  ["duplicate keys", dupes, 0],
];
let bad = false;
for (const [what, got, want] of expect) {
  if (got !== want) { bad = true; console.error(`MISMATCH: ${what} = ${got}, source says ${want}`); }
}
if (bad) { console.error("Does not reconcile to the source. Not proceeding."); process.exit(1); }
console.log("Reconciles to the source plan. ✓");

/**
 * --fingerprint prints an md5 over every field this script would write, in a
 * line format Postgres can rebuild from the rows it actually holds. The two
 * agreeing is the proof that what landed in the table is what the spreadsheet
 * says — the import was applied as hand-pasted SQL, so "it ran without an
 * error" is not the same as "every BIN survived". The matching query is in
 * CALL_LOGS §9.
 */
if (process.argv.includes("--fingerprint")) {
  const line = (c) =>
    [c.source_key, c.full_name, c.role, c.org_name ?? "", c.phone ?? "", c.email ?? "",
     c.linkedin ?? "", c.buildings_count, c.best_rank ?? "",
     c.buildings.map((b) => [b.bin, b.address, b.borough, b.rank, b.score, b.ecb, b.overdue].join(":")).join(","),
    ].join("|");
  const body = contacts.map(line).sort().join("\n");
  console.log(createHash("md5").update(body).digest("hex"), contacts.length);
  process.exit(0);
}

if (DRY || !EMIT) {
  console.log(DRY ? "Dry run — nothing written." : "No --emit=<dir> given — nothing written.");
  process.exit(0);
}

// ---------------------------------------------------------------- emit

const q = (v) => (v == null ? "null" : `$q$${String(v)}$q$`);
const md = await readFile("data/campaign01_summary.md", "utf8").catch(() => null);

await mkdir(EMIT, { recursive: true });
await writeFile(`${EMIT}/000_campaign.sql`, `insert into call_campaigns (slug, display_name, description, objective, owner, source_file, status${md ? ", summary_md" : ""})
values (${q(SLUG)}, ${q("NYC LL11 — UNSAFE / Manhattan pilot")},
  ${q("127 Manhattan buildings filed UNSAFE under FISP with an unpaid ECB balance and no repair permit — a 90-day legal deadline, and 107 of them are already past it. Compliance-forced retrofit, not an energy pitch.")},
  ${q("Reach the owner through the engineer who filed the building UNSAFE: one call to Koenigsberg covers 11 buildings.")},
  ${q(OWNER)}, ${q(PLAN)}, 'active'${md ? `, ${q(md)}` : ""})
on conflict (slug) do update set
  display_name = excluded.display_name, description = excluded.description,
  objective = excluded.objective, owner = excluded.owner,
  source_file = excluded.source_file${md ? ", summary_md = excluded.summary_md" : ""};`);

// `do nothing` on the contacts, not `do update`: a re-run must never overwrite
// a phone a rep corrected mid-call, or un-retire someone they marked
// do-not-call. Same contract as the SAFE import.
const CHUNK = 22;
for (let i = 0; i < contacts.length; i += CHUNK) {
  const values = contacts.slice(i, i + CHUNK).map((c) =>
    `((select id from call_campaigns where slug = ${q(SLUG)}), ${q(c.source_key)}, ${q(c.full_name)}, ${q(c.role)}, ${q(c.org_name)}, ${q(c.phone)}, ${q(c.email)}, ${q(c.linkedin)}, ${c.buildings_count}, ${q(JSON.stringify(c.buildings))}::jsonb, ${c.best_rank ?? "null"}, ${q(c.contact_source)}, false)`
  ).join(",\n");
  await writeFile(`${EMIT}/${String(i / CHUNK + 1).padStart(3, "0")}_contacts.sql`,
    `insert into call_contacts (call_campaign_id, source_key, full_name, role, org_name, phone, email, linkedin, buildings_count, buildings, best_rank, contact_source, dnc)
values\n${values}\non conflict (call_campaign_id, source_key) do nothing;`);
}
console.log(`Wrote ${Math.ceil(contacts.length / CHUNK) + 1} SQL files to ${EMIT}.`);
