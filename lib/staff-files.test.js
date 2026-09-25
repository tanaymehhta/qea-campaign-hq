import assert from "node:assert/strict";
import test from "node:test";
import { readStaffFile, safeFilename } from "./staff-files.js";

// The name goes into a Content-Disposition header; the storage path is a uuid.
test("a download name cannot break its header or name a folder", () => {
  assert.doesNotMatch(safeFilename('x"\r\nSet-Cookie: a=b/../../y.docx'), /["\r\n\/ :;=]/);
  assert.equal(safeFilename("Acme Brief (v2).docx"), "Acme_Brief_v2_.docx");
  assert.equal(safeFilename(""), "download.docx");
  assert.equal(safeFilename("a".repeat(200)).length, 80);
});

test("a file id that is not a uuid is refused before storage is asked", async () => {
  // No service key in the test environment: reaching storage would throw.
  assert.equal(await readStaffFile("rep@qea.com", "../other@qea.com/x"), null);
});
