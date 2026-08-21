"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Dragging a card from one column to another.
 *
 * CALLS_BOARD_PLAN §7 refused this, and the reason was: a drop cannot say
 * which of the four tags it meant. That objection dies here because the five
 * columns *are* statusOf()'s five values — dropping on "Follow up" means
 * follow_up and nothing else.
 *
 * What a drop still cannot say is the rest of the call: the date, the note,
 * and — for a booked meeting — the day the meeting actually happens, which
 * log_call refuses to invent. So a drop does not write anything. It opens the
 * person with that outcome already picked and asks for what is missing, and
 * the rep presses Log call. One write path, still the only one: the card moves
 * because a call was logged, not because a card was dragged.
 *
 * Native HTML5 drag — no library. Touch devices do not fire these events, so
 * the card stays a link and tapping it opens the same drawer.
 */

/** The column a card cannot be dragged into, and why. */
const NO_DROP = {
  never_called:
    "A call is what takes somebody out of To call, so nothing can put them back. Delete the call in their history instead.",
};

export function DropColumn({ outcome, children }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState(null);

  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop entirely.
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const [id, from] = (e.dataTransfer.getData("text/plain") || "").split("|");
        if (!id || from === outcome) return;
        if (NO_DROP[outcome]) return setRefused(NO_DROP[outcome]);
        // The URL is the state here as everywhere else: this opens the person
        // with the outcome preselected. Nothing is written until Log call.
        const q = new URLSearchParams(window.location.search);
        q.set("open", id);
        q.set("outcome", outcome);
        q.delete("editCall");
        router.push(`${window.location.pathname}?${q}#c-${id}`);
      }}
    >
      {children}
      {refused ? (
        <p className="refused" onClick={() => setRefused(null)}>
          {refused}
        </p>
      ) : null}
    </div>
  );
}

export function DragCard({ id, from, children, ...rest }) {
  const [dragging, setDragging] = useState(false);
  return (
    <a
      {...rest}
      draggable
      className={`${rest.className ?? ""}${dragging ? " dragging" : ""}`}
      onDragStart={(e) => {
        // The column it came from rides along, so a drop back where it started
        // is a no-op rather than a call logged for nothing.
        e.dataTransfer.setData("text/plain", `${id}|${from}`);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {children}
    </a>
  );
}
