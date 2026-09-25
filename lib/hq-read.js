import { db, meetingCounts, reachedCounts, responseCounts } from "./db.js";

const COLUMNS = [
  "id", "display_name", "slug", "owner", "geography", "segment", "actual_status",
  "running_count", "leads", "sent", "delivered", "bounced", "first_sent_on", "last_sent_on",
].join(", ");

const TANAY = "tanay@qeatech.com";

/**
 * Live campaign groups. The name is the session's, never a model argument.
 * Tanay sees every owner. Everyone else sees only their own rows.
 * Counts here win over a vault page.
 *
 * `v_group_summary.replied` is the vendor's message counter and its `meetings`
 * misses call-booked ones, so responses, reached and meetings come from the
 * same RPCs the /campaigns page and the Overview tiles read.
 */
export async function campaignsForRep(repName, email) {
  const all = String(email || "").toLowerCase() === TANAY;
  let query = db.from("v_group_summary").select(COLUMNS).order("sort_order");
  let lists = db.from("call_campaigns").select("display_name, owner, status");
  if (!all) {
    query = query.eq("owner", repName);
    lists = lists.eq("owner", repName);
  }
  const [{ data, error }, { data: members }, { data: callLists }] = await Promise.all([
    query,
    db.from("campaign_group_members").select("campaign_id, group_id"),
    lists,
  ]);
  if (error) throw new Error(error.message);
  const groups = await Promise.all((data ?? []).map(async ({ id, ...group }) => {
    const campaignIds = (members ?? []).filter((m) => m.group_id === id).map((m) => m.campaign_id);
    const scope = { from: null, to: null, campaignIds, source: null };
    const [responses, reached, meetings] = await Promise.all([
      responseCounts(scope),
      reachedCounts(scope),
      meetingCounts({ ...scope, groupIds: [id] }),
    ]);
    return {
      ...group,
      people_reached: reached.people,
      opened: reached.opened,
      open_trackable: reached.trackable,
      people_responded: responses.responded,
      interested: responses.interested,
      unread_replies: responses.needs_label,
      meetings: meetings.meetings,
    };
  }));
  return { rep_name: repName, scope: all ? "all" : "own", groups, call_lists: callLists ?? [] };
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
    return `${group.display_name} (${who}${where}): ${group.actual_status}, ${group.running_count ?? "—"} running, ${group.leads ?? "—"} leads, ${group.sent ?? "—"} sent, ${group.people_responded ?? "—"} responded, ${group.meetings ?? "—"} meetings. Last sent ${group.last_sent_on || "—"}.`;
  });
  const header = all
    ? "Live counts for every campaign in Campaign HQ. These win over the vault."
    : `Live counts for ${result.rep_name} from Campaign HQ. These win over the vault.`;
  return `${header}\n${lines.join("\n")}`;
}
