const NOT_OPTIONS = /^(e\.?g\.?|typical|optional|approx|about|such as)/i;

/**
 * The proposal agent asks for everything at once, as one block of lines. Rather
 * than making the rep retype that block in a format, the block is read back
 * into questions and asked one at a time.
 * Null when the message is ordinary prose — then nothing changes.
 */
export function parseQuestions(text) {
  const lines = String(text ?? "").split("\n");
  const items = [];
  const intro = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^[-*\d.)\s]*(.+\?)\s*(.*)$/);
    if (!match) {
      if (!items.length) intro.push(line);
      continue;
    }
    const tail = match[2];
    const inside = tail.match(/\(([^)]*)\)/)?.[1] ?? "";
    const options = NOT_OPTIONS.test(inside.trim())
      ? []
      : inside.split(",").map((part) => part.trim()).filter(Boolean);
    items.push({
      question: match[1].trim(),
      options: options.length > 1 ? options : [],
      fallback: tail.match(/\[default\s+([^\]]+)\]/i)?.[1]?.trim() ?? "",
      hint: options.length > 1 ? "" : inside.trim(),
    });
  }
  if (items.length < 3) return null;
  return { intro: intro.join(" "), items };
}
