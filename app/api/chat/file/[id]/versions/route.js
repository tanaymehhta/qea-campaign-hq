import { currentUser } from "../../../../../../lib/auth";
import { listVersions } from "../../../../../../lib/staff-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every version of this document, oldest first, for its owner only. */
export async function GET(req, { params }) {
  const user = await currentUser();
  if (!user?.rep_name) return Response.json({ error: "Sign in." }, { status: 401 });
  const rows = await listVersions(user.email, params.id);
  if (!rows.length) return Response.json({ error: "No such file." }, { status: 404 });
  return Response.json(rows.map(({ id, change, created_at, filename }) => ({ id, change, created_at, filename })));
}
