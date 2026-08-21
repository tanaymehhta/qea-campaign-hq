// node scripts/test-touched.mjs — the tick, without a browser.
//
// Writes to the real inbound_companies row it names, so it picks a company off
// the table, records what was there, and puts it back.
import assert from "node:assert/strict";
import { db } from "../lib/db.js";
import { setTouch, touchOf } from "../lib/inbound/touched.js";

const read = async (id) => (await db.from("inbound_companies")
  .select("reached_out_by,reached_out_at").eq("id", id).maybeSingle()).data;

const { data: some } = await db.from("inbound_companies").select("id").limit(1);
const ID = some[0].id;
const before = await read(ID);

// Everything below writes to that real row, so the restore is in a `finally`:
// the first version of this file died on a bad assertion and left its tick
// sitting on a live company until somebody noticed.
try {
await setTouch(ID, "mark-vasu");
const one = await read(ID);
assert.equal(touchOf(one).by, "mark-vasu");
assert.ok(Date.parse(touchOf(one).at), "the tick records when");

// A name nobody routes to never reaches the database.
await assert.rejects(() => setTouch(ID, "someone-else"));
await assert.rejects(() => setTouch(null, "mark-vasu"));
// A blank never gets past the rep check either — but the database refuses it
// on its own too, which is the half that matters: a hostile POST skips this
// file entirely and meets the same rule.
await assert.rejects(() => setTouch(ID, "   "));
const blank = await db.rpc("inbound_set_reached_out", { p_company: ID, p_by: "   " });
assert.match(blank.error?.message ?? "", /name we can record/);
const nobody = await db.rpc("inbound_set_reached_out", {
  p_company: "00000000-0000-0000-0000-000000000000", p_by: "mark-vasu" });
assert.match(nobody.error?.message ?? "", /no such company/);

// Ticking again is the last word, not a second row.
await setTouch(ID, "justin-kim");
assert.equal(touchOf(await read(ID)).by, "justin-kim");

await setTouch(ID, null);
const gone = await read(ID);
assert.equal(touchOf(gone), null, "unticking leaves nothing behind");
assert.equal(gone.reached_out_at, null, "and takes the timestamp with it");

} finally {
  await setTouch(ID, before?.reached_out_by ?? null);
}
console.log("touched.js ok");
