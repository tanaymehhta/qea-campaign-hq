/**
 * Pipeline vocabulary, in English.
 *
 * The database speaks in classifier output: `not_icp`, `owner_operator`,
 * `rb2b_unconfirmed`, `/how-ai-is-driving-a-new-era-of-efficient-building-
 * envelope-retrofits/`. A salesperson opening a card should never have to learn
 * any of it, so every one of those is translated here, once.
 */

/** What the account-type classifier decided, and what it means for a seller. */
export const ACCOUNT_TYPE = {
  owner_operator: { short: "Owns buildings", long: "Owns and operates buildings — the people who buy this" },
  consultant: { short: "Advises owners", long: "Advises building owners — a partner, not a buyer" },
  other_icp: { short: "Worth a look", long: "Fits the profile without being an owner or a consultant" },
  not_icp: { short: "Not a fit", long: "No buildings to survey — the pipeline ruled them out" },
};

export const accountType = (t) => ACCOUNT_TYPE[t] ?? null;

/**
 * Is this company worth selling to — read from both columns that answer it.
 *
 * The pipeline records its verdict twice and the two disagree on 11 of the 42
 * companies that have visited: ten carry `research_status = not_icp` with no
 * `account_type` at all, and one is typed `owner_operator` but ruled out by its
 * status. Reading only `account_type` filed all eleven as prospects.
 *
 * A rule-out from either column rules the company out — the pipeline never says
 * "not a fit" by accident, but it does leave `account_type` unwritten. A company
 * with neither answer is undecided, which is its own state and not a guess.
 */
export function verdict(company) {
  const type = company?.account_type ?? null;
  const status = company?.research_status ?? null;

  if (type === "not_icp" || status === "not_icp") {
    return {
      lane: "irrelevant",
      short: "Not a fit",
      long: ACCOUNT_TYPE.not_icp.long,
      // Worth surfacing: the type and the status do not agree here.
      conflict: type && type !== "not_icp" ? ACCOUNT_TYPE[type]?.short ?? type : null,
    };
  }
  if (!type) {
    return {
      lane: "undecided",
      short: status === "new" || !status ? "Not researched yet" : "Waiting on research",
      long: "Nothing has been decided about them yet — research has not returned a verdict.",
      conflict: null,
    };
  }
  const t = ACCOUNT_TYPE[type] ?? { short: "Worth a look", long: "Fits the profile." };
  return { lane: "relevant", short: t.short, long: t.long, conflict: null };
}

/** Small words for statuses that otherwise render as snake_case. */
export const EMAIL_STATUS = {
  verified: "Verified",
  rb2b_unconfirmed: "Guessed, not verified",
  none: "No address",
  guessed: "Guessed",
};
export const emailStatus = (s) => EMAIL_STATUS[s] ?? (s ? s.replace(/_/g, " ") : null);

/** Fix the acronyms that a naive capitalisation flattens. */
const ACRONYMS = [
  [/\bai\b/gi, "AI"], [/\besg\b/gi, "ESG"], [/\bhvac\b/gi, "HVAC"], [/\bll(\d+)/gi, "LL$1"],
  // The classifier quotes its own enum inside its prose ("Classified not_icp.");
  // a rep reading the research should not meet the vocabulary there either.
  [/\bnot_icp\b/g, "not a fit"], [/\bowner_operator\b/g, "owner-operator"],
  [/\bother_icp\b/g, "a fit"],
];
export const tidy = (s) => ACRONYMS.reduce((t, [re, to]) => t.replace(re, to), s ?? "");

const PAGE_NAMES = {
  "": "Home page",
  "/": "Home page",
  "/pricing": "Pricing",
  "/contact-us": "Contact us",
  "/about-us": "About us",
  "/careers": "Careers",
};

/**
 * A URL path as a person would say it.
 *
 * "/how-ai-is-driving-a-new-era-of-efficient-building-envelope-retrofits/"
 * is a slug with punctuation at both ends; what a rep needs to hear is
 * "How AI is driving a new era of efficient building envelope retrofits".
 */
export function pageTitle(url) {
  const path = (url ?? "").replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const clean = path.replace(/\/+$/, "");
  if (PAGE_NAMES[clean] !== undefined) return PAGE_NAMES[clean];

  const parts = clean.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const words = last
    .replace(/-\d+$/, "")          // trailing "-2" from a duplicated slug
    .replace(/\.(html?|php)$/, "")
    .replace(/-/g, " ")
    .trim();
  if (!words) return "Home page";

  const title = tidy(words.charAt(0).toUpperCase() + words.slice(1));
  const section = parts.length > 1 ? parts[0].replace(/-/g, " ") : null;
  return section ? `${section.charAt(0).toUpperCase() + section.slice(1)}: ${title}` : title;
}


/**
 * A paragraph as bullets.
 *
 * The pipeline writes research as one 400-word block. Nobody reads that on a
 * call. Splitting on sentence ends is crude and it is enough: each sentence in
 * these summaries is already one fact.
 *
 * ponytail: sentence splitter, not a parser. Ceiling — an abbreviation with a
 * full stop starts a new bullet. The real fix is the pipeline emitting a list.
 */
/**
 * Split on a sentence end — unless the full stop belongs to an abbreviation.
 * Without the guard, "assets (e.g. Franklin Distribution Center) are..." breaks
 * into two fragments, neither of which is a sentence.
 */
const ABBREV = ["e\\.g", "i\\.e", "vs", "etc", "approx", "Inc", "Corp", "Ltd", "Co",
                "St", "No", "Mr", "Ms", "Dr", "U\\.S", "U\\.K"];
const SPLIT = new RegExp(
  `(?<!${ABBREV.map((a) => `${a}\\.`).join("|")})(?<=[.!?])\\s+(?=[A-Z(])|\\s\\|\\s`
);
/** The model labels its own paragraphs; the bullet already says what it is. */
const LABEL = /^((Portfolio|Scale|Note|IMPORTANT|Sectors evidenced|Summary)\s*:\s*)+/i;

export function bullets(text, max = 8) {
  if (!text) return [];
  return text
    .replace(/\[https?:\/\/[^\]]+\]/g, "")   // inline citations the model leaves behind
    .replace(/\s+/g, " ")
    .split(SPLIT)
    .map((s) => tidy((s ?? "").trim().replace(LABEL, "")))
    .filter((s) => s.length > 12)
    .slice(0, max);
}
