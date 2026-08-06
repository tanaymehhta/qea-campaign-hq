"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * The one write this page owns. log_meeting() validates everything —
 * required name/date, email shape, evidence enum, duplicate refusal —
 * so this only ferries the form and shows the database's sentence in a
 * banner when it refuses (the done() pattern from app/calls/actions.js).
 */
export async function logMeeting(formData) {
  const rep = (formData.get("rep") ?? "").trim();
  const back = rep ? `/meetings?rep=${encodeURIComponent(rep)}` : "/meetings";
  const { error } = await db.rpc("log_meeting", {
    p_name: formData.get("name") ?? "",
    p_email: formData.get("email") ?? "",
    p_company: formData.get("company") ?? "",
    p_date: formData.get("date"),
    p_group: formData.get("group") || null,
    p_evidence: formData.get("evidence") ?? "chat",
    p_note: formData.get("note") ?? "",
    p_logged_by: formData.get("logged_by") ?? "",
  });
  if (error) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}err=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/meetings");
  revalidatePath("/");
  redirect(`${back}${back.includes("?") ? "&" : "?"}logged=1`);
}
