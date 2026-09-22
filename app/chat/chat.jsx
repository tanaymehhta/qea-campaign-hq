"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import AskSteps from "../../components/ask-steps";
import { parseQuestions } from "../../lib/ask-steps";

// Four openers, each with the dot that means what it means everywhere else:
// blue is email, violet is the phone, green is the outcome you want, amber
// needs a human.
const CHIPS = [
  ["Create a proposal", ""],
  ["Research a campaign", "v"],
  ["Create a meeting brief", "g"],
  ["Which replies need me today?", "w"],
];

// Said one at a time while the model works, so a long answer never looks stuck.
const STATUS = [
  "Working",
  "Thinking",
  "Reading your campaigns",
  "Checking the numbers",
  "Pulling the thread together",
  "Finding the final answer",
  "Almost there",
];

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
        <a
          key={i++}
          className="filechip"
          download={name}
          href={`/api/chat/file/${match[1]}?name=${encodeURIComponent(name)}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" />
          </svg>
          <b>Download</b>
          <span>{name}</span>
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

/** Split into words, keeping the whitespace that follows each one. */
const words = (text) => text.match(/\S+\s*/g) || [];

/**
 * The pill. While the server is running a tool it says which one; the rotating
 * words are only the fallback for the stretch where nothing is being called.
 */
function Thinking({ label }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const word = label || STATUS[i % STATUS.length];
  return (
    <div className="thinking">
      <span className="orb" />
      <span className="word" key={label || i}>{word}</span>
    </div>
  );
}

export default function ChatBox({ thread, messages, accepted }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [doing, setDoing] = useState("");
  const box = useRef(null);
  const area = useRef(null);

  // The answer streams in whole — `target` is everything received so far, and
  // `shown` walks through it one word at a time so text never lands in blocks.
  const target = useRef("");
  const shown = useRef(0);
  const [, tick] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    if (!busy) return undefined;
    const id = setInterval(() => {
      if (shown.current < words(target.current).length) {
        shown.current += 1;
        tick();
      }
    }, 26);
    return () => clearInterval(id);
  }, [busy]);

  const bottom = () => {
    const el = box.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  };
  useEffect(bottom);

  function grow(el) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (messages.length === 0) {
      setLeaving(true);
      await new Promise((done) => setTimeout(done, 320));
    }
    setBusy(true);
    setError("");
    setSent(trimmed);
    setDraft("");
    target.current = "";
    shown.current = 0;
    if (area.current) area.current.style.height = "auto";
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
      // Status lines come first, each one \u001f-prefixed; the answer is
      // whatever is left once they have been read off the front.
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        while (acc.startsWith("\u001f")) {
          const end = acc.indexOf("\n");
          if (end < 0) break;
          setDoing(acc.slice(1, end));
          acc = acc.slice(end + 1);
        }
        if (acc.startsWith("\u001f")) continue;
        target.current = acc;
        tick();
      }
      // Let the words catch up with the answer before the server render
      // replaces them, so the last sentence is not swallowed. A block of
      // questions is the exception: it becomes the steps, so typing it out
      // first only shows the rep the list they were not meant to read.
      while (!parseQuestions(target.current) && shown.current < words(target.current).length) {
        await new Promise((done) => setTimeout(done, 26));
      }
      if (id && id !== thread?.id) router.push(`/chat?t=${id}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSent("");
      target.current = "";
      shown.current = 0;
    } finally {
      setBusy(false);
      setLeaving(false);
      setDoing("");
    }
  }

  // The streamed words stay on screen until the server render of the thread
  // arrives with them. Clearing them in `send` blanked the answer for a frame.
  useEffect(() => {
    setSent("");
    target.current = "";
    shown.current = 0;
  }, [messages.length]);

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

  const all = words(target.current);
  const revealed = all.slice(0, shown.current);
  const streaming = revealed.length > 0;
  // The steps stand in for the streamed block from the first frame.
  const asking = streaming ? parseQuestions(target.current) : null;
  const empty = messages.length === 0 && !busy && !sent;

  return (
    <>
      <div className="thread" ref={box} aria-live="polite">
        {empty ? (
          <div className={`chatopen${leaving ? " gone" : ""}`}>
            <h1>What are we working on?</h1>
            <p>
              Campaigns, replies, briefs and proposals. Every answer comes from your own
              campaigns — not a guess.
            </p>
            <div className="chips">
              {CHIPS.map(([label, hue], i) => (
                <button
                  key={label}
                  type="button"
                  className="chip"
                  style={{ animationDelay: `${0.12 + i * 0.06}s` }}
                  onClick={() => send(label)}
                >
                  <span className={`tick ${hue}`} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, index) => {
          // A block of questions is asked one at a time instead of being shown
          // as a list the rep has to answer in a format.
          const asks = index === messages.length - 1 && m.role === "assistant" && !busy
            ? parseQuestions(m.content)
            : null;
          return (
            <div key={m.id} className={`turn${m.role === "user" ? " me" : ""}`}>
              {m.role === "user" ? null : <span className="who">QEA</span>}
              {asks ? (
                <>
                  {asks.intro ? <p className="say">{asks.intro}</p> : null}
                  <AskSteps items={asks.items} busy={busy} onSend={send} />
                </>
              ) : (
                <p className="say">
                  <MessageText text={m.content} accepted={accepted} onAccept={accept} />
                </p>
              )}
            </div>
          );
        })}

        {sent ? (
          <div className="turn me">
            <p className="say">{sent}</p>
          </div>
        ) : null}

        {busy && !streaming ? <Thinking label={doing} /> : null}

        {streaming ? (
          <div className="turn">
            <span className="who">QEA</span>
            {asking ? (
              <>
                {asking.intro ? <p className="say">{asking.intro}</p> : null}
                <AskSteps items={asking.items} busy={busy} onSend={send} />
              </>
            ) : (
              <p className="say">
                {revealed.slice(0, -1).join("")}
                <span className="wordin">{revealed[revealed.length - 1]}</span>
                {revealed.length < all.length || busy ? <span className="cursor" /> : null}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="field">
          <textarea
            id="chat-message"
            ref={area}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              grow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Ask about a campaign, a brief, or a proposal"
            aria-label="Message"
          />
          <button className="send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        {error ? (
          <p role="alert" className="hint" style={{ color: "var(--crit)" }}>{error}</p>
        ) : (
          <p className="hint">Enter sends · Shift + Enter for a new line</p>
        )}
      </form>
    </>
  );
}
