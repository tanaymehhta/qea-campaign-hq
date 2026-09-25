import { tool } from "ai";
import { z } from "zod";
import { draftBrief, vaultExcerpts } from "./brief.js";
import { campaignsForRep } from "./hq-read.js";
import { rememberNote } from "./hq-chat.js";
import { draftProposal } from "./proposal.js";
import { readVault, searchVault } from "./vault-store.js";

const CHIPS = ["create a proposal", "research a campaign", "create a meeting brief"];

/** The value has to be something the person actually typed, not a chip label. */
export function namedByUser(userText, value) {
  const text = String(value ?? "").trim();
  if (text.length < 3) return false;
  const low = text.toLowerCase();
  if (CHIPS.some((chip) => chip === low || chip.includes(low))) return false;
  return String(userText ?? "").toLowerCase().includes(low);
}

/**
 * Chips and the sentences that start the same way run their tool here.
 * The model was not supplying the required call, and a missing call must
 * not become an invented document.
 */
export function forcedCall(userText) {
  const text = String(userText ?? "").trim();
  if (/^research a campaign\b/i.test(text)) return { name: "hq_campaigns", input: {} };
  if (/^create a meeting brief\b/i.test(text)) {
    const subject = text
      .replace(/^create a meeting brief\b/i, "")
      .replace(/^[\s:,-]+/, "")
      .replace(/^for\s+/i, "")
      .trim();
    return { name: "create_meeting_brief", input: { subject } };
  }
  if (/^create a proposal\b/i.test(text)) {
    const match = text.match(/^create a proposal\s+for\s+(.+?)\s+at\s+(.+)$/i);
    return {
      name: "draft_proposal",
      input: { client: match?.[1]?.trim() ?? "", address: match?.[2]?.trim() ?? "" },
    };
  }
  if (/^remember that\b/i.test(text)) {
    return { name: "remember", input: { note: text.replace(/^remember that\s+/i, "").trim() } };
  }
  return null;
}

export function forcedTool(userText) {
  return forcedCall(userText)?.name ?? null;
}

/**
 * A proposal turn goes to the open-source proposal agent.
 * The first message has to name a client and an address.
 * A later message on that same thread is the rep's answer, sent on as they typed it.
 */
export function proposalRoute(userText, inProgress) {
  const call = forcedCall(userText);
  if (call?.name === "draft_proposal") {
    // The bare chip names nobody. That is a question to ask, not a refusal.
    if (!call.input.client || !call.input.address) return { to: "model" };
    return { to: "service", message: String(userText).trim(), fresh: true };
  }
  if (call) return { to: "other", call };
  if (inProgress) return { to: "service", message: String(userText).trim(), fresh: false };
  return { to: "model" };
}

export function toolsFor({ email, repName, threadId, userText, saidByUser }) {
  // A client named two turns ago is still a client the rep named. The guard
  // reads everything they have typed on this thread, not just this turn —
  // checking one line made "Bob" then "444 Somerville Ave" unanswerable.
  const said = saidByUser || userText;
  return {
    vault_read: tool({
      description: "Read one published wiki page by its path. A large page needs a section heading. REFERENCE and UNLISTED pages are marked do-not-quote. Narrative pages are not the live counts.",
      inputSchema: z.object({
        path: z.string().describe("Path such as wiki/company/qea-overview.md"),
        section: z.string().optional().describe("Heading to return when the page is large"),
      }),
      execute: async ({ path, section }) => {
        try {
          const read = await readVault(path, section);
          return { refused: !read.ok, message: read.text };
        } catch {
          return { refused: true, message: "vault_read failed. No page was opened." };
        }
      },
    }),
    hq_campaigns: tool({
      description: String(email || "").toLowerCase() === "tanay@qeatech.com"
        ? "Live campaign groups for every owner. No name argument. These counts win over the vault."
        : "Live campaign groups for the signed-in rep only. No name argument. These counts win over the vault.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const campaigns = await campaignsForRep(repName, email);
          return { campaigns };
        } catch {
          return { refused: true, message: "Campaign HQ could not be read." };
        }
      },
    }),
    remember: tool({
      description: "Append a note the person just asked to remember. Their note only. Cap 2000 characters.",
      inputSchema: z.object({
        note: z.string().describe("The exact thing they asked to remember"),
      }),
      execute: async ({ note }) => {
        const cleaned = String(note ?? "").replace(/^remember that\s+/i, "").trim();
        if (cleaned.length < 3 || !userText.toLowerCase().includes(cleaned.toLowerCase())) {
          return { refused: true, message: "Nothing was saved. Repeat the exact thing to remember." };
        }
        try {
          const saved = await rememberNote(email, cleaned);
          if (!saved.ok) return { refused: true, message: saved.error };
          return { message: "Saved to your note." };
        } catch {
          return { refused: true, message: "The note was not saved." };
        }
      },
    }),
    create_meeting_brief: tool({
      description: "Research and write a meeting brief, only when the person named a building, company, or person. The open-source brief agent searches the web and the vault excerpts and writes the file. Do not invent a brief.",
      inputSchema: z.object({
        subject: z.string().describe("The building, company, or person they named, with any context they gave"),
      }),
      execute: async ({ subject }) => {
        if (!namedByUser(said, subject)) {
          return {
            refused: true,
            message: "A meeting brief needs the building, company, or person you named. I will not invent one, and no file was written.",
          };
        }
        try {
          // What QEA already has on file goes in with the subject. A vault miss
          // is not a refusal any more: the agent researches the web either way.
          const hits = await searchVault(subject).catch(() => []);
          return await draftBrief({ threadId, email, subject, vault: vaultExcerpts(hits) });
        } catch {
          return { refused: true, message: "The brief was not written." };
        }
      },
    }),
    draft_proposal: tool({
      description: "Draft a proposal only when the person named a client and an address. The file is a draft until they mark it final. Do not invent the client or the address.",
      inputSchema: z.object({
        client: z.string(),
        address: z.string(),
        details: z.string().optional(),
      }),
      execute: async ({ client, address }) => {
        if (!namedByUser(said, client) || !namedByUser(said, address)) {
          return {
            refused: true,
            message: "A proposal needs a client and an address you named. I will not invent either, and no file was written.",
          };
        }
        try {
          // The agent is handed the client and the address, not the stray
          // line that happened to carry them. "444 somerville avenue" alone
          // left it asking for a name the rep had already given.
          const message = `create a proposal for ${client} at ${address}`;
          return await draftProposal({ threadId, email, message, fresh: true });
        } catch {
          return { refused: true, message: "The proposal was not drafted. No file was written." };
        }
      },
    }),
  };
}
