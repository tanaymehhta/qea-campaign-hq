import { tool } from "ai";
import { z } from "zod";
import { draftBrief, vaultExcerpts } from "./brief.js";
import * as data from "./hq-data.js";
import { campaignsForRep } from "./hq-read.js";
import { rememberNote } from "./hq-chat.js";
import { draftProposal } from "./proposal.js";
import { readVault, searchVault } from "./vault-store.js";

const WINDOW = {
  range: z.enum(["today", "7", "30", "90", "all"]).optional().describe("Named window ending today, New York time. 7 = today and the 6 days before."),
  from: z.string().optional().describe("Start date YYYY-MM-DD, inclusive. Use from/to for calendar months or weeks."),
  to: z.string().optional().describe("End date YYYY-MM-DD, inclusive"),
};

/**
 * Read-only tools over the dashboard, one per area. Scope comes from the
 * session inside hq-data.js; no tool takes a rep name.
 */
const READS = {
  hq_metrics: {
    fn: data.metrics,
    description: "Overview numbers over a window: emails sent (total, by day, by campaign group), people reached, people who responded and were interested, meetings booked. Use for sending volume, trends and response rate.",
    input: { ...WINDOW, compare_previous: z.boolean().optional().describe("Also return the same-length window just before, for 'vs the period before' questions") },
  },
  hq_replies: {
    fn: data.replies,
    description: "People who wrote back, newest first, with their latest reply text. pile: responded (default), interested (includes referral and not_now), not_interested, needs_label (unread), all. tag narrows to one label, e.g. referral. search matches name, email or company.",
    input: {
      ...WINDOW,
      pile: z.enum(["responded", "interested", "not_interested", "needs_label", "all"]).optional(),
      tag: z.enum(["interested", "referral", "not_now", "not_interested", "auto_reply", "unclassified"]).optional(),
      search: z.string().optional(),
    },
  },
  hq_meetings: {
    fn: data.meetings,
    description: "Meetings with person, company, meeting date, booked date, status (booked, held, cancelled), rep and campaign. Window filters on the day it was booked. status: all (default, lists cancelled too), counted (booked + held, what KPIs count).",
    input: { ...WINDOW, status: z.enum(["all", "counted"]).optional() },
  },
  hq_calls: {
    fn: data.calls,
    description: "Phone calls: calls logged, outcomes, by month and list, people actually talked to, callbacks due, do-not-call contacts with reasons, and recent calls with notes.",
    input: WINDOW,
  },
  hq_leads: {
    fn: data.leads,
    description: "The Leads list (email campaigns and call lists): look up a person or company with search, count who has or hasn't been contacted (reached yes/no), optionally inside one campaign group by name.",
    input: {
      search: z.string().optional().describe("Name, email or company"),
      reached: z.enum(["yes", "no"]).optional().describe("yes = contacted, no = never contacted"),
      group: z.string().optional().describe("Campaign group name, e.g. Hospitals"),
    },
  },
  hq_inbound: {
    fn: data.inbound,
    description: "Inbound website visitors (company-wide, every rep sees it): companies that visited, visit counts, people found and ready to email (header_all_time is the queue total; header_for_range only counts companies seen in the range), research verdicts, who reached out, compliance laws, buildings. search opens one company's full research card. outbound: true adds which visiting companies are also on our outbound lists or wrote back to our emails.",
    input: {
      outbound: z.boolean().optional(),
      range: z.enum(["1", "7", "30", "all"]).optional().describe("Rolling days back from now on the company's latest visit"),
      search: z.string().optional().describe("Company name or domain"),
    },
  },
  hq_pipeline: {
    fn: data.pipeline,
    description: "Inbound research pipeline health (company-wide): runs by status, failures, cost in USD and Apollo credits over a window, drafts that pass the gate, webhook parse failures.",
    input: { range: z.enum(["1", "7", "30", "all"]).optional() },
  },
  hq_inboxes: {
    fn: data.inboxes,
    description: "Sending mailboxes: how many, domains, idle ones, which mailboxes send for which campaign, sends and bounces per mailbox over a window.",
    input: WINDOW,
  },
  hq_conflicts: {
    fn: data.conflicts,
    description: "Open data conflicts from the Conflicts page (reply counts that disagree with the vendor, duplicate meetings, missing meeting detail).",
    input: {},
  },
  hq_hubspot: {
    fn: data.hubspot,
    description: "Deals pushed into HubSpot from interested replies: who, deal name, owner, when, stuck pushes. No deal amount or stage is stored.",
    input: {},
  },
};

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
  const reads = Object.fromEntries(Object.entries(READS).map(([name, spec]) => [name, tool({
    description: spec.description,
    inputSchema: z.object(spec.input),
    execute: async (input) => {
      try {
        return await spec.fn(await data.scopeOf(email, repName), input);
      } catch {
        return { refused: true, message: `${name} could not read Campaign HQ.` };
      }
    },
  })]));
  return {
    ...reads,
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
        ? "Live campaign groups for every owner, all time: status, leads, sent, bounced, people reached, opened, people responded, interested, unread, meetings; plus call lists. No name argument. These counts win over the vault."
        : "Live campaign groups for the signed-in rep only, all time: status, leads, sent, bounced, people reached, opened, people responded, interested, unread, meetings; plus their call lists. No name argument. These counts win over the vault.",
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
