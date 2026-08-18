"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "../../lib/db";

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
function finish(err, sent) {
  revalidatePath("/feedback");
  const q = new URLSearchParams(err ? { err } : sent ? { sent: "1" } : {});
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

  const { error } = await db.rpc("submit_feedback", {
    p_page: page,
    p_rep: rep ?? "",
    p_body: body,
    p_screenshot: path ?? "",
  });
  finish(error?.message, true);
}

export async function setFeedbackStatus(formData) {
  const { error } = await db.rpc("set_feedback_status", {
    p_id: formData.get("id"),
    p_status: formData.get("status"),
  });
  finish(error?.message);
}
