import { db } from "./db.js";

const COLUMNS = [
  "display_name", "slug", "owner", "geography", "segment", "actual_status",
  "running_count", "leads", "sent", "replied", "meetings", "last_sent_on",
].join(", ");

const TANAY = "tanay@qeatech.com";

/**
 * Live campaign groups. The name is the session's, never a model argument.
 * Tanay sees every owner. Everyone else sees only their own rows.
 * Counts here win over a vault page.
 */
export async function campaignsForRep(repName, email) {
  const all = String(email || "").toLowerCase() === TANAY;
  let query = db.from("v_group_summary").select(COLUMNS).order("sort_order");
  if (!all) query = query.eq("owner", repName);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { rep_name: repName, scope: all ? "all" : "own", groups: data ?? [] };
}

export function renderCampaigns(result) {
  const groups = result?.groups ?? [];
  const all = result?.scope === "all";
  if (!groups.length) {
    return all
      ? "Campaign HQ has no campaign groups."
      : `${result?.rep_name ?? "This person"} has no campaign groups in Campaign HQ.`;
  }
  const lines = groups.map((group) => {
    const where = group.geography || group.segment || "no geography";
    const who = all ? `${group.owner || "no owner"}, ` : "";
    return `${group.display_name} (${who}${where}): ${group.actual_status}, ${group.running_count ?? "—"} running, ${group.leads ?? "—"} leads, ${group.sent ?? "—"} sent, ${group.replied ?? "—"} replied, ${group.meetings ?? "—"} meetings. Last sent ${group.last_sent_on || "—"}.`;
  });
  const header = all
    ? "Live counts for every campaign in Campaign HQ. These win over the vault."
    : `Live counts for ${result.rep_name} from Campaign HQ. These win over the vault.`;
  return `${header}\n${lines.join("\n")}`;
}
