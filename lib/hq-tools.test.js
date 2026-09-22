import assert from "node:assert/strict";
import test from "node:test";
import { namedByUser, proposalRoute } from "./hq-tools.js";

test("the bare chip asks instead of refusing", () => {
  assert.deepEqual(proposalRoute("Create a proposal", false), { to: "model" });
});

test("the chip that names both goes straight to the agent", () => {
  const turn = proposalRoute("create a proposal for Bob Jones at 444 Somerville Ave", false);
  assert.equal(turn.to, "service");
  assert.equal(turn.fresh, true);
});

test("a name given two turns ago is still a name the rep gave", () => {
  const thread = "Create a proposal\nBob\n444 somerville avenue";
  assert.equal(namedByUser("444 somerville avenue", "Bob"), false);
  assert.equal(namedByUser(thread, "Bob"), true);
  assert.equal(namedByUser(thread, "444 somerville avenue"), true);
});

test("a client the rep never typed is still refused", () => {
  assert.equal(namedByUser("Create a proposal\nBob", "Northstar Realty"), false);
});
