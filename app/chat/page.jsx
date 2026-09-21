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

  return (
    <main style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start" }}>
      <aside className="card" style={{ padding: 12 }}>
        <a className="choice" href="/chat" style={{ display: "inline-flex", alignItems: "center", marginBottom: 10 }}>
          New chat
        </a>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {threads.map((t) => (
            <a
              key={t.id}
              href={`/chat?t=${t.id}`}
              style={{
                fontSize: 13,
                lineHeight: 1.35,
                color: t.id === thread?.id ? "var(--ink-1)" : "var(--ink-2)",
                fontWeight: t.id === thread?.id ? 600 : 400,
                textDecoration: "none",
              }}
            >
              {t.title || "Chat"}
            </a>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "14px 0 0", lineHeight: 1.45 }}>
          {notes.trim() ? "A note is saved for you." : "Nothing saved about you yet."}
        </p>
      </aside>
      <ChatBox thread={thread} messages={messages} accepted={Boolean(thread?.accepted_at)} />
    </main>
  );
}
