import fs from "fs";
import path from "path";

/** schema.md tiers, matched on the page file name. Anything else is UNLISTED. */
const LIVE = new Set([
  "lessons-learned", "geography-triggers", "active-campaigns", "prospect-pipeline",
  "source-files", "meeting-notes", "email-sequences", "outreach-workflows",
  "data-sources", "tooling-stack", "scoring-and-tiers", "ops-pain-points",
  "qea-search-reference", "icp-by-vertical", "partnerships", "pricing-model",
  "delivered-projects", "beca-methodology", "qea-overview", "claim-check",
  "competitive-landscape", "common-objections",
]);

const REFERENCE = new Set([
  "outreach-playbook", "mark-voice-profile", "finding-categories", "energy-loss-framework",
  "remediation-priorities", "target-building-profile", "beudo-compliance",
  "municipal-channel", "public-profile",
]);

export const SMALL_BYTES = 16 * 1024;
export const SECTION_CAP = 8000;

const NARRATIVE = new Set([
  "wiki/ops/active-campaigns.md",
  "wiki/gtm/prospect-pipeline.md",
]);

export function tierFor(pagePath) {
  const name = String(pagePath).split("/").pop().replace(/\.md$/, "");
  if (LIVE.has(name)) return "LIVE";
  if (REFERENCE.has(name)) return "REFERENCE";
  return "UNLISTED";
}

export function oneLine(markdown) {
  const match = String(markdown).match(/^#\s+(.+)$/m);
  const line = (match ? match[1] : "Wiki page").replace(/\s+/g, " ").trim();
  return line.slice(0, 140);
}

/** Wiki markdown only. Skips sources/ and any .bak name. Paths stay as they are on disk. */
export function listCanonical(root) {
  const wiki = path.join(root, "wiki");
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === "sources" || name.includes(".bak")) continue;
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith(".md")) {
        out.push({
          abs,
          path: path.relative(root, abs).split(path.sep).join("/"),
        });
      }
    }
  }
  walk(wiki);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function canonicalPath(pagePath, pages) {
  const cleaned = String(pagePath ?? "").trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\\")) return null;
  if (cleaned.startsWith("sources/") || cleaned.includes(".bak")) return null;
  return pages.find((page) => page.path === cleaned) ?? null;
}

function splitSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of String(markdown).split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { level: match[1].length, title: match[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function sectionBody(sections, start) {
  const opener = sections[start];
  const lines = [...opener.lines];
  for (let i = start + 1; i < sections.length; i++) {
    if (sections[i].level <= opener.level) break;
    lines.push(...sections[i].lines);
  }
  return lines.join("\n").trim();
}

function stamp(pagePath, tier) {
  const lines = [];
  if (tier === "REFERENCE" || tier === "UNLISTED") {
    lines.push(`DO NOT QUOTE AS CURRENT. This page is ${tier}.`);
  }
  if (NARRATIVE.has(pagePath)) {
    lines.push(
      "NARRATIVE ONLY. Live sent, replied, and lead counts come from hq_campaigns. If a number here disagrees with HQ, HQ wins.",
    );
  }
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

/**
 * A small page comes back whole. A large page comes back as one heading's
 * section, or as the heading list when no section was named.
 */
export function readPage(markdown, { path: pagePath, tier, section }) {
  const prefix = stamp(pagePath, tier);
  const bytes = Buffer.byteLength(markdown);
  const sections = splitSections(markdown);
  if (!section && bytes <= SMALL_BYTES) {
    return { text: prefix + markdown, whole: true, capped: false };
  }
  if (!section) {
    const titles = sections.slice(0, 80).map((s) => `${"#".repeat(s.level)} ${s.title}`);
    return {
      text: `${prefix}This page is large. Name a section.\n${titles.join("\n")}`,
      whole: false,
      capped: false,
    };
  }
  const query = section.trim().toLowerCase();
  const matches = sections
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.title.toLowerCase().includes(query));
  if (matches.length > 1) {
    const titles = matches.slice(0, 20).map(({ item }) => item.title);
    return {
      text: `${prefix}Several sections match. Pick one.\n${titles.join("\n")}`,
      whole: false,
      capped: false,
    };
  }
  if (matches.length === 1) {
    let body = sectionBody(sections, matches[0].index);
    let capped = false;
    if (body.length > SECTION_CAP) {
      body = `${body.slice(0, SECTION_CAP)}\n\n[section truncated]`;
      capped = true;
    }
    return { text: prefix + body, whole: false, capped };
  }
  const at = markdown.toLowerCase().indexOf(query);
  if (at < 0) return { text: `${prefix}No section matching ${section}.`, whole: false, capped: false };
  const start = Math.max(0, at - 200);
  return {
    text: `${prefix}${start ? "...\n" : ""}${markdown.slice(start, start + 2000)}`,
    whole: false,
    capped: true,
  };
}

/** Smallest heading whose body contains the subject. */
export function excerptForSubject(markdown, subject, cap = 1200) {
  const query = subject.trim().toLowerCase();
  if (query.length < 3) return null;
  const sections = splitSections(markdown);
  let best = null;
  for (let i = 0; i < sections.length; i++) {
    const body = sectionBody(sections, i);
    if (!body.toLowerCase().includes(query)) continue;
    if (!best || body.length < best.body.length) best = { heading: sections[i].title, body };
  }
  if (!best) return null;
  let body = best.body;
  if (body.length > cap) {
    const at = body.toLowerCase().indexOf(query);
    const start = Math.max(0, at - 300);
    body = `${start ? "...\n" : ""}${body.slice(start, start + cap)}`;
  }
  return { heading: best.heading, text: body };
}
