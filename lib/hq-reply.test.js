import assert from "node:assert/strict";
import test from "node:test";
import { assistantText } from "./hq-reply.js";
import { forcedCall, namedByUser } from "./hq-tools.js";

test("a chip with no subject does not keep an invented document", () => {
  const text = assistantText({
    userText: "Create a proposal",
    resultText: "Here is a proposal for a hospital at $40,000.",
    outputs: [{ refused: true, message: "A proposal needs a client and an address you named. I will not invent either, and no file was written." }],
  });
  assert.match(text, /no file was written/i);
  assert.doesNotMatch(text, /\$40,000/);
});

test("campaign text is the HQ rows, and a draft file stays a draft", () => {
  const text = assistantText({
    userText: "Research a campaign",
    resultText: "Mark Dolan has 810 leads.",
    outputs: [{ campaigns: { rep_name: "Tanay", groups: [] } }],
  });
  assert.match(text, /Tanay has no campaign groups/);
  assert.doesNotMatch(text, /810/);

  const draft = assistantText({
    userText: "Create a proposal for Ada at 1 Main St",
    resultText: "Sent to the client.",
    outputs: [{
      file: { id: "11111111-1111-1111-1111-111111111111", filename: "QEA-Q.docx", draft: true },
      message: "Draft only. It is not final until you mark it final. Nothing was sent.",
    }],
  });
  assert.match(draft, /Nothing was sent/);
  assert.match(draft, /\[draft-proposal\]/);
  assert.doesNotMatch(draft, /Sent to the client/);

  const priced = assistantText({
    userText: "Create a proposal for Ada at 1 Main St",
    resultText: "",
    outputs: [{ draftText: true, message: "Draft only. It is not final, and nothing was sent.\n\nPrice 17130." }],
  });
  assert.match(priced, /\[draft-proposal\]/);
  assert.match(priced, /nothing was sent/i);
});

test("a chip sentence picks its tool and does not invent the subject", () => {
  assert.equal(forcedCall("Create a meeting brief").input.subject, "");
  assert.equal(forcedCall("Create a meeting brief for Cleveland Clinic").input.subject, "Cleveland Clinic");
  assert.equal(forcedCall("Create a proposal").input.client, "");
  assert.equal(forcedCall("Create a proposal for Ada at 1 Main St").input.address, "1 Main St");
  assert.equal(forcedCall("What is the capital of France?"), null);
});

test("a chip word is not a subject", () => {
  assert.equal(namedByUser("Create a meeting brief", "proposal"), false);
  assert.equal(namedByUser("Create a meeting brief for Cleveland Clinic", "Cleveland Clinic"), true);
});
