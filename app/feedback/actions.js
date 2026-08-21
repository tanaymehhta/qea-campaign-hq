"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "../../lib/db";
import { REPO } from "../../lib/github";

/**
 * Feedback, written the same way as every other write here: a security-definer
 * function that validates its own arguments, so a hostile POST fails in the
 * database rather than because our UI happened to be well-behaved.
 */

/** Where the reporter was standing. The browser sends it on the POST, so it
 *  costs the person nothing — no "which page?" field to fill in and get wrong. */
function origin() {
  const ref = headers().get("referer");
  if (!ref) return { page: "unknown", rep: null };
  try {
    const u = new URL(ref);
    // The Calls section carries the rep in the path, not a ?rep= param —
    // /calls/Mark%20Vasu/nyc-ll11-safe. /calls alone has no rep segment.
    const m = u.pathname.match(/^\/calls\/([^/]+)/);
    const rep = u.searchParams.get("rep") ?? (m ? decodeURIComponent(m[1]) : null);
    return { page: `${u.pathname}${u.search}`, rep };
  } catch {
    return { page: "unknown", rep: null };
  }
}

/**
 * Everything lands on /feedback afterwards rather than back on the page it came
 * from: the box lives in the layout, which cannot read query params, so there is
 * nowhere on an arbitrary page to put "saved" or "that failed". Landing on the
 * list is the better confirmation anyway — you watch your own item arrive.
 */
function finish(err, sent, asked) {
  revalidatePath("/feedback");
  const q = new URLSearchParams(
    err ? { err } : sent ? { sent: "1" } : asked ? { asked: "1" } : {},
  );
  // "replace": a Server Action redirect pushes by default, and this one lands
  // on the page it started from, so a push buries the way back one press deeper.
  redirect(`/feedback${q.size ? `?${q}` : ""}`, "replace");
}

export async function submitFeedback(formData) {
  const { page, rep } = origin();
  const body = (formData.get("body") ?? "").trim();
  const shot = formData.get("screenshot");
  let path = null;

  // The database is still the authority on this — the same two checks live in
  // submit_feedback. Repeating them here only avoids uploading a screenshot
  // that is about to be orphaned by a rejected row.
  if (!body) finish("say something first — the box is empty");
  if (body.length > 5000) finish("that is too long for this box — keep it under 5,000 characters");

  // An empty file input still arrives as a File, with size 0.
  if (shot && typeof shot === "object" && shot.size > 0) {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[shot.type];
    if (!ext) finish("screenshots need to be a PNG, JPEG, WebP or GIF");
    path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage
      .from("feedback")
      .upload(path, shot, { contentType: shot.type });
    // The bucket enforces the 5 MB ceiling and the image-only rule, so an
    // oversized or wrong-typed file surfaces here rather than being trusted.
    if (error) finish(`the screenshot didn't upload: ${error.message}`);
  }

  const { data: id, error } = await db.rpc("submit_feedback", {
    p_page: page,
    p_rep: rep ?? "",
    p_body: body,
    p_screenshot: path ?? "",
  });
  if (error) finish(error.message);

  // Saying it is asking for it. There is no second button any more: the work
  // starts here, and if GitHub will not take the request the row still stands
  // as a piece of feedback somebody can read.
  const failed = await dispatch(id, { page, rep: rep || "someone", body });
  finish(failed, true);
}

export async function setFeedbackStatus(formData) {
  const { error } = await db.rpc("set_feedback_status", {
    p_id: formData.get("id"),
    p_status: formData.get("status"),
  });
  finish(error?.message);
}

/**
 * Ring GitHub's doorbell for one piece of feedback, and remember that we did.
 *
 * Returns an error string rather than redirecting, because the two callers want
 * to land somewhere different afterwards. Returns undefined when it worked.
 *
 * asked_at is written only after GitHub has accepted, so a refused dispatch
 * leaves the card looking un-started rather than permanently working on a run
 * that never began.
 */
async function dispatch(id, { page, rep, body }) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return "saved, but GITHUB_DISPATCH_TOKEN isn't set, so nothing started";

  const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: "feedback",
      client_payload: { id, page, rep, body },
    }),
  });
  // 204 is the whole success response — GitHub accepts the dispatch and says
  // nothing else, so there is no run id to hand back and link to here.
  if (!res.ok) return `saved, but it didn't start (${res.status}): ${await res.text()}`;

  const { error } = await db.rpc("mark_feedback_asked", { p_id: id });
  if (error) return `it started, but we couldn't record that: ${error.message}`;
}

/** The second attempt, from the card, after a run that produced nothing. */
export async function askClaude(formData) {
  const id = formData.get("id");
  const { data, error } = await db.from("feedback").select("*").eq("id", id).single();
  if (error) finish(`couldn't read that feedback back: ${error.message}`);

  const failed = await dispatch(id, {
    page: data.page,
    rep: data.rep || "someone",
    body: data.body,
  });
  finish(failed, false, true);
}

/**
 * Say no to a proposed change.
 *
 * Closes the pull request and leaves the feedback open, because turning down
 * one attempt is not the same as deciding the thing was never worth asking
 * for — the card keeps its "try again", and the words that were typed stay
 * where somebody can read them and have another go.
 */
export async function discard(formData) {
  const id = formData.get("id");

  // Deleting the branch rather than closing the pull request. Closing one is a
  // "Pull requests: write" permission the token does not have and does not need
  // for anything else; deleting a branch is a contents write, which it already
  // has for the dispatch. GitHub closes a pull request whose head branch has
  // gone, so this arrives at the same place through the door that is open.
  //
  // The pull request survives as a record — the diff stays readable on it, and
  // it remembers the ref it came from, which is why the state lookup matches on
  // head.ref rather than filtering by a branch that no longer exists.
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/git/refs/heads/feedback/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  // 422 is GitHub's answer when the ref is already gone, which is the state
  // this was trying to reach anyway.
  finish(res.ok || res.status === 422 ? null : `couldn't turn it down (${res.status})`);
}

/**
 * Put a proposed change on the live dashboard.
 *
 * Merging is the whole act: Vercel is watching main, so the deploy follows on
 * its own. The feedback is marked done in the same breath — it was asked for,
 * it was built, it shipped, and leaving it open would mean the count at the top
 * of the page kept nagging about something already live.
 *
 * Called from two places that look nothing alike: the card on /feedback, and
 * the banner across the top of the preview itself.
 */
export async function ship(formData) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const number = formData.get("pr");
  const id = formData.get("id");

  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls/${number}/merge`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ merge_method: "squash" }),
  });

  if (!res.ok) {
    const why = res.status === 403
      ? "the token needs Pull requests: read and write for this"
      : `${res.status}: ${(await res.text()).slice(0, 200)}`;
    finish(`that didn't ship — ${why}`);
  }

  if (id) await db.rpc("set_feedback_status", { p_id: id, p_status: "done" });

  // Always the list, never back to where the press came from: a preview page
  // stops existing the moment its branch merges, so there is nothing to return
  // to. Watching the card turn to "Shipped" is the confirmation.
  revalidatePath("/feedback");
  redirect("/feedback?shipped=1", "replace");
}


