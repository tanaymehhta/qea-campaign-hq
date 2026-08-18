"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * The only two things anyone can change from the dashboard.
 *
 * Both go through a security-definer function in Postgres that validates its
 * own arguments — the label must be one of the six the schema allows, and the
 * row must already exist. Nothing here can insert, delete, or touch any other
 * table, so a malformed or hostile call fails in the database rather than
 * being trusted because it came from our own UI.
 *
 * A rejected write redirects back with ?err= so the person reads the
 * database's sentence in a banner, not a crash screen — the done() pattern
 * from app/calls/actions.js.
 */

function done(error, paths) {
  // "replace", because a Server Action redirect pushes by default and both of
  // these return to /conflicts — the page the click came from. Settling ten
  // conflicts would otherwise leave ten copies of it in history.
  if (error) redirect(`/conflicts?err=${encodeURIComponent(error.message)}`, "replace");
  for (const p of paths) revalidatePath(p);
  redirect("/conflicts", "replace");
}

export async function classifyReply(formData) {
  const id = formData.get("id");
  const sentiment = formData.get("sentiment");
  const { error } = await db.rpc("classify_reply", { p_reply: id, p_sentiment: sentiment });
  done(error, ["/conflicts", "/replies"]);
}

export async function recordMeetingDetail(formData) {
  const { error } = await db.rpc("record_meeting_detail", {
    p_meeting: formData.get("id"),
    p_name: formData.get("name") ?? "",
    p_company: formData.get("company") ?? "",
    p_email: formData.get("email") ?? "",
    p_note: formData.get("note") ?? "",
  });
  done(error, ["/conflicts", "/list"]);
}
