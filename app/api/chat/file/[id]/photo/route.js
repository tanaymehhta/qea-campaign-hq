import { currentUser } from "../../../../../../lib/auth";
import { listPhotos, replacePhoto } from "../../../../../../lib/docx-photos";
import { latestVersion, readStaffFile, saveStaffFile } from "../../../../../../lib/staff-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Under Vercel's 4.5 MB request limit, with room for the form around it.
const MAX_BYTES = 4 * 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's own header, or null when the bytes are not a PNG. */
function pngSize(bytes) {
  if (bytes.length < 24 || PNG.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = { width: view.getUint32(16), height: view.getUint32(20) };
  return size.width >= 1 && size.width <= 10000 && size.height >= 1 && size.height <= 10000 ? size : null;
}

/**
 * Replace one building photo, as a new version of the newest version of this
 * document. No model call and no proposal-service call: the image is swapped
 * inside the .docx here, and nothing is overwritten.
 */
export async function POST(req, { params }) {
  const user = await currentUser();
  if (!user?.rep_name) return Response.json({ error: "Sign in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const rel = String(form?.get("rel") ?? "");
  const image = form?.get("image");
  if (!/^rIdProp\d*$/.test(rel) || !(image instanceof Blob)) {
    return Response.json({ error: "Send the photo and which one it replaces." }, { status: 400 });
  }
  if (image.size > MAX_BYTES) return Response.json({ error: "That image is over 4 MB." }, { status: 413 });
  const png = new Uint8Array(await image.arrayBuffer());
  // The size comes from the file, never from the client.
  const size = pngSize(png);
  if (!size) return Response.json({ error: "That is not a PNG image." }, { status: 400 });

  // Edits apply to the newest version, so two tabs never fork the history.
  const latest = await latestVersion(user.email, params.id);
  const bytes = latest && (await readStaffFile(user.email, latest.id));
  if (!bytes) return Response.json({ error: "No such file." }, { status: 404 });
  const n = (await listPhotos(bytes)).findIndex((p) => p.rel === rel) + 1;
  if (!n) return Response.json({ error: "That photo is not in this file." }, { status: 404 });

  const change = `Photo ${n} replaced`;
  const saved = await saveStaffFile({
    email: user.email,
    bytes: await replacePhoto(bytes, rel, png, size),
    filename: latest.filename,
    parent: latest,
    change,
  });
  return Response.json({ id: saved.id, version: latest.version + 1, change });
}
