import { requireUser } from "../../lib/auth";
import { getThread, listMessages, listThreads } from "../../lib/hq-chat";
import { listFiles } from "../../lib/staff-files";
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

  const [threads, files] = await Promise.all([listThreads(user.email), listFiles(user.email)]);
  const requested = searchParams?.t;
  const thread = requested ? await getThread(user.email, requested) : null;
  const messages = thread ? await listMessages(thread.id) : [];

  // No row of buttons: one quiet line naming the chat you are in, and the menu
  // behind it holds the new chat and the earlier ones. Nothing to look at when
  // there is nothing to switch to.
  return (
    <main className="chatmode">
      {/* the row stays even when it is empty: it is the grid's first track */}
      <div className="chathead">
        {threads.length ? (
          <details className="threads">
            <summary>{thread?.title || "New chat"}</summary>
            <div className="menu">
              <a href="/chat" className={thread ? "" : "on"}>New chat</a>
              {threads.map((t) => (
                <a key={t.id} href={`/chat?t=${t.id}`} className={t.id === thread?.id ? "on" : ""}>
                  {t.title || "Chat"}
                </a>
              ))}
            </div>
          </details>
        ) : null}
        {/* Every file this person has made, newest version of each. Older
            versions are on the chat card and on /files. */}
        {files.length ? (
          <details className="threads">
            <summary>Files ({files.length})</summary>
            <div className="menu">
              {files.map((f) => (
                <a key={f.root_id} href={`/api/chat/file/${f.id}?name=${encodeURIComponent(f.filename)}`} download={f.filename}>
                  {f.filename}
                </a>
              ))}
              <a href="/files">All versions</a>
            </div>
          </details>
        ) : null}
      </div>
      <ChatBox thread={thread} messages={messages} accepted={Boolean(thread?.accepted_at)} />
    </main>
  );
}
