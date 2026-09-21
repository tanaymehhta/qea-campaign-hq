import { forcedTool } from "./hq-tools.js";
import { renderCampaigns } from "./hq-read.js";

/** What the person sees. A refused chip does not keep the model's own document. */
export function assistantText({ userText, resultText, outputs }) {
  const forced = forcedTool(userText);
  const list = (outputs ?? []).filter(Boolean);
  const refused = list.find((item) => item.refused);
  const withFile = list.find((item) => item.file);
  const campaigns = list.find((item) => item.campaigns);
  let text = "";
  if (withFile) text = withFile.message || String(resultText ?? "").trim();
  else if (refused) text = refused.message;
  else if (forced === "hq_campaigns" && campaigns) text = renderCampaigns(campaigns.campaigns);
  else {
    text = String(resultText ?? "").trim()
      || list.map((item) => item.message).filter(Boolean).join("\n\n")
      || "The model returned no text.";
  }
  for (const item of list) {
    if (item.file) {
      text += `\n\n[file:${item.file.id}:${item.file.filename}]`;
      if (item.file.draft) text += "\n[draft-proposal]";
    } else if (item.draftText) {
      text += "\n[draft-proposal]";
    }
  }
  return text.trim();
}
