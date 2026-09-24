import { currentUser } from "../../../../../lib/auth";
import { latestVersion, readStaffFile, safeFilename } from "../../../../../lib/staff-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A file this email stored. The path is {email}/{id}, so another person misses.
 * With ?latest=1 it is the newest version of that document instead, and the
 * x-version-* headers say which one it is.
 */
export async function GET(req, { params }) {
  const user = await currentUser();
  if (!user?.rep_name) return new Response("Sign in.", { status: 401 });
  const url = new URL(req.url);
  // A file saved before staff_files existed has no row; it is its own latest.
  const latest = url.searchParams.get("latest") ? await latestVersion(user.email, params.id) : null;
  const bytes = await readStaffFile(user.email, latest?.id ?? params.id);
  if (!bytes) return new Response("No such file.", { status: 404 });
  const name = safeFilename(url.searchParams.get("name"));
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      ...(latest
        ? {
            "x-version-id": latest.id,
            "x-version": String(latest.version),
            "x-version-change": encodeURIComponent(latest.change),
            "x-version-at": latest.created_at,
          }
        : {}),
    },
  });
}
