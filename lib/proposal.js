import { proposalConversation, setProposalConversation } from "./hq-chat.js";
import { saveStaffFile } from "./staff-files.js";

function safe(text, limit = 1500) {
  return String(text ?? "").replace(/https?:\/\/\S+/g, "[url]").slice(0, limit);
}

/**
 * One turn of the open-source proposal agent (Code/proposal_service).
 * That agent loads the qea-proposal skill and runs measure, price, and
 * build. This function does not write a proposal itself.
 * The file it returns is a draft. accepted_at is set only by the accept route.
 */
export async function draftProposal({ threadId, email, message, fresh }) {
  const base = (process.env.PROPOSAL_SERVICE_URL || "").replace(/\/$/, "");
  if (!base) return { agent: true, refused: true, message: "The proposal service is not configured. No file was written." };

  const prior = fresh ? null : await proposalConversation(threadId);
  let data;
  try {
    const res = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, conversation: prior }),
      signal: AbortSignal.timeout(55000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return { agent: true, refused: true, message: "The proposal service did not answer. No file was written." };
    }
  } catch {
    return { agent: true, refused: true, message: "The proposal service did not answer. No file was written." };
  }

  if (data.conversation) {
    try { await setProposalConversation(threadId, data.conversation); } catch { /* the draft can still be returned */ }
  }

  if (!data.docx_base64) {
    const output = safe(data.output) || "The proposal service needs more detail. No file was written.";
    if (/proposal is ready|final recap/i.test(output)) {
      return {
        agent: true,
        draftText: true,
        message: `Draft only. No file came back, so nothing was saved here. It is not final, and nothing was sent.\n\n${output}`,
      };
    }
    return { agent: true, refused: false, message: output };
  }

  const file = await saveStaffFile({
    email,
    bytes: Buffer.from(data.docx_base64, "base64"),
    filename: data.docx_filename || "proposal.docx",
  });
  file.draft = true;
  const recap = safe(data.output, 4000).trim();
  return {
    agent: true,
    file,
    message: [recap, "Draft only. It is not final until you mark it final. Nothing was sent."]
      .filter(Boolean)
      .join("\n\n"),
  };
}
