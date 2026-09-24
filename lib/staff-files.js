import crypto from "crypto";
import { staffDb } from "./staff-db.js";
import { ensureBucket } from "./vault-store.js";

const BUCKET = "staff-files";

export function safeFilename(name) {
  const cleaned = String(name ?? "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "download.docx").slice(0, 80);
}

/**
 * Private object at {email}/{id}.docx, plus its row in staff_files. Another
 * email's prefix is a different path. With `parent` the file is a new version
 * of that one: the old object is never overwritten.
 */
export async function saveStaffFile({ email, bytes, filename, threadId, kind, parent, change }) {
  await ensureBucket(BUCKET);
  const db = staffDb();
  const id = crypto.randomUUID();
  const name = safeFilename(filename);
  const { error } = await db.storage.from(BUCKET).upload(`${email}/${id}.docx`, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { error: rowError } = await db.from("staff_files").insert({
    id,
    email,
    thread_id: parent ? parent.thread_id : threadId ?? null,
    kind: parent ? parent.kind : kind,
    filename: name,
    root_id: parent ? parent.root_id : id,
    parent_id: parent ? parent.id : null,
    change: change ?? "Generated",
  });
  if (rowError) throw new Error(rowError.message);
  return { id, filename: name };
}

export async function readStaffFile(email, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await staffDb().storage.from(BUCKET).download(`${email}/${id}.docx`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * The newest version of the document `id` belongs to, with `version` = how
 * many there are. Null when `id` is not this email's.
 */
export async function latestVersion(email, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = staffDb();
  const { data: row, error } = await db.from("staff_files").select("root_id").eq("id", id).eq("email", email).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const { data: rows, error: listError } = await db
    .from("staff_files")
    .select("*")
    .eq("root_id", row.root_id)
    .eq("email", email)
    .order("created_at", { ascending: true });
  if (listError) throw new Error(listError.message);
  return { ...rows[rows.length - 1], version: rows.length };
}
