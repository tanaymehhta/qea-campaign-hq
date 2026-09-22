"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * The one write this page owns.
 *
 * /leads was read-only until 21 Aug: a person could arrive from the vendor
 * sync, from a July spreadsheet, or as a side effect of logging a meeting, and
 * by no other route. Somebody handed over by a client had to be met before the
 * page whose job is "check here before you contact anybody" had ever heard of
 * them.
 *
 * add_lead() validates all of it — name, address shape, the five-value status,
 * the campaign, whether this person is already known — and, if the meeting box
 * is ticked, calls log_meeting in the same transaction so the two cannot
 * half-happen. This only ferries the form and shows the database's own sentence
 * when it refuses. The done() pattern from app/calls/actions.js.
 */
export async function addLead(formData) {
  const back = (formData.get("back") || "/leads").toString();
  const sep = back.includes("?") ? "&" : "?";

  const { error } = await db.rpc("add_lead", {
    p_name: formData.get("name") ?? "",
    p_email: formData.get("email") ?? "",
    p_company: formData.get("company") ?? "",
    p_title: formData.get("title") ?? "",
    p_phone: formData.get("phone") ?? "",
    p_group: formData.get("group") || null,
    p_status: formData.get("status") ?? "prospect",
    p_added_by: formData.get("added_by") ?? "",
    // A real meeting or no meeting. The checkbox is absent from the form data
    // when it is unticked, which is the whole of the boolean.
    p_met: !!formData.get("met"),
    p_date: formData.get("date") || null,
    p_booked_on: formData.get("booked_on") || null,
    p_evidence: formData.get("evidence") ?? "chat",
    p_note: formData.get("note") ?? "",
  });

  if (error) {
    redirect(`${back}${sep}err=${encodeURIComponent(error.message)}`, "replace");
  }
  revalidatePath("/leads");
  revalidatePath("/meetings");
  revalidatePath("/");
  // Land on the person just added rather than on wherever the filters were:
  // the thing you want to see next is the row you just wrote.
  redirect(`/leads?q=${encodeURIComponent((formData.get("email") ?? "").toString().trim())}&added=1`, "replace");
}
