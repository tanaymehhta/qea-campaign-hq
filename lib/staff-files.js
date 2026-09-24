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

/** Every version of the document `id` belongs to, oldest first. Empty when `id` is not this email's. */
export async function listVersions(email, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const db = staffDb();
  const { data: row, error } = await db.from("staff_files").select("root_id").eq("id", id).eq("email", email).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return [];
  const { data: rows, error: listError } = await db
    .from("staff_files")
    .select("*")
    .eq("root_id", row.root_id)
    .eq("email", email)
    .order("created_at", { ascending: true });
  if (listError) throw new Error(listError.message);
  return rows ?? [];
}

/**
 * The newest version of the document `id` belongs to, with `version` = how
 * many there are. Null when `id` is not this email's.
 */
export async function latestVersion(email, id) {
  const rows = await listVersions(email, id);
  return rows.length ? { ...rows[rows.length - 1], version: rows.length } : null;
}

/** Everything this email has made, one entry per document, newest activity first. */
export async function listFiles(email) {
  const { data, error } = await staffDb()
    .from("staff_files")
    .select("id, thread_id, kind, filename, root_id, change, created_at")
    .eq("email", email)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  // Tens of rows a person, so grouped here rather than in SQL.
  const docs = new Map();
  for (const row of data ?? []) {
    if (!docs.has(row.root_id)) docs.set(row.root_id, []);
    docs.get(row.root_id).push(row);
  }
  return [...docs.values()]
    .map((versions) => ({ ...versions[versions.length - 1], versions }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
