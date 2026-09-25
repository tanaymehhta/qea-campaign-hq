import assert from "node:assert/strict";
import test from "node:test";
import { addInto, EMPTY, meetingArgs, num, pct, reachedArgs, shift, today, windowFrom } from "./db.js";

test("a window of N days holds N days, ending today", () => {
  const t = today();
  for (const [range, days] of [["today", 1], ["2", 2], ["7", 7], ["30", 30], ["90", 90]]) {
    const w = windowFrom({ range });
    assert.equal(w.to, t);
    assert.equal(w.from, shift(t, 1 - days), `range=${range}`);
  }
  assert.deepEqual(windowFrom({ d: "2026-08-04" }).from, "2026-08-04");
  assert.equal(windowFrom({}).range, "all");
});

test("an unknown is not a zero", () => {
  const acc = addInto({ ...EMPTY }, { sent: 5, bounced: null });
  addInto(acc, { sent: 2 }); // a key the row never had
  addInto(acc, { bounced: 1 });
  assert.equal(acc.sent, 7);
  assert.equal(acc.bounced, 1);
  assert.equal(num(null), "—");
  assert.equal(num(0), "0");
  assert.equal(pct(1, 0), null);
  assert.equal(pct(1, 3), 33.3);
});

test("rep=all means no rep filter, and empty scopes mean no scope", () => {
  assert.equal(reachedArgs({ rep: "all" }).p_rep, null);
  assert.equal(reachedArgs({ rep: "Mark Vasu" }).p_rep, "Mark Vasu");
  const m = meetingArgs({ campaignIds: [], groupIds: [], rep: "all" });
  assert.deepEqual([m.p_campaigns, m.p_groups, m.p_rep, m.p_status], [null, null, null, "counted"]);
});
