import { db } from "./db.js";

const COLUMNS = [
  "display_name", "slug", "owner", "geography", "segment", "actual_status",
  "running_count", "leads", "sent", "replied", "meetings", "last_sent_on",
].join(", ");

/**
 * Live campaign groups for one rep_name. The name is the session's, never a
 * model argument. Counts here win over a vault page.
 */
export async function campaignsForRep(repName) {
  const { data, error } = await db
    .from("v_group_summary")
    .select(COLUMNS)
    .eq("owner", repName)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return { rep_name: repName, groups: data ?? [] };
}

export function renderCampaigns(result) {
  const groups = result?.groups ?? [];
  if (!groups.length) return `${result?.rep_name ?? "This person"} has no campaign groups in Campaign HQ.`;
  const lines = groups.map((group) => {
    const where = group.geography || group.segment || "no geography";
    return `${group.display_name} (${where}): ${group.actual_status}, ${group.leads ?? "—"} leads, ${group.sent ?? "—"} sent, ${group.replied ?? "—"} replied, ${group.meetings ?? "—"} meetings. Last sent ${group.last_sent_on || "—"}.`;
  });
  return `Live counts for ${result.rep_name} from Campaign HQ. These win over the vault.\n${lines.join("\n")}`;
}
