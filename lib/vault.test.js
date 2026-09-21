import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import {
  canonicalPath, excerptForSubject, listCanonical, readPage, tierFor,
} from "./vault.js";

const pages = [
  { path: "wiki/company/qea-overview.md", tier: "LIVE" },
  { path: "wiki/market/beudo-compliance.md", tier: "REFERENCE" },
];

test("tiers follow schema.md and leave the rest unlisted", () => {
  assert.equal(tierFor("wiki/gtm/lessons-learned.md"), "LIVE");
  assert.equal(tierFor("wiki/market/beudo-compliance.md"), "REFERENCE");
  assert.equal(tierFor("wiki/company/team.md"), "UNLISTED");
});

test("a path has to be one published page", () => {
  assert.equal(canonicalPath("../wiki/company/qea-overview.md", pages), null);
  assert.equal(canonicalPath("sources/secret.md", pages), null);
  assert.equal(canonicalPath("wiki/gtm/notes.md.bak-1", pages), null);
  assert.equal(canonicalPath("wiki/company/qea-overview.md", pages)?.tier, "LIVE");
});

test("canonical files skip bak names and sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  fs.mkdirSync(path.join(root, "wiki/gtm"), { recursive: true });
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki/sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "wiki/gtm/lessons-learned.md"), "# Lessons\n");
  fs.writeFileSync(path.join(root, "wiki/gtm/lessons-learned.md.bak-1"), "# old\n");
  fs.writeFileSync(path.join(root, "sources/raw.md"), "# raw\n");
  fs.writeFileSync(path.join(root, "wiki/sources/secret.md"), "# no\n");
  fs.writeFileSync(path.join(root, "log.md"), "# log\n");
  assert.deepEqual(listCanonical(root).map((file) => file.path), ["wiki/gtm/lessons-learned.md"]);
});

test("a small page is whole, and a reference page is stamped", () => {
  const live = readPage("# QEA\n\nFlies drones.", {
    path: "wiki/company/qea-overview.md", tier: "LIVE",
  });
  assert.match(live.text, /Flies drones/);
  assert.doesNotMatch(live.text, /DO NOT QUOTE/);

  const old = readPage("# BEUDO\n\nBoston ordinance.", {
    path: "wiki/market/beudo-compliance.md", tier: "REFERENCE",
  });
  assert.match(old.text, /DO NOT QUOTE AS CURRENT/);
  assert.match(old.text, /Boston ordinance/);
});

test("a large page returns one section, and narrative counts lose to HQ", () => {
  const body = `# Campaigns\n\nintro that should not leak\n\n## Alpha\n\nalpha only\n\n## Beta\n\n${"beta ".repeat(4000)}`;
  const headings = readPage(body, { path: "wiki/ops/active-campaigns.md", tier: "LIVE" });
  assert.match(headings.text, /Name a section/);
  assert.match(headings.text, /HQ wins/);
  assert.doesNotMatch(headings.text, /alpha only/);

  const beta = readPage(body, {
    path: "wiki/ops/active-campaigns.md", tier: "LIVE", section: "Beta",
  });
  assert.match(beta.text, /beta beta/);
  assert.match(beta.text, /truncated/);
  assert.doesNotMatch(beta.text, /alpha only/);
});

test("an excerpt is the smallest heading that names the subject", () => {
  const markdown = "# All\n\n## Other\n\nnothing here\n\n## Clinic\n\nCleveland Clinic owns the pavilion.\n\n### Wing\n\nCleveland Clinic wing A.";
  const hit = excerptForSubject(markdown, "Cleveland Clinic");
  assert.equal(hit.heading, "Wing");
  assert.match(hit.text, /wing A/);
});
