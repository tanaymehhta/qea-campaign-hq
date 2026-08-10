"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "../../lib/db";

/**
 * The only writes this app makes to `inbound_*`.
 *
 * Everything else in the section reads. These three exist because a rep needs to
 * disagree with the pipeline without waiting on a backend deploy: reorder the
 * people at an account, overrule a Ready / Needs-a-check verdict, and move a
 * company between the queue and the ruled-out lane.
 *
 * Each one calls a `security definer` function that validates its own arguments —
 * the same shape as `submit_feedback` — so a hostile POST fails in the database
 * rather than because this file happened to be well-behaved. The anon key can
 * execute those three functions and still cannot UPDATE any inbound table.
 *
 * The manual answers live in `manual_rank` and `manual_sendable`, not in
 * `priority` and `sendable`: stage 2 patches that second pair on every re-run
 * (supabase_io.ROUTING_COLS), so a hand-set priority would be silently undone
 * within three hours. Marking a company relevant is the exception and writes
 * `research_status` directly — the runner picks up `new` and nothing else, so
 * that column *is* the instruction, and the pipeline overwriting it afterwards
 * is the pipeline doing its job.
 */

/** Back where the click came from, so a button never navigates the reader away. */
function back(err) {
  const ref = headers().get("referer");
  let path = "/inbound";
  try {
    if (ref) {
      const u = new URL(ref);
      path = `${u.pathname}${u.search}`;
    }
  } catch {
    /* a referer we cannot parse is not worth failing the write over */
  }
  if (!err) redirect(path);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}err=${encodeURIComponent(err)}`);
}

/**
 * Revalidate every page that can show this row. The queue counts lanes, the
 * company page lists its people, the person page shows one — a write visible on
 * only the page you were standing on reads as a bug on the other two.
 */
function refresh(companyId, personId) {
  revalidatePath("/inbound");
  if (companyId) revalidatePath(`/inbound/company/${companyId}`);
  if (personId) revalidatePath(`/inbound/person/${personId}`);
}

export async function movePerson(formData) {
  const id = formData.get("id");
  const dir = formData.get("dir");
  const { error } = await db.rpc("inbound_move_person", { p_person: id, p_dir: dir });
  refresh(formData.get("company"), id);
  back(error?.message);
}

export async function setPersonReady(formData) {
  const id = formData.get("id");
  // "clear" hands the row back to the classifier instead of freezing today's
  // human answer forever — without it, an override could never be undone.
  const want = formData.get("ready");
  const ready = want === "clear" ? null : want === "yes";
  const { error } = await db.rpc("inbound_set_person_ready", { p_person: id, p_ready: ready });
  refresh(formData.get("company"), id);
  back(error?.message);
}

export async function setCompanyRelevant(formData) {
  const id = formData.get("id");
  const { error } = await db.rpc("inbound_set_company_relevant", {
    p_company: id,
    p_relevant: formData.get("relevant") === "yes",
  });
  refresh(id, null);
  back(error?.message);
}
