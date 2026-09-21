import { currentUser } from "../../../../../lib/auth";
import { readStaffFile, safeFilename } from "../../../../../lib/staff-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A file this email stored. The path is {email}/{id}, so another person misses. */
export async function GET(req, { params }) {
  const user = await currentUser();
  if (!user?.rep_name) return new Response("Sign in.", { status: 401 });
  const bytes = await readStaffFile(user.email, params.id);
  if (!bytes) return new Response("No such file.", { status: 404 });
  const name = safeFilename(new URL(req.url).searchParams.get("name"));
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
