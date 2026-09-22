"use client";

import { useState } from "react";

/** One question at a time. The composer below still works for anyone who'd rather type. */
export default function AskSteps({ items, busy, onSend }) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState(() => items.map(() => ""));
  const [draft, setDraft] = useState("");

  const item = items[at];
  const last = at === items.length - 1;

  function finish(all) {
    const said = items
      .map((one, i) => (all[i] ? `${one.question} ${all[i]}` : null))
      .filter(Boolean);
    onSend(said.length ? said.join("\n") : "Use the defaults for all of them.");
  }

  function answer(value) {
    const all = answers.slice();
    all[at] = value.trim();
    setAnswers(all);
    setDraft("");
    if (last) finish(all);
    else setAt(at + 1);
  }

  function defaults() {
    finish(answers.map((given, i) => (i < at ? given : "")));
  }

  return (
    <div className="askstep">
      <div className="askhead">
        <span>Question {at + 1} of {items.length}</span>
        <span className="askbar" aria-hidden="true">
          <i style={{ width: `${((at + 1) / items.length) * 100}%` }} />
        </span>
      </div>
      <p className="askq">{item.question}</p>
      {item.hint ? <p className="askhint">{item.hint}</p> : null}
      {item.options.length ? (
        <div className="choices" style={{ marginTop: 10 }}>
          {item.options.map((option) => (
            <button key={option} type="button" className="choice" disabled={busy} onClick={() => answer(option)}>
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="askform"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) answer(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={item.fallback ? `Default: ${item.fallback}` : "Type your answer"}
          aria-label={item.question}
          disabled={busy}
          autoFocus
        />
        <button type="submit" className="choice go" disabled={busy || !draft.trim()}>
          {last ? "Send answers" : "Next"}
        </button>
        <button type="button" className="choice" disabled={busy} onClick={() => answer("")}>
          {item.fallback ? "Use default" : "Skip"}
        </button>
      </form>
      <div className="askfoot">
        {at > 0 ? (
          <button type="button" className="linky" disabled={busy} onClick={() => setAt(at - 1)}>
            Back
          </button>
        ) : null}
        <button type="button" className="linky" disabled={busy} onClick={defaults}>
          Use the defaults for the rest
        </button>
      </div>
    </div>
  );
}
