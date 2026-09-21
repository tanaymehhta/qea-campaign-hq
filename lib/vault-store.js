import crypto from "crypto";
import fs from "fs";
import { staffDb } from "./staff-db.js";
import {
  canonicalPath, excerptForSubject, listCanonical, oneLine, readPage, tierFor,
} from "./vault.js";

const INDEX = "wiki/_index.json";
const NARRATIVE = new Set([
  "wiki/ops/active-campaigns.md",
  "wiki/gtm/prospect-pipeline.md",
]);

function storage() {
  return staffDb().storage;
}

export async function ensureBucket(name) {
  const { error } = await storage().createBucket(name, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
}

async function putObject(objectPath, buf, contentType) {
  const bucket = storage().from("vault");
  // upsert hits a partial unique index and Postgres rejects the conflict
  // target (42P10). Insert, and replace when the object is already there.
  const first = await bucket.upload(objectPath, buf, { upsert: false, contentType });
  if (!first.error) return;
  if (!/already exists|duplicate/i.test(first.error.message)) {
    throw new Error(`${objectPath}: ${first.error.message}`);
  }
  const removed = await bucket.remove([objectPath]);
  if (removed.error) throw new Error(`${objectPath}: ${removed.error.message}`);
  const second = await bucket.upload(objectPath, buf, { upsert: false, contentType });
  if (second.error) throw new Error(`${objectPath}: ${second.error.message}`);
}

async function download(bucket, objectPath) {
  const { data, error } = await storage().from(bucket).download(objectPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function loadVaultIndex() {
  const buf = await download("vault", INDEX);
  if (!buf) return [];
  const json = JSON.parse(buf.toString("utf8"));
  return Array.isArray(json.pages) ? json.pages : [];
}

export async function readVault(pagePath, section) {
  const pages = await loadVaultIndex();
  if (!pages.length) return { ok: false, text: "The published vault copy is missing." };
  const page = canonicalPath(pagePath, pages);
  if (!page) return { ok: false, text: "That path is not a published wiki page." };
  const buf = await download("vault", page.path);
  if (!buf) return { ok: false, text: "The page is not in the published copy." };
  const read = readPage(buf.toString("utf8"), { path: page.path, tier: page.tier, section });
  return { ok: true, path: page.path, tier: page.tier, text: read.text };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/** Exact name match over the published pages. Narrative pages do not contribute counts. */
export async function searchVault(subject) {
  const pages = await loadVaultIndex();
  const needle = subject.trim().toLowerCase();
  if (needle.length < 3 || !pages.length) return [];
  const found = await pool(pages, 6, async (page) => {
    const buf = await download("vault", page.path);
    if (!buf) return null;
    const text = buf.toString("utf8");
    if (!text.toLowerCase().includes(needle)) return null;
    if (NARRATIVE.has(page.path)) {
      return {
        path: page.path,
        tier: page.tier,
        narrative: true,
        heading: "Narrative",
        text: "This name appears on a narrative page. Counts from that page are not copied. Live counts come from Campaign HQ, and HQ wins if they disagree.",
      };
    }
    const excerpt = excerptForSubject(text, subject);
    if (!excerpt) return null;
    return { path: page.path, tier: page.tier, narrative: false, heading: excerpt.heading, text: excerpt.text };
  });
  const hits = found.filter(Boolean);
  const body = hits.filter((hit) => !hit.narrative).slice(0, 3);
  const narrative = hits.filter((hit) => hit.narrative).slice(0, 1);
  return [...body, ...narrative];
}

/** Upload changed canonical wiki pages. The vault on disk stays where it is. */
export async function publishVault(root) {
  await ensureBucket("vault");
  const files = listCanonical(root);
  const previous = new Map((await loadVaultIndex()).map((page) => [page.path, page.sha256]));
  const pages = [];
  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    const buf = fs.readFileSync(file.abs);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const page = {
      path: file.path,
      tier: tierFor(file.path),
      line: oneLine(buf.toString("utf8")),
      bytes: buf.length,
      sha256,
    };
    pages.push(page);
    if (previous.get(file.path) === sha256) {
      skipped += 1;
      continue;
    }
    await putObject(file.path, buf, "text/markdown; charset=utf-8");
    uploaded += 1;
  }
  await putObject(INDEX, Buffer.from(JSON.stringify({ pages })), "application/json; charset=utf-8");
  return { uploaded, skipped, pages: pages.length };
}
