import assert from "node:assert/strict";
import test from "node:test";
import { campaignsForRep } from "./hq-read.js";

test("two reps do not receive each other's groups", async () => {
  const dolan = await campaignsForRep("Mark Dolan");
  const vasu = await campaignsForRep("Mark Vasu");
  const tanay = await campaignsForRep("Tanay", "tanay@qeatech.com");
  assert.ok(dolan.groups.length > 0);
  assert.ok(vasu.groups.length > 0);
  assert.ok(dolan.groups.every((group) => group.owner === "Mark Dolan"));
  assert.ok(vasu.groups.every((group) => group.owner === "Mark Vasu"));
  const dolanNames = new Set(dolan.groups.map((group) => group.display_name));
  assert.ok(vasu.groups.every((group) => !dolanNames.has(group.display_name)));
  assert.ok(tanay.groups.some((group) => group.owner === "Mark Dolan"));
  assert.ok(tanay.groups.some((group) => group.owner === "Mark Vasu"));
  assert.ok(tanay.groups.length >= dolan.groups.length + vasu.groups.length);
});
