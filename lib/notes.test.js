import assert from "node:assert/strict";
import test from "node:test";
import { mergeNotes, NOTES_CAP } from "./notes.js";

test("a note appends under the cap", () => {
  const saved = mergeNotes("CC me.", "Short briefs.");
  assert.equal(saved.ok, true);
  assert.equal(saved.person_notes, "CC me.\nShort briefs.");
});

test("past the cap, nothing is saved", () => {
  const saved = mergeNotes("x".repeat(NOTES_CAP - 5), "too long");
  assert.equal(saved.ok, false);
  assert.match(saved.error, /Nothing was saved/);
});
