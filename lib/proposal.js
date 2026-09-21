import { proposalConversation, setProposalConversation } from "./hq-chat.js";
import { saveStaffFile } from "./staff-files.js";

function safe(text) {
  return String(text ?? "").replace(/https?:\/\/\S+/g, "[url]").slice(0, 1500);
}

/**
 * One turn of the existing proposal service. The file it returns is a draft.
 * accepted_at is set only by the accept route, after the person says so.
 */
export async function draftProposal({ threadId, email, client, address, details }) {
  const base = (process.env.PROPOSAL_SERVICE_URL || "").replace(/\/$/, "");
  if (!base) return { refused: true, message: "The proposal service is not configured. No file was written." };

  const prior = await proposalConversation(threadId);
  const extra = details ? ` ${details}` : "";
  let data;
  try {
    const res = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `Create a proposal for ${client} at ${address}.${extra} If a fact was not in this message, ask. Do not invent square footage or a price input.`,
        conversation: prior,
      }),
      signal: AbortSignal.timeout(45000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return { refused: true, message: "The proposal service did not answer. No file was written." };
    }
  } catch {
    return { refused: true, message: "The proposal service did not answer. No file was written." };
  }

  if (data.conversation) {
    try { await setProposalConversation(threadId, data.conversation); } catch { /* the draft can still be returned */ }
  }

  if (!data.docx_base64) {
    const output = safe(data.output) || "The proposal service needs more detail. No file was written.";
    if (/proposal is ready|final recap/i.test(output)) {
      return {
        draftText: true,
        message: `Draft only. No file came back, so nothing was saved here. It is not final, and nothing was sent.\n\n${output}`,
      };
    }
    return { refused: false, message: output };
  }

  const file = await saveStaffFile({
    email,
    bytes: Buffer.from(data.docx_base64, "base64"),
    filename: data.docx_filename || "proposal.docx",
  });
  file.draft = true;
  return {
    file,
    message: "Draft only. It is not final until you mark it final. Nothing was sent.",
  };
}
