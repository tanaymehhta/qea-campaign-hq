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
    // The agent often writes the typical figure and the choices as two
    // separate brackets — "(typical ~$5,300) ($4,500, $5,300, $6,000)" — so
    // read every bracket and take the first that is a list, not a note.
    const brackets = [...tail.matchAll(/\(([^)]*)\)/g)].map((hit) => hit[1].trim());
    const listed = brackets
      .filter((inside) => !NOT_OPTIONS.test(inside))
      .map((inside) => inside.split(/,\s*(?!\d)/).map((part) => part.trim()).filter(Boolean))
      .find((parts) => parts.length > 1);
    const options = listed ?? [];
    // Whatever bracket was not the list is the note under the question.
    const inside = brackets.find((one) => one !== listed?.join(", ")) ?? "";
    items.push({
      question: match[1].trim(),
      options,
      fallback: tail.match(/\[default\s+([^\]]+)\]/i)?.[1]?.trim() ?? "",
      hint: inside,
    });
  }
  // The agent now asks two things (drone, margin) plus any missing name,
  // so the step UI has to trigger on two — not the ten-line block it used to send.
  if (items.length < 2) return null;
  return { intro: intro.join(" "), items };
}
