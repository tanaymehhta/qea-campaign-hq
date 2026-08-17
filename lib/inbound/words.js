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
 * A rule-out from either column rules the company out — with one exception. A
 * `not_icp` written off a call that never returned is not a decision, and three
 * companies are sitting in the ruled-out lane on exactly that: ScanSource
 * Chile, Self Employed and BAMO were all filed "not a fit" off a 402. They are
 * prospects nobody has read yet, so they stay in the queue and their chip says
 * the research failed. The proper fix is upstream — a node that 402s should
 * leave `account_type` null — and until it lands this is where it is caught.
 *
 * Two lanes, not three. The old "undecided" lane was answering a different
 * question, badly: all 49 companies it held had been researched and had
 * crashed. What happened to research is `researchChip`; which lane a company
 * belongs in is this. A company nobody has ruled out is a prospect.
 */
export function verdict(company) {
  const type = company?.account_type ?? null;
  const status = company?.research_status ?? null;
  const crashed = isApiError(company?.account_type_reason);

  if (!crashed && (type === "not_icp" || status === "not_icp")) {
    return {
      lane: "irrelevant",
      short: "Not a fit",
      long: ACCOUNT_TYPE.not_icp.long,
      // Worth surfacing: the type and the status do not agree here.
      conflict: type && type !== "not_icp" ? ACCOUNT_TYPE[type]?.short ?? type : null,
    };
  }
  if (crashed) {
    return {
      lane: "relevant",
      short: "Not decided",
      long: "Research failed before it decided anything about them — this is not a verdict.",
      conflict: null,
    };
  }
  if (!type) {
    return {
      lane: "relevant",
      short: status === "new" || !status ? "Not researched yet" : "Waiting on research",
      long: "Nothing has been decided about them yet — research has not returned a verdict.",
      conflict: null,
    };
  }
  const t = ACCOUNT_TYPE[type] ?? { short: "Worth a look", long: "Fits the profile." };
  return { lane: "relevant", short: t.short, long: t.long, conflict: null };
}

// ── when the pipeline failed rather than decided ────────────────────────────

/**
 * Did a provider fail here, or did a model actually decide something?
 *
 * 56 of the 95 companies carry an `account_type_reason` that begins
 * "LLM/search failed (Error code: 402 — Insufficient credits" and holds no
 * classification prose at all: OpenRouter ran out of credits mid-run and the
 * classifier returned 402. Three of those 56 were then filed as not a fit off
 * that failed call. A verdict read from a crash is not a verdict, so both the
 * card and the company page ask this before believing anything downstream.
 */
const API_ERROR =
  /LLM\/search failed|Error code:\s*\d{3}|insufficient credits|rate.?limit|\b429\b|timed? ?out/i;
export const isApiError = (text) => Boolean(text) && API_ERROR.test(text);

/**
 * The subset of those failures an empty account caused — the only kind a human
 * can fix between two presses of Restart.
 *
 * It reads both the raw error and the English `errorReason` produces from it,
 * because the callers hold one or the other and neither should have to know
 * which. "credits" is the word both spellings share.
 */
const CREDIT_ERROR = /insufficient credits|out of (OpenRouter|Apollo) credits|\b402\b/i;
export const isCreditError = (text) => Boolean(text) && CREDIT_ERROR.test(text);

/**
 * The same failure said in English, one clause long.
 *
 * Apollo is tested first: its 422 body says "You have insufficient credits"
 * before it names apollo.io, so a bare credits test would call every Apollo
 * failure an OpenRouter one.
 */
const REASONS = [
  [/insufficient credits[\s\S]{0,200}apollo|apollo[\s\S]{0,200}insufficient credits/i,
   "we were out of Apollo credits"],
  [/insufficient credits/i, "we were out of OpenRouter credits"],
  [/rate.?limit|\b429\b/i, "the provider rate-limited us"],
  [/timed? ?out|timeout/i, "the step timed out"],
];
export const errorReason = (text) =>
  REASONS.find(([re]) => re.test(text ?? ""))?.[1] ?? "the step failed — see details";

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Did research finish, crash, or never start — one chip, read everywhere.
 *
 * This is what the "Not researched yet" lane used to carry, and the lane was
 * lying: all 49 companies in it had been researched, and the research had
 * crashed. A lane says where a company belongs; this says what happened to it,
 * which is a different question and the one that was going unanswered.
 */
export function researchChip(company) {
  const reason = company?.account_type_reason;
  if (isApiError(reason)) {
    return { state: "failed", label: "Research failed",
             long: "The classifier never returned — this is a failure, not a verdict." };
  }
  if (reason) {
    return { state: "done", label: "Researched",
             long: "A model read this company and wrote down what it decided." };
  }
  return { state: "none", label: "Not researched",
           long: "Nothing has looked at this company yet." };
}

/** Small words for statuses that otherwise render as snake_case. */
export const EMAIL_STATUS = {
  verified: "Verified",
  rb2b_unconfirmed: "Guessed, not verified",
  none: "No address",
  guessed: "Guessed",
};
export const emailStatus = (s) => EMAIL_STATUS[s] ?? (s ? s.replace(/_/g, " ") : null);

/**
 * Where an address came from. Six values, and nobody outside the pipeline knows
 * what "quarantined" means — it means the address was guessed and the guess
 * looks wrong, which is a thing a rep can act on once it is said.
 */
export const EMAIL_SOURCE = {
  apollo: "From Apollo",
  stage1: "From RB2B, when they visited",
  web_public: "Found on their website",
  quarantined_off_domain: "Guessed — a personal address, not a company one",
  quarantined_name_mismatch: "Guessed — the name doesn't match the address",
  none: "No address found",
};
// One row reads `apollo(corrected rb2b)`; it is still Apollo's answer.
export const emailSource = (s) =>
  !s ? null : EMAIL_SOURCE[s] ?? (s.startsWith("apollo") ? EMAIL_SOURCE.apollo : null);

/**
 * A seniority band or a role bucket, capitalised properly.
 *
 * `.replace(/_/g, " ")` alone gives "c suite" and "consultant leadership". The
 * acronyms need holding, and two enum values are not words at all: 140 rows say
 * `stage1_carryover`, which is the pipeline describing its own plumbing.
 */
const ROLE_WORDS = {
  c_suite: "C-suite", svp: "SVP", evp: "EVP", vp: "VP", ic: "IC",
  stage1_carryover: "Named when they visited, not yet placed",
};
export const roleWords = (v) => (v ? ROLE_WORDS[v] ?? cap(v.replace(/_/g, " ")) : null);

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
