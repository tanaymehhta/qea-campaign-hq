/**
 * Who owns each domain, and which campaign each mailbox sends for.
 *
 * Transcribed from "Domains and Emails.xlsx" — the sheet the team keeps by hand
 * and treats as the source of truth for the sending estate. It is config, not
 * telemetry: it changes when someone reassigns a mailbox, not on every sync, so
 * it lives here rather than in a table nothing else writes. Keep it in step with
 * the spreadsheet; the page reads owner and campaign straight off it.
 *
 * A mailbox with no campaign here is genuinely unassigned — it exists on a
 * domain but no campaign has claimed it yet.
 */

// Domain → the person who owns it. tryqeatech.com is shared; the first name is
// the one shown, both are kept.
export const DOMAIN_OWNER = {
  "tryqeatech.com": "Mark Vasu, Justin",
  "qeatech-ai.com": "Mark Vasu",
  "qeatechone.com": "Mark Vasu",
  "qeatech1.com": "Justin",
  "qeatechgo.com": "Mark Vasu",
  "qeatechnext.com": "Gulraiz",
  "qeatechenergy.com": "Gulraiz",
  "qeatechenvelope.com": "Gulraiz",
  "qeatechretrofit.com": "Mark Dolan",
  "qeatechaudit.com": "Mark Dolan",
  "qeatechbuild.com": "Mark Dolan",
  "qeatechnologies-ai.com": "Mark Vasu",
  "qeatechnologies.com": "Mark Vasu",
  "qeatechnologiesai.com": "Mark Vasu",
  "qeatechnologiesbuild.com": "Mark Vasu",
  "qeatechnologiesgo.com": "Mark Vasu",
  "qeatechnology-ai.com": "Mark Vasu",
  "qeatechnology.com": "Mark Vasu",
  "qeatechnologyai.com": "Mark Vasu",
  "qeatechnologyaudit.com": "Mark Vasu",
  "qeatechnologybuild.com": "Mark Vasu",
  "qeatechnologygo.com": "Mark Vasu",
  "qeatechnologyone.com": "Mark Vasu",
};

// Campaign → its owner and the mailboxes it sends from. Order here is the order
// they show on the page.
export const CAMPAIGNS = [
  { name: "LBER", owner: "Mark Vasu", emails: [
    "mark.vasu@qeatech.com",
  ] },
  { name: "Reseller", owner: "Mark Vasu", emails: [
    "mark.vasu@qeatech.com", "mark@tryqeatech.com", "mark@qeatech-ai.com",
  ] },
  { name: "Chicago", owner: "Mark Vasu", emails: [
    "cmark@qeatech-ai.com", "markv@qeatech-ai.com", "mark1@qeatech-ai.com",
    "mark@qeatechone.com", "cmark@qeatechone.com", "markv@qeatechone.com",
    "mark@qeatechgo.com", "cmark@qeatechgo.com",
  ] },
  { name: "Justin Canada", owner: "Justin", emails: [
    "justin@tryqeatech.com", "justin.k@tryqeatech.com", "justin.kim@tryqeatech.com",
    "justin@qeatechone.com", "justin@qeatech1.com", "justin_kim@qeatech1.com",
    "justin.kim@qeatech1.com", "justin.k@qeatech1.com",
  ] },
  { name: "Canada Hospitals", owner: "Mark Dolan", emails: [
    "mark@qeatechretrofit.com", "markd@qeatechretrofit.com", "mark_d@qeatechretrofit.com",
    "mark@qeatechaudit.com", "markd@qeatechaudit.com", "mark_d@qeatechaudit.com",
    "mark@qeatechbuild.com", "markd@qeatechbuild.com", "mark_d@qeatechbuild.com",
    "mark_dolan@qeatechbuild.com",
  ] },
  { name: "Hospitals in America", owner: "Mark Vasu", emails: [
    "mark@qeatechnologies-ai.com", "markv@qeatechnologies-ai.com", "cmark@qeatechnologies-ai.com",
    "mark@qeatechnologies.com", "markv@qeatechnologies.com", "cmark@qeatechnologies.com",
    "mark@qeatechnologiesai.com", "markv@qeatechnologiesai.com", "cmark@qeatechnologiesai.com",
    "mark@qeatechnologiesbuild.com", "markv@qeatechnologiesbuild.com", "cmark@qeatechnologiesbuild.com",
    "mark@qeatechnologiesgo.com", "markv@qeatechnologiesgo.com", "cmark@qeatechnologiesgo.com",
    "mark@qeatechnology-ai.com", "markv@qeatechnology-ai.com", "cmark@qeatechnology-ai.com",
    "mark@qeatechnology.com", "markv@qeatechnology.com", "cmark@qeatechnology.com",
    "mark@qeatechnologyai.com", "markv@qeatechnologyai.com", "cmark@qeatechnologyai.com",
    "markv@qeatechnologyaudit.com", "cmark@qeatechnologyaudit.com",
    "mark@qeatechnologybuild.com", "markv@qeatechnologybuild.com", "cmark@qeatechnologybuild.com",
    "mark@qeatechnologygo.com", "markv@qeatechnologygo.com", "cmark@qeatechnologygo.com",
    "mark@qeatechnologyone.com", "markv@qeatechnologyone.com", "cmark@qeatechnologyone.com",
  ] },
];

// email → [campaign name, …]. A mailbox can serve more than one (mark@tryqeatech
// is in Reseller; mark.vasu@qeatech is in LBER and Reseller).
export const CAMPAIGNS_OF_EMAIL = (() => {
  const m = new Map();
  for (const c of CAMPAIGNS) {
    for (const e of c.emails) {
      const key = e.toLowerCase();
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(c.name);
    }
  }
  return m;
})();

// The owning rep decides a chip's colour — the same person carries the same
// hue across the page. Four owners, four of the app's own accents.
export const OWNER = {
  "Mark Vasu": { short: "Mark V", initials: "MV", tint: "var(--tint-1)", ink: "var(--s1)" },
  "Mark Dolan": { short: "Mark D", initials: "MD", tint: "var(--tint-2)", ink: "var(--s2)" },
  "Justin": { short: "Justin", initials: "J", tint: "var(--tint-3)", ink: "var(--good-ink)" },
  "Gulraiz": { short: "Gulraiz", initials: "G", tint: "rgba(109,67,200,.14)", ink: "var(--violet)" },
  "Mark Vasu, Justin": { short: "Shared", initials: "MV", tint: "var(--tint-1)", ink: "var(--s1)" },
};

export const ownerOf = (name) => OWNER[name] ?? { short: name || "—", initials: "?", tint: "var(--tint-n)", ink: "var(--ink-2)" };

// The owner a campaign belongs to, for colouring its chip.
export const CAMPAIGN_OWNER = Object.fromEntries(CAMPAIGNS.map((c) => [c.name, c.owner]));

// Sender-reputation health, read from InboxKit. Only the mailboxes seen in the
// last InboxKit export are here; every other mailbox shows "—" until the full
// export is wired in. This is a number people act on, so it is never guessed —
// a mailbox with no real reading says so rather than showing a made-up one.
export const HEALTH = {
  "cmark@qeatechnologygo.com": 97, "mark@qeatechnologyone.com": 98, "markv@qeatechnologyone.com": 96,
  "cmark@qeatechnologyone.com": 98, "cmark@qeatechnologyai.com": 98, "markv@qeatechnologyaudit.com": 97,
  "cmark@qeatechnologyaudit.com": 98, "mark@qeatechnologybuild.com": 98, "markv@qeatechnologybuild.com": 98,
  "cmark@qeatechnologybuild.com": 97, "mark@qeatechnologygo.com": 98, "markv@qeatechnologygo.com": 98,
  "mark@qeatechnology-ai.com": 97, "markv@qeatechnology-ai.com": 98, "cmark@qeatechnology-ai.com": 97,
  "mark@qeatechnology.com": 97, "markv@qeatechnology.com": 97, "cmark@qeatechnology.com": 98,
};
