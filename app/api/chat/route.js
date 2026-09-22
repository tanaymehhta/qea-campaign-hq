import { createOpenAI } from "@ai-sdk/openai";
import { isStepCount, ToolLoopAgent } from "ai";
import { currentUser } from "../../../lib/auth";
import { addMessage, createThread, getThread, listMessages, personNotes, proposalInProgress } from "../../../lib/hq-chat";
import { instructionsFor } from "../../../lib/hq-prompt";
import { assistantText } from "../../../lib/hq-reply";
import { proposalRoute, toolsFor } from "../../../lib/hq-tools";
import { draftProposal } from "../../../lib/proposal";
import { loadVaultIndex } from "../../../lib/vault-store";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What the person sees while a tool runs, instead of a made-up thought. */
const DOING = {
  vault_read: "Reading the wiki",
  hq_campaigns: "Reading Campaign HQ",
  remember: "Saving your note",
  create_meeting_brief: "Writing the brief",
  draft_proposal: "Calling the proposal agent",
};

/**
 * The answer, preceded by status lines. Every line that starts with \u001f is a
 * status the client shows in place of the pill; the answer follows and is the
 * only thing stored on the thread.
 */
function streamed(headers, work) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const say = (label) => controller.enqueue(enc.encode(`\u001f${label}\n`));
      let text;
      try {
        text = await work(say);
      } catch (err) {
        text = safeError(err);
      }
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

function safeError(err) {
  const msg = String(err?.message || err || "");
  if (/sk-|api[_-]?key|bearer|service_role/i.test(msg)) return "The model call failed.";
  return msg.slice(0, 300) || "The model call failed.";
}

/**
 * One route for every person. The email comes from the session, and every
 * thread read or write includes that email. The body cannot name another user.
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in." }, { status: 401 });
  if (!user.rep_name) {
    return Response.json(
      { error: `${user.email} has no rep name yet. Ask Tanay to add the row in app_users.` },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ error: "Empty message." }, { status: 400 });
  if (text.length > 8000) return Response.json({ error: "Message is too long." }, { status: 400 });

  let threadId = body.threadId || null;
  if (threadId) {
    const thread = await getThread(user.email, threadId);
    if (!thread) return Response.json({ error: "No such thread." }, { status: 404 });
  } else {
    threadId = await createThread(user.email, text);
  }

  await addMessage(threadId, "user", text);
  const history = await listMessages(threadId);
  const notes = await personNotes(user.email);
  const headers = {
    "X-Thread-Id": threadId,
    "content-type": "text/plain; charset=utf-8",
    "x-accel-buffering": "no",
  };

  const open = await proposalInProgress(user.email, threadId).catch(() => false);
  const turn = proposalRoute(text, open);
  if (turn.to === "refuse") {
    const reply = "A proposal needs a client and an address you named. I will not invent either, and no file was written.";
    await addMessage(threadId, "assistant", reply);
    return new Response(reply, { headers });
  }
  if (turn.to === "service") {
    return streamed(headers, async (say) => {
      say(DOING.draft_proposal);
      let output;
      try {
        output = await draftProposal({
          threadId,
          email: user.email,
          message: turn.message,
          fresh: turn.fresh,
        });
      } catch (err) {
        output = { refused: true, message: safeError(err) };
      }
      const reply = assistantText({ userText: text, resultText: "", outputs: output ? [output] : [] });
      await addMessage(threadId, "assistant", reply);
      return reply;
    });
  }
  if (turn.to === "other") {
    return streamed(headers, async (say) => {
      say(DOING[turn.call.name] || `Using ${turn.call.name}`);
      const tools = toolsFor({
        email: user.email,
        repName: user.rep_name,
        threadId,
        userText: text,
      });
      let output;
      try {
        output = await tools[turn.call.name].execute(turn.call.input);
      } catch (err) {
        output = { refused: true, message: safeError(err) };
      }
      const reply = assistantText({ userText: text, resultText: "", outputs: output ? [output] : [] });
      await addMessage(threadId, "assistant", reply);
      return reply;
    });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    const reply = "The model key is not set on this server yet. Your message is saved on your thread.";
    await addMessage(threadId, "assistant", reply);
    return new Response(reply, { headers });
  }

  return streamed(headers, async (say) => {
    const vaultIndex = await loadVaultIndex().catch(() => []);
    const openrouter = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: key,
    });
    const agent = new ToolLoopAgent({
      model: openrouter.chat(process.env.OPENROUTER_MODEL || "qwen/qwen3.7-max"),
      instructions: instructionsFor({
        displayName: user.display_name,
        email: user.email,
        repName: user.rep_name,
        personNotes: notes,
        vaultIndex,
      }),
      tools: toolsFor({
        email: user.email,
        repName: user.rep_name,
        threadId,
        userText: text,
      }),
      stopWhen: isStepCount(6),
    });

    let result;
    try {
      result = await agent.generate({
        messages: history.map((message) => ({ role: message.role, content: message.content })),
        onToolExecutionStart: ({ toolCall }) => {
          const name = toolCall?.toolName;
          if (name) say(DOING[name] || `Using ${name}`);
        },
      });
    } catch (err) {
      const failed = safeError(err);
      await addMessage(threadId, "assistant", failed);
      return failed;
    }

    const outputs = (result.staticToolResults ?? []).map((item) => item.output).filter(Boolean);
    const reply = assistantText({ userText: text, resultText: result.text, outputs });
    await addMessage(threadId, "assistant", reply);
    return reply;
  });
}
