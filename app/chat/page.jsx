import { requireUser } from "../../lib/auth";
import { getThread, listMessages, listThreads, personNotes } from "../../lib/hq-chat";
import ChatBox from "./chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat — QEA Campaign HQ" };

export default async function ChatPage({ searchParams }) {
  const user = await requireUser();

  if (!user.rep_name) {
    return (
      <main className="card" style={{ maxWidth: 520, padding: 28 }}>
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Chat needs a rep name</h1>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {user.email} can sign in, and has no name in app_users yet. Ask Tanay to add the row.
          Until then this page cannot keep a thread or answer from your campaigns.
        </p>
      </main>
    );
  }

  const threads = await listThreads(user.email);
  const requested = searchParams?.t;
  const thread = requested ? await getThread(user.email, requested) : null;
  const messages = thread ? await listMessages(thread.id) : [];
  const notes = await personNotes(user.email);

  // One row instead of the sidebar: a new chat, the earlier ones folded into a
  // menu, and the note. The page below it is nothing but the thread.
  return (
    <main className="chatmode">
      <div className="chathead">
        <a className="choice" href="/chat">New chat</a>
        {threads.length ? (
          <details className="threads">
            <summary>
              Earlier chats <b style={{ color: "var(--ink-3)", fontWeight: 400 }}>{threads.length}</b>
            </summary>
            <div className="menu">
              {threads.map((t) => (
                <a key={t.id} href={`/chat?t=${t.id}`} className={t.id === thread?.id ? "on" : ""}>
                  {t.title || "Chat"}
                </a>
              ))}
            </div>
          </details>
        ) : null}
        <p className="note">
          {notes.trim() ? "A note is saved for you." : "Nothing saved about you yet."}
        </p>
      </div>
      <ChatBox thread={thread} messages={messages} accepted={Boolean(thread?.accepted_at)} />
    </main>
  );
}
