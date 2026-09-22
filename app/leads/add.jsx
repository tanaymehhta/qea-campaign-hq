"use client";

import { useState } from "react";
import { addLead } from "./actions";

const STATUSES = ["prospect", "assigned", "sent", "held", "no_email"];

/**
 * Putting somebody on the lead list by hand.
 *
 * The three fields that are not obvious:
 *
 * EMAIL IS REQUIRED, and the placeholder says so rather than the form failing
 * quietly. The page is keyed on the address — `v_lead_people` builds its email
 * side from `where email is not null` — so a lead without one would be written
 * and then never appear here. add_lead refuses it with that sentence; this only
 * marks the box so you find out before you press the button.
 *
 * STATUS is the same five words the source spreadsheets used, and it means what
 * it means there: a pipeline column somebody typed. It is deliberately NOT
 * "have we met them" — see the checkbox.
 *
 * MET is a real meeting or nothing. Ticking it opens the two dates and files a
 * row in `meetings` through log_meeting, in the same transaction as the lead:
 * it shows on /meetings, it counts in the KPI, and it obeys the agreed-on rule.
 * A boolean of our own here would be a second answer to a question `meetings`
 * already answers, free to disagree with it. The dates are only rendered when
 * the box is ticked, which is also what makes them safe to require.
 */
export default function AddLead({ groups, reps = [], today, defaultOpen = false }) {
  const [met, setMet] = useState(false);

  return (
    <details className="mrow" style={{ marginBottom: 18 }} open={defaultOpen}>
      <summary>
        <span className="meat">
          <span className="who">Add a person</span>
          <span className="line">
            Somebody handed over, met at an event, or dug up by hand — nothing syncs them,
            so this is the only way they get on the list.
          </span>
        </span>
        <svg className="chev" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mbody"><div className="inner">
        <form action={addLead} className="gapform">
          <input name="name" required placeholder="Name *" style={{ minWidth: 180 }} />
          <input name="email" type="email" required placeholder="Email * — the list is keyed on it"
            style={{ minWidth: 240 }} />
          <input name="company" placeholder="Company" style={{ minWidth: 170 }} />
          <input name="title" placeholder="Job title" style={{ minWidth: 150 }} />
          <input name="phone" placeholder="Phone" style={{ minWidth: 130 }} />
          <select name="group" defaultValue="" title="Which campaign are they part of?">
            <option value="">No campaign</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.display_name}</option>)}
          </select>
          <select name="status" defaultValue="prospect"
            title="The pipeline word — the same five the source spreadsheets use. Not 'have we met them'.">
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <input name="added_by" placeholder="Added by" list="lead-reps" style={{ minWidth: 120 }} />
          <datalist id="lead-reps">
            {reps.map((r) => <option key={r} value={r} />)}
          </datalist>

          <label className="metbox" title="Files a real meeting, not a flag — it shows on /meetings and counts in the KPI">
            <input type="checkbox" name="met" checked={met} onChange={(e) => setMet(e.target.checked)} />
            <span>Meeting booked</span>
          </label>

          {met ? (
            <>
              {/* Two dates, and the difference between them is the whole point.
                  "Agreed on" is when the win landed and is what every date
                  window on the dashboard counts by. */}
              <label className="datefield">
                <span>Happens on</span>
                <input type="date" name="date" defaultValue={today} required />
              </label>
              <label className="datefield">
                <span>Agreed on</span>
                <input type="date" name="booked_on" defaultValue={today} max={today} required />
              </label>
              <select name="evidence" defaultValue="calendar" title="How do we know it's booked?">
                <option value="calendar">calendar invite</option>
                <option value="tool">in the tool</option>
                <option value="crm">in the CRM</option>
                <option value="chat">said in chat</option>
              </select>
            </>
          ) : null}

          <input name="note" placeholder="Note" style={{ flex: 2, minWidth: 200 }} />
          <button className="choice" type="submit">Add them</button>
        </form>
      </div></div>
    </details>
  );
}
