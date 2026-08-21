import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repById } from "./routing.js";

/**
 * Who has already reached out to a company, and when.
 *
 * The queue answers "who should I contact"; nothing in it answered "has someone
 * already". Two reps working All-reps on the same morning had no way to see the
 * other had picked an account up, and the pipeline cannot know — reaching out
 * happens in a mailbox, not in a graph run.
 *
 * ponytail: a JSON file beside the repo, not a table. Ceiling — one machine, one
 * writer at a time, and it does not survive a deploy. That is the whole point
 * for now: this is the shape of the feature, on localhost, without a migration
 * against the live database. The upgrade path is an `inbound_touches` row per
 * company written by a `security definer` function, exactly like the other three
 * writes in `app/inbound/actions.js`; only the two functions below change.
 */
// `process.cwd()`, not a URL relative to this file: webpack reads
// `new URL(..., import.meta.url)` as an asset import and fails the build on a
// file that does not exist yet.
const FILE = join(process.cwd(), ".touched.json");

/** `{ [companyId]: { by, at } }` — every account someone has claimed. */
export async function loadTouches() {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    // No file yet is not an error: nobody has ticked anything.
    return {};
  }
}

/**
 * Tick or untick one company.
 *
 * `by` is validated against the rep table rather than trusted: this is the one
 * value a form supplies free-hand, and a name nobody recognises would render as
 * an initial-less blank on every card that showed it.
 */
export async function setTouch(companyId, by) {
  if (!companyId) throw new Error("no company on that row");
  if (by && !repById(by)) throw new Error("that is not a rep we route to");

  const all = await loadTouches();
  if (by) all[companyId] = { by, at: new Date().toISOString() };
  else delete all[companyId];
  await writeFile(FILE, JSON.stringify(all, null, 2));
}
