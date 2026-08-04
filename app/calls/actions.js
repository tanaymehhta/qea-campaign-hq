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
  redirect(`${path}?${q}${contact ? `#c-${contact}` : ""}`);
}

// The order calls go in matters: log_call inserts one row per outcome, and
// statusOf (the row's pill) reads the newest one — so whichever outcome
// goes in last wins the display. That has to be a fixed priority, not
// "whatever order the checkboxes happen to render in" — a voicemail with
// a stray "booked meeting" click should still show as a voicemail.
const OUTCOME_PRIORITY = [
  "left_email", "left_voicemail", "no_answer",
  "other", "not_interested", "follow_up", "booked_meeting",
];

// A single dial can end more than one way — "no answer, left a voicemail"
// is two outcomes, not one. The checkboxes post one row per outcome,
// sharing the same date/note/callback; log_call's dedup guard keys on
// outcome too, so this can't double-log any one of them.
export async function logCall(formData) {
  const outcomes = formData.getAll("outcome")
    .sort((a, b) => OUTCOME_PRIORITY.indexOf(a) - OUTCOME_PRIORITY.indexOf(b));
  if (!outcomes.length) {
    return done(formData, new Error("pick at least one outcome"));
  }
  for (const outcome of outcomes) {
    const { error } = await db.rpc("log_call", {
      p_contact: formData.get("contact_id"),
      p_rep: formData.get("rep") ?? "",
      p_call_date: formData.get("call_date"),
      p_outcome: outcome,
      p_note: formData.get("note") ?? "",
      p_callback: formData.get("callback_date") || null,
    });
    if (error) return done(formData, error);
  }
  done(formData, null);
}

/** Fixing a logged call — one row, so one outcome, unlike logCall's checkboxes. */
export async function editCall(formData) {
  const { error } = await db.rpc("edit_call", {
    p_call: formData.get("call_id"),
    p_rep: formData.get("rep") ?? "",
    p_call_date: formData.get("call_date"),
    p_outcome: formData.get("outcome"),
    p_note: formData.get("note") ?? "",
    p_callback: formData.get("callback_date") || null,
  });
  done(formData, error);
}

/** Soft delete — the row stays, deleted_at just takes it out of every count. */
export async function deleteCall(formData) {
  const { error } = await db.rpc("delete_call", { p_call: formData.get("call_id") });
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
