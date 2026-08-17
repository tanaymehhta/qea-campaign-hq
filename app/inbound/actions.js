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

/** What a previous click left in the URL, and what this one must not join. */
const SAID = ["err", "nope", "queued"];

/**
 * Back where the click came from, so a button never navigates the reader away.
 *
 * The referer carries the last outcome in its query string, so appending to it
 * stacks them: five presses of a refused Restart read "already queued 00:09
 * agoalready queued 00:10 ago…" as one run-on sentence. Each message replaces
 * the last rather than joining it.
 *
 * `extra` is a raw fragment rather than a flag because the outcomes are three
 * different sentences: a write that failed, an action refused on purpose, and a
 * restart that was accepted and has nothing to show for itself yet.
 */
function back(err, extra) {
  const ref = headers().get("referer");
  let path = "/inbound";
  try {
    if (ref) {
      const u = new URL(ref);
      SAID.forEach((k) => u.searchParams.delete(k));
      path = `${u.pathname}${u.search}`;
    }
  } catch {
    /* a referer we cannot parse is not worth failing the write over */
  }
  const q = err ? `err=${encodeURIComponent(err)}` : extra ?? "";
  if (!q) redirect(path);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${q}`);
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

/**
 * Ask GitHub to run one company again, from `stage` through to the draft.
 *
 * The dashboard cannot run the pipeline — it is Python on a GitHub runner, not
 * anything Vercel hosts. So this rings a doorbell: `workflow_dispatch` on the
 * same workflow the 3-hourly schedule uses, with the company id the workflow
 * already accepts. Nothing here knows how research works, which is the point.
 *
 * Two steps, in this order and not the reverse. The request row is written
 * first, because it is what refuses a second press while the first is still in
 * flight; if the dispatch then fails, the row is marked abandoned so a refusal
 * cannot outlive the failure that caused it.
 *
 * `ref` is master. qea-inbound's default branch is master, not main — the plan
 * of record says main, and that call 422s.
 */
const WORKFLOW =
  "https://api.github.com/repos/tanaymehhta/qea-inbound/actions/workflows/inbound-pipeline.yml/dispatches";

export async function restartCompany(formData) {
  const id = formData.get("id");
  const stage = Number(formData.get("stage")) || 1;

  // Every refusal — running right now, pressed a minute ago, out of credit —
  // is raised in here, so the rules live in one place a hostile POST also hits.
  const { data: request, error } = await db.rpc("inbound_request_rerun", {
    p_company: id,
    p_stage: stage,
    p_actor: null, // no session to name yet; the column is waiting for sign-in
  });
  // A refusal is not a failure. Every exception the function raises is a rule
  // it applied on purpose — already running, pressed a minute ago, out of
  // credit — so it must not land under "That didn't save", which tells a rep
  // to press again.
  if (error) back(null, `nope=${encodeURIComponent(error.message)}`);

  const abandon = async (why) => {
    await db.rpc("inbound_mark_rerun", { p_request: request, p_state: "abandoned" });
    back(why);
  };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) await abandon("this deployment has no GitHub token, so nothing was started");

  const res = await fetch(WORKFLOW, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "master",
      inputs: { company_id: id, from_stage: String(stage) },
    }),
  });

  // 204 on success, and no body — GitHub does not tell you which run it made,
  // so github_run_id stays null until something reads it back. The evidence a
  // rep actually needs is the new inbound_graph_runs row, not this id.
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 140);
    await abandon(`GitHub refused it (${res.status}) ${detail}`);
  }

  await db.rpc("inbound_mark_rerun", { p_request: request, p_state: "dispatched" });
  refresh(id, null);
  back(null, "queued=1");
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
