import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestions } from "./ask-steps.js";

const BLOCK = `I need a few answers before I write the proposal.
Do you need me to calculate the price, or do you already have it? (Calculate it for me, I already have it) [default Calculate it for me]
What drone amount should I use for this building? (typical ~$5,300) [default $5,300]
What margin should I apply? (40%, 35%, custom) [default 40%]
What is the property name (e.g., 'Somerville Commercial Building')?`;

test("the block becomes one question at a time", () => {
  const read = parseQuestions(BLOCK);
  assert.equal(read.items.length, 4);
  assert.equal(read.intro, "I need a few answers before I write the proposal.");
  assert.deepEqual(read.items[0].options, ["Calculate it for me", "I already have it"]);
  assert.equal(read.items[0].fallback, "Calculate it for me");
  assert.deepEqual(read.items[1].options, []);
  assert.equal(read.items[1].fallback, "$5,300");
  assert.deepEqual(read.items[2].options, ["40%", "35%", "custom"]);
  assert.equal(read.items[3].question, "What is the property name (e.g., 'Somerville Commercial Building')?");
});

test("the two-question intake still becomes steps", () => {
  const read = parseQuestions(`I need a few answers before I write the proposal.
What drone amount should I use for this building? (typical ~$5,300) [default $5,300]
What margin should I apply? (40%, 35%, custom) [default 40%]`);
  assert.equal(read.items.length, 2);
  assert.deepEqual(read.items[1].options, ["40%", "35%", "custom"]);
});

test("a note and a list in the same line keep both", () => {
  const read = parseQuestions(`I need a few answers before I write the proposal.
Drone amount? (typical ~$5,300) ($4,500, $5,300, $6,000) [default $5,300]
What margin should I apply? (40%, 35%, custom) [default 40%]`);
  assert.deepEqual(read.items[0].options, ["$4,500", "$5,300", "$6,000"]);
  assert.equal(read.items[0].hint, "typical ~$5,300");
  assert.equal(read.items[0].fallback, "$5,300");
});

test("ordinary prose stays prose", () => {
  assert.equal(parseQuestions("Which replies need you today? Two of them do."), null);
  assert.equal(parseQuestions("Here is the campaign.\nIt has 810 leads."), null);
});
