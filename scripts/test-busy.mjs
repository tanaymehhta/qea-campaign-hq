/**
 * node scripts/test-busy.mjs
 *
 * `busyOf` decides whether a company's Restart button is offered. The database
 * function behind that button, `inbound_request_rerun`, decides the same thing
 * from its own rules. When the two disagree the disagreement is not symmetric:
 * a button offered too eagerly returns an error a rep can read, and a button
 * withheld leaves no route at all. These cases pin them together.
 */
import assert from "node:assert/strict";
import { busyOf } from "../lib/inbound/queue.js";

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000, HOUR = 60 * MIN;

// A run that started a minute ago is live on both sides.
assert.equal(busyOf([{ status: "running", started_at: ago(MIN), stage_no: 2 }])?.phase, "running");

// A run still marked `running` three hours later is a crash. Nothing marks a
// run finished, so this row survives forever — and the SQL guard stopped
// believing it at two hours. The button must come back.
assert.equal(busyOf([{ status: "running", started_at: ago(3 * HOUR), stage_no: 2 }]), null,
  "a run running for 3 hours still blocks the button the database would allow");

// Right at the boundary, on the live side of it.
assert.equal(busyOf([{ status: "running", started_at: ago(2 * HOUR - MIN) }])?.phase, "running");

// A row with no start time cannot be shown to be live, and must not be treated
// as live forever on the strength of its status alone.
assert.equal(busyOf([{ status: "running", started_at: null }]), null);

// The first twenty seconds: GitHub is booting and no run row exists yet. The
// request row is the only evidence, and it says "starting".
assert.equal(busyOf([], { stage: 1, requested_at: ago(30 * 1000) })?.phase, "starting");

// A dispatch that died leaves the request row behind for good. Ten minutes is
// where it stops meaning anything.
assert.equal(busyOf([], { stage: 1, requested_at: ago(20 * MIN) }), null);

// A run that has written something since the press is reporting on itself now;
// the request has done its job and must not be a second source for one fact.
assert.equal(
  busyOf([{ status: "ok", started_at: ago(MIN) }], { stage: 1, requested_at: ago(2 * MIN) }),
  null);

// A crashed run and a fresh press together: the press is what is true.
assert.equal(
  busyOf([{ status: "running", started_at: ago(5 * HOUR) }], { stage: 2, requested_at: ago(MIN) })?.phase,
  "starting");

console.log("ok — busyOf agrees with the 2-hour guard in inbound_request_rerun");
