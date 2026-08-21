import { db } from "../db.js";
import { repById } from "./routing.js";

/**
 * Who has already reached out to a company, and when.
 *
 * The queue answers "who should I contact"; nothing in it answered "has someone
 * already". Two reps working All reps on the same morning had no way to see the
 * other had picked an account up, and no stage can ever fill this in — reaching
 * out happens in a mailbox, not in a graph run.
 *
 * It lives on `inbound_companies` as `reached_out_by` / `reached_out_at`, not in
 * a table of its own: one answer per account, replaced rather than accumulated,
 * and every page that shows it is already reading that row. So the read costs
 * nothing — `loadQueue` and `loadCompany` select the two columns with the rest,
 * and this file is only the write.
 *
 * The write is `inbound_set_reached_out`, a `security definer` function like the
 * other three hand controls. The anon key still cannot UPDATE the table.
 */

/** The tick on a company row, or null. One shape for the cards and the pages. */
export const touchOf = (c) =>
  c?.reached_out_by ? { by: c.reached_out_by, at: c.reached_out_at } : null;

/**
 * Tick or untick one company. `by` is null to take a tick back.
 *
 * The name is checked against the rep table before it goes anywhere: it is the
 * one value a form supplies free-hand, and a rep id nobody recognises would
 * render as an initial-less blank on every card that showed it. The database
 * refuses blanks and overlong strings on its own — this is the check the
 * database cannot make, because the rep table lives in JavaScript.
 */
export async function setTouch(companyId, by) {
  if (!companyId) throw new Error("no company on that row");
  if (by && !repById(by)) throw new Error("that is not a rep we route to");

  const { error } = await db.rpc("inbound_set_reached_out", {
    p_company: companyId,
    p_by: by,
  });
  if (error) throw new Error(error.message);
}
