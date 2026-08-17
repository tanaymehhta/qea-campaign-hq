"use client";

import { useState } from "react";

/**
 * The draft, editable, with the one thing a rep actually does:
 * take it to their own mail client.
 *
 * The clipboard is the only reason this is a client component; everything else
 * on the page renders on the server. Editing is local — a rep will always want
 * to change a word before sending, and what they copy is what they edited.
 *
 * "Mark as sent" is a stub in this prototype: it moves the card in front of you
 * and says so. Wiring it means a server action and a write policy on
 * inbound_emails, neither of which exists yet.
 */
export default function Draft({ subject, body, to }) {
  const [subj, setSubj] = useState(subject ?? "");
  const [text, setText] = useState(body ?? "");
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subj}\n\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const mailto = `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;

  return (
    <div className="i-mail">
      <div className="field">
        <span className="i-label">Subject</span>
        <input value={subj} onChange={(e) => setSubj(e.target.value)} aria-label="Subject" />
      </div>
      <div className="field">
        <span className="i-label">Body</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Email body" />
      </div>
      {/* Two quiet actions and one dark one. Copying is what a rep does twenty
          times a day and it should not look like a decision; marking sent is
          the decision, so it is the single dark button on the screen. */}
      <div className="i-acts">
        <button className="i-quiet" onClick={copy} type="button">
          {copied ? "Copied" : "Copy email"}
        </button>
        {to ? <a className="i-quiet" href={mailto}>Open in mail</a> : null}
        <button type="button" className={`i-commit push${sent ? " done" : ""}`}
                onClick={() => setSent(!sent)}>
          {sent ? "Marked sent" : "Mark as sent"}
        </button>
      </div>
      {sent ? (
        <div className="i-note" style={{ marginTop: 10 }}>
          Prototype only — <b>not saved</b>. The real version stamps the date on the email row
          and moves this lead into Sent · waiting.
        </div>
      ) : null}
    </div>
  );
}
