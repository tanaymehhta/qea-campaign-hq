"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CHIPS = ["Create a proposal", "Research a campaign", "Create a meeting brief"];

function MessageText({ text, accepted, onAccept }) {
  const nodes = [];
  let last = 0;
  let draft = false;
  let i = 0;
  const mark = /\[file:([0-9a-f-]{36}):([^\]]+)\]|\[draft-proposal\]/g;
  for (const match of text.matchAll(mark)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) {
      const name = match[2];
      nodes.push(
        <a key={i++} href={`/api/chat/file/${match[1]}?name=${encodeURIComponent(name)}`}>
          Download {name}
        </a>,
      );
    } else {
      draft = true;
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return (
    <>
      {nodes.map((node, index) => (typeof node === "string" ? <span key={index}>{node}</span> : node))}
      {draft && !accepted ? (
        <button type="button" className="choice" style={{ marginTop: 8 }} onClick={onAccept}>
          Mark this draft final
        </button>
      ) : null}
      {draft && accepted ? (
        <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
          Final for your records. Nothing was sent.
        </span>
      ) : null}
    </>
  );
}

export default function ChatBox({ thread, messages, accepted }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    setSent(trimmed);
    setPending("");
    setDraft("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread?.id ?? null, text: trimmed }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const id = res.headers.get("X-Thread-Id");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setPending(acc);
      }
      if (id && id !== thread?.id) router.push(`/chat?t=${id}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setSent("");
      setPending("");
    }
  }

  async function accept() {
    if (!thread?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chat/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not mark it final.");
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const empty = messages.length === 0 && !busy;

  return (
    <div>
      {empty ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 28px" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 16px", letterSpacing: "-.01em" }}>
            How can I help you?
          </h1>
          <div className="choices" style={{ justifyContent: "center" }}>
            {CHIPS.map((label) => (
              <button key={label} type="button" className="choice" onClick={() => send(label)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.map((m) => (
            <p key={m.id} style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              <b style={{ fontSize: 12, color: "var(--ink-3)" }}>{m.role === "user" ? "You" : "QEA"}</b>
              <br />
              <MessageText text={m.content} accepted={accepted} onAccept={accept} />
            </p>
          ))}
          {sent ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              <b style={{ fontSize: 12, color: "var(--ink-3)" }}>You</b>
              <br />
              {sent}
            </p>
          ) : null}
          {pending ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              <b style={{ fontSize: 12, color: "var(--ink-3)" }}>QEA</b>
              <br />
              <MessageText text={pending} accepted={accepted} onAccept={accept} />
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" style={{ color: "var(--crit)", fontSize: 13 }}>{error}</p>
      ) : null}

      <form className="gapform" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about a campaign, a brief, or a proposal"
          aria-label="Message"
        />
        <button className="choice go" type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
