import assert from "node:assert/strict";
import test from "node:test";
import { calls, conflicts, hubspot, meetings, replies, scopeOf } from "./hq-data.js";

// Live data. Mark Vasu owns both call lists and every call; the Roof conflicts
// and replies are Mark Dolan's. Justin must see none of either.
test("a rep's tools return only that rep's rows", async () => {
  const justin = await scopeOf("justin@qeatech.com", "Justin");
  const dolan = await scopeOf("mark@qeatech.com", "Mark Dolan");
  const tanay = await scopeOf("tanay@qeatech.com", "Tanay");

  assert.equal((await calls(justin)).calls_logged, 0);
  assert.equal((await calls(dolan)).callbacks_due.length, 0);
  assert.ok((await calls(tanay)).calls_logged > 0);

  assert.ok((await meetings(justin)).meetings.every((m) => m.rep === "Justin"));
  // hubspot_pushes has no read policy; it needs the service key (in .env.local, not in `npm test`).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    assert.ok((await hubspot(dolan)).pushes.every((p) => p.owner === "Mark Dolan"));
  }
  assert.equal((await conflicts(justin)).open, 0);
  assert.ok((await conflicts(tanay)).open >= (await conflicts(dolan)).open);

  const dolanReplies = new Set((await replies(dolan, { pile: "all" })).people.map((p) => p.email));
  assert.ok((await replies(justin, { pile: "all" })).people.every((p) => !dolanReplies.has(p.email)));
});

test("a rep with nothing owns nothing, not everything", async () => {
  const nobody = await scopeOf("nobody@qeatech.com", "Nobody");
  assert.equal((await replies(nobody)).people.length, 0);
  assert.equal((await meetings(nobody)).meetings.length, 0);
  assert.equal((await calls(nobody)).calls_logged, 0);
  assert.equal((await conflicts(nobody)).open, 0);
});
