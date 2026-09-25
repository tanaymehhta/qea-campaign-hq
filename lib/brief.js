import { saveStaffFile } from "./staff-files.js";

/** The vault hits as one block of text the brief agent reads before it searches the web. */
export function vaultExcerpts(hits) {
  return (hits ?? [])
    .filter((hit) => !hit.narrative)
    .map((hit) => {
      const stale = hit.tier === "REFERENCE" || hit.tier === "UNLISTED"
        ? ` (${hit.tier}: background only, do not quote as current)`
        : "";
      return `From ${hit.path}, ${hit.heading}${stale}:\n${hit.text}`;
    })
    .join("\n\n");
}

/**
 * One brief from the open-source brief agent (Code/brief_service).
 * That agent loads the qea-meeting-brief skill, researches the web with Exa,
 * and builds the docx. This function does not write a brief itself.
 */
export async function draftBrief({ threadId, email, subject, vault }) {
  const base = (process.env.BRIEF_SERVICE_URL || "").replace(/\/$/, "");
  if (!base) return { agent: true, refused: true, message: "The brief service is not configured. No file was written." };

  let data;
  try {
    const res = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.BRIEF_SERVICE_TOKEN || ""}`,
      },
      body: JSON.stringify({ message: `Make a meeting brief for ${subject}`, vault_excerpts: vault || null }),
      signal: AbortSignal.timeout(290000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return { agent: true, refused: true, message: "The brief service did not answer. No file was written." };
    }
  } catch {
    return { agent: true, refused: true, message: "The brief service did not answer. No file was written." };
  }

  // The service sums OpenRouter's usage.cost, and Exa's search bill is spend too.
  const cost = (Number(data.cost_usd) || 0) + (Number(data.exa_cost_usd) || 0);
  const output = String(data.output ?? "").trim();
  if (!data.docx_base64) {
    return { agent: true, cost, refused: !output, message: output || "The brief service returned no brief. No file was written." };
  }
  const file = await saveStaffFile({
    email,
    bytes: Buffer.from(data.docx_base64, "base64"),
    filename: data.docx_filename || "QEA_Building_Intelligence_Brief.docx",
    threadId,
    kind: "brief",
  });
  return { agent: true, cost, file, message: output || `Brief for ${subject} is ready.` };
}
