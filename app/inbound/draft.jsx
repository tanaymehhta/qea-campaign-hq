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
    <div className="lab-mail">
      <input value={subj} onChange={(e) => setSubj(e.target.value)} aria-label="Subject" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Email body" />
      <div className="lab-acts">
        <button className="go" onClick={copy} type="button">
          {copied ? "Copied" : "Copy email"}
        </button>
        {to ? <a href={mailto}>Open in mail</a> : null}
        <button type="button" className={sent ? "done" : ""} onClick={() => setSent(!sent)}>
          {sent ? "Marked sent" : "Mark as sent"}
        </button>
      </div>
      {sent ? (
        <div className="lab-receipt">
          Prototype only — <b>not saved</b>. The real version stamps the date on the email row
          and moves this lead into Sent · waiting.
        </div>
      ) : null}
    </div>
  );
}
