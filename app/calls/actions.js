"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../lib/db";

/**
 * The Calls write path. Same shape as app/conflicts/actions.js: every write
 * is a security-definer function that validates its own arguments in the
 * database, so a malformed or hostile call fails there rather than being
 * trusted because it came from our own UI. RLS still blocks direct writes.
 */

function done(formData, error) {
  if (error) throw new Error(error.message);
  revalidatePath(formData.get("path") || "/calls", "page");
  revalidatePath("/");          // the Overview Calls tile reads the same rows
  revalidatePath("/meetings");  // so does the Meetings phone-call table
}

export async function logCall(formData) {
  const { error } = await db.rpc("log_call", {
    p_contact: formData.get("contact_id"),
    p_rep: formData.get("rep") ?? "",
    p_call_date: formData.get("call_date"),
    p_outcome: formData.get("outcome"),
    p_note: formData.get("note") ?? "",
    p_callback: formData.get("callback_date") || null,
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
