/**
 * node scripts/test-window.mjs
 *
 * `dateWindow` decides which runs a reader is allowed to see. The failure that
 * matters is silent: a window one day short still renders a full page of rows,
 * and nothing on screen says the last day is missing.
 */
import assert from "node:assert/strict";
import { dateWindow } from "../lib/pipeline.js";

const day = (iso) => new Date(iso).getTime();

// A preset is days back from now, open-ended at the top.
{
  const w = dateWindow({ range: "1" });
  assert.equal(w.custom, false);
  assert.equal(w.end, null);
  const hours = (Date.now() - day(w.start)) / 3.6e6;
  assert.ok(Math.abs(hours - 24) < 0.01, `24h preset spans ${hours}h`);
}

// "All" filters nothing.
{
  const w = dateWindow({ range: "all" });
  assert.equal(w.start, null);
  assert.equal(w.end, null);
}

// The whole point: the end date is included, so the bound is the next midnight.
// A run at 14:00 on the 19th is inside a window ending on the 19th.
{
  const w = dateWindow({ from: "2026-08-17", to: "2026-08-19" });
  assert.equal(w.custom, true);
  assert.equal(w.start, "2026-08-17T00:00:00.000Z");
  assert.equal(w.end, "2026-08-20T00:00:00.000Z", "17th, 18th and 19th, all three");
  assert.ok(day("2026-08-19T14:00:00Z") < day(w.end), "the end date is included");
}

// UTC days, not the box's days. This test passes in EDT and in UTC or it is not
// testing the thing that made it worth writing.
assert.equal(dateWindow({ from: "2026-08-17" }).start, "2026-08-17T00:00:00.000Z");

// One end is enough. "Everything since the 17th", "everything up to the 17th".
assert.equal(dateWindow({ from: "2026-08-17" }).end, null);
assert.equal(dateWindow({ to: "2026-08-17" }).start, null);

// A picked date beats a preset — that is why the presets stay one click.
assert.equal(dateWindow({ range: "30", from: "2026-08-17" }).custom, true);

// Junk in the query string falls back to the preset rather than throwing or,
// worse, producing an Invalid Date the query would send to Postgres verbatim.
for (const junk of ["", "yesterday", "2026-8-1", "'; drop table", "2026-08-17T00:00:00Z"]) {
  const w = dateWindow({ range: "7", from: junk, to: junk });
  assert.equal(w.custom, false, `rejected: ${junk}`);
  assert.ok(!Number.isNaN(day(w.start)));
}

console.log("ok — date windows");
