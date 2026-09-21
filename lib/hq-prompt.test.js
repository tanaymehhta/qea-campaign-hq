import assert from "node:assert/strict";
import test from "node:test";
import { instructionsFor } from "./hq-prompt.js";

test("the prompt carries this person's note and not a stand-in", () => {
  const text = instructionsFor({
    displayName: "Mark Vasu",
    email: "mark.vasu@qeatech.com",
    repName: "Mark Vasu",
    personNotes: "CC me on briefs.",
  });
  assert.match(text, /mark\.vasu@qeatech\.com/);
  assert.match(text, /CC me on briefs/);
  assert.doesNotMatch(text, /Mark Dolan/);
});

test("an empty note is said out loud", () => {
  const text = instructionsFor({
    displayName: "Justin",
    email: "justin@qeatech.com",
    repName: "Justin",
    personNotes: "  ",
  });
  assert.match(text, /have not asked you to remember anything/);
  assert.match(text, /HQ wins/);
  assert.match(text, /published vault copy is missing/);
});
