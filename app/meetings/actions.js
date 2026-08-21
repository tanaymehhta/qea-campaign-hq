"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * Where to land after a write, and the database's own sentence if it refused.
 *
 * Every action on this page returns to the page the click came from, keeping
 * the rep filter and the removed-bin toggle. "replace" on both branches: a
 * Server Action redirect pushes by default, and these all return to /meetings,
 * so a push would leave one history entry per edit. The done() pattern from
 * app/calls/actions.js.
 */
function back(formData) {
  const q = new URLSearchParams();
  const rep = (formData.get("rep") ?? "").trim();
  if (rep) q.set("rep", rep);
  // The date window the page was showing. Without it a removal bounced the rep
  // back to All time and looked like the filter had reset itself. `rm` is
  // deliberately NOT carried: the confirm has been answered, so returning to it
  // would re-open the question that was just settled.
  const range = (formData.get("range") ?? "").trim();
  if (range && range !== "all") q.set("range", range);
  if (formData.get("removed")) q.set("removed", "1");
  return `/meetings${q.size ? `?${q}` : ""}`;
}

function done(error, formData, ok) {
  const to = back(formData);
  const sep = to.includes("?") ? "&" : "?";
  if (error) redirect(`${to}${sep}err=${encodeURIComponent(error.message)}`, "replace");
  revalidatePath("/meetings");
  revalidatePath("/");
  revalidatePath("/campaigns");
  redirect(ok ? `${to}${sep}${ok}` : to, "replace");
}

/**
 * The one write this page owns. log_meeting() validates everything —
 * required name/date, email shape, evidence enum, duplicate refusal —
 * so this only ferries the form and shows the database's sentence in a
 * banner when it refuses (the done() pattern from app/calls/actions.js).
 */
export async function logMeeting(formData) {
  const { error } = await db.rpc("log_meeting", {
    p_name: formData.get("name") ?? "",
    p_email: formData.get("email") ?? "",
    p_company: formData.get("company") ?? "",
    p_date: formData.get("date"),
    // The day it was agreed, which is not the day it happens — and is what
    // every date window on the dashboard counts by. Null is refused in the
    // database rather than defaulted here, so the sentence a rep reads comes
    // from the one place that knows the rule. See migration 20260821010000.
    p_booked_on: formData.get("booked_on") || null,
    p_group: formData.get("group") || null,
    p_evidence: formData.get("evidence") ?? "chat",
    p_note: formData.get("note") ?? "",
    p_logged_by: formData.get("logged_by") ?? "",
  });
  done(error, formData, "logged=1");
}

/**
 * The rest of the lifecycle, which did not exist until 21 Aug.
 *
 * A hand-typed meeting was write-once: three functions could create one, one
 * could fill in a blank name, and nothing could re-date it, mark it held,
 * cancel it or take it back. `held` reads on two rows today only because
 * somebody had a psql prompt.
 *
 * All four go through a security-definer function that validates its own
 * arguments and can touch exactly one row of one table. Two of them refuse
 * outright on a meeting that came from a call — that one belongs to the call,
 * and edit_call already keeps it in step in both directions.
 */

export async function editMeeting(formData) {
  const { error } = await db.rpc("edit_meeting", {
    p_meeting: formData.get("id"),
    p_name: formData.get("name") ?? "",
    p_email: formData.get("email") ?? "",
    p_company: formData.get("company") ?? "",
    p_date: formData.get("date"),
    p_booked_on: formData.get("booked_on") || null,
    p_group: formData.get("group") || null,
    p_evidence: formData.get("evidence") ?? "chat",
    p_note: formData.get("note") ?? "",
  });
  done(error, formData, "saved=1");
}

export async function setMeetingStatus(formData) {
  const { error } = await db.rpc("set_meeting_status", {
    p_meeting: formData.get("id"),
    p_status: formData.get("status"),
  });
  done(error, formData, "saved=1");
}

export async function removeMeeting(formData) {
  const { error } = await db.rpc("remove_meeting", {
    p_meeting: formData.get("id"),
    p_reason: formData.get("reason") ?? "",
  });
  done(error, formData, "removed_one=1");
}

export async function restoreMeeting(formData) {
  const { error } = await db.rpc("restore_meeting", { p_meeting: formData.get("id") });
  done(error, formData, "restored=1");
}
