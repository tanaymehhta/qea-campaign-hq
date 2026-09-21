import { staffDb } from "./staff-db.js";
import { mergeNotes } from "./notes.js";

/** Threads for this email only. The argument is the session email, never the request body. */
export async function listThreads(email) {
  const { data, error } = await staffDb()
    .from("hq_threads")
    .select("id, title, created_at")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Null when the thread is missing or belongs to someone else. */
export async function getThread(email, id) {
  const { data, error } = await staffDb()
    .from("hq_threads")
    .select("id, email, title, created_at, accepted_at")
    .eq("id", id)
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createThread(email, title) {
  const { data, error } = await staffDb()
    .from("hq_threads")
    .insert({ email, title: title.slice(0, 80) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function listMessages(threadId) {
  const { data, error } = await staffDb()
    .from("hq_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addMessage(threadId, role, content) {
  const { error } = await staffDb()
    .from("hq_messages")
    .insert({ thread_id: threadId, role, content });
  if (error) throw new Error(error.message);
}

export async function personNotes(email) {
  const { data, error } = await staffDb()
    .from("app_users")
    .select("person_notes")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.person_notes ?? "";
}

/** Append to this email's note only. A miss on the cap writes nothing. */
export async function rememberNote(email, addition) {
  const merged = mergeNotes(await personNotes(email), addition);
  if (!merged.ok) return merged;
  const { error } = await staffDb()
    .from("app_users")
    .update({ person_notes: merged.person_notes })
    .eq("email", email);
  if (error) return { ok: false, error: "The note was not saved." };
  return merged;
}

/** True while this email's thread is still inside a proposal and they have not marked it final. */
export async function proposalInProgress(email, threadId) {
  const { data, error } = await staffDb()
    .from("hq_threads")
    .select("proposal_conversation, accepted_at")
    .eq("id", threadId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.proposal_conversation) && !data?.accepted_at;
}

export async function proposalConversation(threadId) {
  const { data, error } = await staffDb()
    .from("hq_threads")
    .select("proposal_conversation")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.proposal_conversation ?? null;
}

export async function setProposalConversation(threadId, conversation) {
  const { error } = await staffDb()
    .from("hq_threads")
    .update({ proposal_conversation: conversation })
    .eq("id", threadId);
  if (error) throw new Error(error.message);
}

/** The person marked this thread's draft final. Nothing is sent. */
export async function acceptDraft(email, threadId) {
  const thread = await getThread(email, threadId);
  if (!thread) return { error: "No such thread." };
  const messages = await listMessages(threadId);
  if (!messages.some((message) => message.content.includes("[draft-proposal]"))) {
    return { error: "This thread has no proposal draft." };
  }
  if (thread.accepted_at) return { accepted_at: thread.accepted_at };
  const { data, error } = await staffDb()
    .from("hq_threads")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("email", email)
    .select("accepted_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
