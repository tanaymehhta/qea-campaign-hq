"use client";

import { useRef, useState } from "react";

/**
 * A chat that can only do one thing: create QEA proposals. It has no access
 * to this app's Supabase data, no other tools — it's a thin client for
 * Code/proposal_service's Qwen agent, which is what actually enforces "only
 * proposals" (its system prompt is the qea-proposal skill and nothing else).
 * This component just renders the conversation and hands the docx back.
 */
export default function ProposalChat() {
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [conversation, setConversation] = useState(null); // opaque, sent back to continue the thread
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/proposal-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversation }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? `request failed (${res.status})`);
        setBusy(false);
        return;
      }

      setConversation(data.conversation ?? null);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.output ?? "(no reply)",
          docxBase64: data.docx_base64 ?? null,
          docxFilename: data.docx_filename ?? null,
        },
      ]);
    } catch (err) {
      setError(`agent unreachable: ${err.message}`);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function downloadDocx(base64, filename) {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "proposal.docx";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "70vh", maxWidth: 760 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.length === 0 ? (
          <p className="empty" style={{ padding: 0 }}>
            Give it a client name, an address, and any details you have — e.g. &ldquo;Create a
            proposal for 100 South Campus Drive, Allston MA. Client is Dr. Sarah Chen, Harvard
            University, schen@harvard.edu.&rdquo;
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 13.5,
                lineHeight: 1.5,
                padding: "10px 13px",
                borderRadius: 12,
                background: m.role === "user" ? "var(--wash-2)" : "var(--surface-2, var(--wash-1))",
                border: "1px solid var(--border)",
              }}
            >
              {m.content}
            </div>
            {m.docxBase64 ? (
              <button
                className="choice on"
                style={{ marginTop: 8 }}
                onClick={() => downloadDocx(m.docxBase64, m.docxFilename)}
              >
                Download {m.docxFilename ?? "proposal.docx"}
              </button>
            ) : null}
          </div>
        ))}
        {busy ? <p className="empty" style={{ padding: 0 }}>Working — this can take up to a minute…</p> : null}
        {error ? <p className="empty bad" style={{ padding: 0 }}>{error}</p> : null}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="gapform" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the deal…"
          disabled={busy}
          style={{ flex: 1 }}
          autoFocus
        />
        <button className="choice on" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
