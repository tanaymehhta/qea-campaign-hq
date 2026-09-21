import crypto from "crypto";
import { staffDb } from "./staff-db.js";
import { ensureBucket } from "./vault-store.js";

const BUCKET = "staff-files";

export function safeFilename(name) {
  const cleaned = String(name ?? "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "download.docx").slice(0, 80);
}

/** Private object at {email}/{id}.docx. Another email's prefix is a different path. */
export async function saveStaffFile({ email, bytes, filename }) {
  await ensureBucket(BUCKET);
  const id = crypto.randomUUID();
  const { error } = await staffDb().storage.from(BUCKET).upload(`${email}/${id}.docx`, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return { id, filename: safeFilename(filename) };
}

export async function readStaffFile(email, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await staffDb().storage.from(BUCKET).download(`${email}/${id}.docx`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
