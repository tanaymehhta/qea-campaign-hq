import { db, everyRow } from "../../../lib/db";

/**
 * Everyone on one campaign's lists, so the meetings form can be picked from
 * instead of typed into.
 *
 * Retyping a name and a company is how the audit's duplicates were made —
 * "1287 East 19th Condominium" in one row and "Condo" in the next. The form
 * asks for the campaign first and then offers the people on it; the address
 * and the company come off the row we already hold.
 *
 * Fetched here rather than rendered into the page because the five groups hold
 * ~2,700 people between them, and /meetings would carry all of them on every
 * load to be ready for a form that is usually left closed.
 */
export const dynamic = "force-dynamic";

export async function GET(request) {
  const group = new URL(request.url).searchParams.get("group");
  if (!group) return Response.json([]);

  const { data: members } = await db
    .from("campaign_group_members").select("campaign_id").eq("group_id", group);
  const ids = (members ?? []).map((m) => m.campaign_id);
  if (!ids.length) return Response.json([]);

  // Paged: 2,700 people over five groups is already past PostgREST's 1,000-row
  // ceiling, and past it there is no error — the list just quietly stops.
  const rows = await everyRow(() =>
    db.from("people").select("name, email, company").in("campaign_id", ids).order("email")
  );

  // One entry per address, the same identity rule the meetings list groups by.
  const byEmail = new Map();
  for (const r of rows) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const seen = byEmail.get(email);
    // Keep the fullest version of a person who is on two lists of one campaign.
    if (!seen || (!seen.name && r.name) || (!seen.company && r.company)) {
      byEmail.set(email, { name: r.name ?? "", email, company: r.company ?? "" });
    }
  }
  return Response.json(
    [...byEmail.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  );
}
