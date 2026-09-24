import { requireUser } from "../../lib/auth";
import { prettyWhen } from "../../lib/db";
import { listFiles } from "../../lib/staff-files";

export const dynamic = "force-dynamic";
export const metadata = { title: "Files — QEA Campaign HQ" };

const fileUrl = (id, name) => `/api/chat/file/${id}?name=${encodeURIComponent(name)}`;

/**
 * Everything the signed-in person has made in the chat, one row per document,
 * newest activity first, each with every version. Only their own: the rows are
 * read by the session email, and every download checks it again.
 */
export default async function FilesPage() {
  const user = await requireUser();
  if (!user.rep_name) {
    return (
      <main className="card" style={{ maxWidth: 520, padding: 28 }}>
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Files need a rep name</h1>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {user.email} can sign in, and has no name in app_users yet. Ask Tanay to add the row.
        </p>
      </main>
    );
  }

  const files = await listFiles(user.email);
  return (
    <>
      <h1>Your files</h1>
      <p className="sub">
        Every proposal and brief you have made in the chat, and every version of each. A fixed photo is
        a new version; nothing here is ever overwritten.
      </p>
      <div className="card tw">
        {files.length ? (
          <table className="files">
            <thead>
              <tr>
                <th>File</th>
                <th>Versions</th>
                <th>Last change</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.root_id}>
                  <td className="name">
                    <span className="kind">{f.kind === "brief" ? "Brief" : "Proposal"}</span>
                    <b>{f.filename}</b>
                    {f.versions.length > 1 ? (
                      <details className="vers">
                        <summary>All {f.versions.length} versions</summary>
                        <ol reversed>
                          {f.versions
                            .map((v, i) => (
                              <li key={v.id}>
                                <a href={fileUrl(v.id, v.filename)} download={v.filename}>
                                  v{i + 1} · {v.change}
                                </a>
                                <span>{prettyWhen(v.created_at)}</span>
                              </li>
                            ))
                            .reverse()}
                        </ol>
                      </details>
                    ) : null}
                  </td>
                  <td>{f.versions.length}</td>
                  <td>
                    {f.change}
                    <span className="alias">{prettyWhen(f.created_at)}</span>
                  </td>
                  <td>
                    <span className="rowactions" style={{ justifyContent: "flex-end" }}>
                      {f.thread_id ? (
                        <a className="choice" href={`/chat?t=${f.thread_id}`}>
                          Open the chat
                        </a>
                      ) : null}
                      <a className="choice" href={fileUrl(f.id, f.filename)} download={f.filename}>
                        Download
                      </a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            Nothing yet. Proposals and briefs you make in <a href="/chat">Chat</a> land here.
          </p>
        )}
      </div>
    </>
  );
}
