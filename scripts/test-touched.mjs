// node scripts/test-touched.mjs — the tick, without a browser.
// Writes .touched.json in the repo root, same file the pages read.
import assert from "node:assert/strict";
import { loadTouches, setTouch } from "../lib/inbound/touched.js";

const ID = "00000000-0000-0000-0000-000000000001";

await setTouch(ID, "mark-vasu");
const one = await loadTouches();
assert.equal(one[ID].by, "mark-vasu");
assert.ok(Date.parse(one[ID].at), "the tick records when");

// A name nobody routes to is refused rather than saved as a blank initial.
await assert.rejects(() => setTouch(ID, "someone-else"));
await assert.rejects(() => setTouch(null, "mark-vasu"));

// Ticking again is the last word, not a second row.
await setTouch(ID, "justin-kim");
assert.equal((await loadTouches())[ID].by, "justin-kim");

await setTouch(ID, null);
assert.equal((await loadTouches())[ID], undefined, "unticking leaves nothing behind");

console.log("touched.js ok");
