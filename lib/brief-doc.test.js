import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBrief } from "./brief-doc.js";

test("a brief keeps the excerpt and drops em dashes", async () => {
  const buf = await buildBrief({
    subject: "Cleveland Clinic",
    hits: [{
      path: "wiki/ops/meeting-notes.md",
      tier: "LIVE",
      heading: "Clinic",
      text: "Cleveland Clinic owns the pavilion \u2014 check the wing.",
    }],
  });
  const file = path.join(os.tmpdir(), `brief-${process.pid}.docx`);
  fs.writeFileSync(file, buf);
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
  assert.equal(xml.includes("\u2014"), false);
  assert.equal(xml.includes("\u2013"), false);
  assert.match(xml, /Cleveland Clinic/);
  assert.match(xml, /QEA ANGLE/);
  assert.match(xml, /Reported from wiki\/ops\/meeting-notes.md/);
  assert.match(xml, /Live campaign counts are not copied/);
});
