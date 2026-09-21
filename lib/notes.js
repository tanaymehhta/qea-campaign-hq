export const NOTES_CAP = 2000;

/** Append one line to this person's note. Over the cap, nothing is saved. */
export function mergeNotes(current, addition) {
  const extra = String(addition ?? "").trim();
  if (!extra) return { ok: false, error: "Nothing to remember." };
  const next = [String(current ?? "").trim(), extra].filter(Boolean).join("\n");
  if (next.length > NOTES_CAP) {
    return {
      ok: false,
      error: `That would be ${next.length} characters. The cap is ${NOTES_CAP}. Nothing was saved.`,
    };
  }
  return { ok: true, person_notes: next };
}
