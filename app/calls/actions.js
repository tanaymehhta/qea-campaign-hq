"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * The Calls write path. Same shape as app/conflicts/actions.js: every write
 * is a security-definer function that validates its own arguments in the
 * database, so a malformed or hostile call fails there rather than being
 * trusted because it came from our own UI. RLS still blocks direct writes.
 */

function done(formData, error) {
  // The form carries an encoded path (the rep name has a space); revalidatePath
  // matches on the real pathname, so an encoded one silently matches nothing.
  const path = formData.get("path") || "/calls";
  const contact = formData.get("contact_id");
  if (!error) {
    revalidatePath(decodeURIComponent(path), "page");
    revalidatePath("/");          // the Overview Calls tile reads the same rows
    revalidatePath("/meetings");  // so does the Meetings phone-call table
  }

  // Always end on a GET. A thrown error would show the rep a crash screen
  // instead of the sentence the database actually raised ("a do-not-call needs
  // a reason"), and reloading after a POST re-submits the call. ?open reopens
  // the row they were working, because a redirect otherwise collapses it and
  // they lose their place mid-shift.
  const q = new URLSearchParams();
  if (contact) q.set("open", contact);
  if (error) q.set("err", error.message);
  // "replace" — a Server Action redirect pushes by default, which would give a
  // rep one history entry per logged call and a Back button they cannot use.
  redirect(`${path}?${q}${contact ? `#c-${contact}` : ""}`, "replace");
}

/**
 * One call in, one row out.
 *
 * This used to read `formData.getAll("outcome")` and insert once per ticked
 * checkbox, so a dial that ended "no answer, left a voicemail, sent the email"
 * was three rows and counted as three calls — 16 rows for 11 calls. The form
 * posts a single radio now and there are four of them to choose from.
 *
 * The meeting date rides along and is used by exactly one outcome. log_call
 * refuses a booked_meeting without it — the date of the call is not the date of
 * the meeting, and treating them as the same day is what put a meeting agreed
 * on 4 August onto 4 August's board.
 */
export async function logCall(formData) {
  const { error } = await db.rpc("log_call", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
    p_call_date: formData.get("call_date"),
    p_outcome: formData.get("outcome"),
    p_note: formData.get("note") ?? "",
    p_callback: formData.get("callback_date") || null,
    p_meeting_date: formData.get("meeting_date") || null,
  });
  done(formData, error);
}

/** Fixing a logged call. Same shape as logging one — one row, one outcome. */
export async function editCall(formData) {
  const { error } = await db.rpc("edit_call", {
    p_call: formData.get("call_id"),
    p_rep: formData.get("rep") ?? "",
    p_call_date: formData.get("call_date"),
    p_outcome: formData.get("outcome"),
    p_note: formData.get("note") ?? "",
    p_callback: formData.get("callback_date") || null,
    p_meeting_date: formData.get("meeting_date") || null,
  });
  done(formData, error);
}

/** Soft delete — the row stays, deleted_at just takes it out of every count. */
export async function deleteCall(formData) {
  const { error } = await db.rpc("delete_call", { p_call: formData.get("call_id") });
  done(formData, error);
}

/**
 * Give an unassigned call a person, a list and a rep.
 *
 * The three 16 July "New York" calls have no contact row — they predate the
 * table — so they are counted on the Overview, invisible on every campaign
 * page, and attributed to no rep. Nothing in the database can close that; the
 * facts only exist in somebody's memory. This is where they get typed in.
 */
export async function adoptOrphanCall(formData) {
  const { error } = await db.rpc("adopt_orphan_call", {
    p_call: formData.get("call_id"),
    p_campaign: formData.get("campaign_id"),
    p_full_name: formData.get("full_name") ?? "",
    p_rep: formData.get("rep") ?? "",
    p_org: formData.get("org_name") ?? "",
    p_role: formData.get("role") ?? "",
    p_phone: formData.get("phone") ?? "",
    p_email: formData.get("email") ?? "",
  });
  done(formData, error);
}

export async function setContactDnc(formData) {
  const { error } = await db.rpc("set_contact_dnc", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
    p_reason: formData.get("reason") ?? "",
  });
  done(formData, error);
}

export async function updateContactDetail(formData) {
  const { error } = await db.rpc("update_contact_detail", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
    p_field: formData.get("field"),
    p_value: formData.get("value") ?? "",
  });
  done(formData, error);
}

export async function setCallback(formData) {
  const { error } = await db.rpc("set_callback", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
    p_date: formData.get("date") || null,
  });
  done(formData, error);
}

/** The way back from a do-not-call — retiring someone was one-way. */
export async function restoreContact(formData) {
  const { error } = await db.rpc("restore_contact", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
  });
  done(formData, error);
}
