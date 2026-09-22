"use client";

import { useEffect, useState } from "react";

/**
 * Campaign first, then the person off that campaign's list.
 *
 * The four boxes this replaces were four chances to invent a person who is
 * already in the database under a slightly different spelling. Now the campaign
 * is answered first, the name is picked from the people actually on it, and the
 * address and company arrive with the pick rather than being typed a second
 * time.
 *
 * Still a plain <input list=...>, not a locked-down <select>: a meeting booked
 * with somebody who was never on the list has to remain loggable, and every one
 * of these fields is validated by log_meeting whatever ends up in it.
 *
 * THAT IT IS TYPABLE IS NOW SAID OUT LOUD (21 Aug). Tanay: "sometimes there are
 * custom names so I need an option for that as well" — the capability was there
 * from the first day and nothing on screen mentioned it. A box that opens a
 * dropdown when you click it reads as a locked dropdown, and the people it was
 * built for were retyping meetings elsewhere or not logging them. So: the
 * placeholder says it, a line under the row says it, and once you have typed a
 * name nobody on the campaign has, the row says what will happen to them.
 */
export default function ProspectPicker({ groups, defaultGroup = "", pre }) {
  const [group, setGroup] = useState(defaultGroup);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(pre.name ?? "");
  const [email, setEmail] = useState(pre.email ?? "");
  const [company, setCompany] = useState(pre.company ?? "");

  useEffect(() => {
    if (!group) { setPeople([]); return; }
    let live = true;
    setLoading(true);
    fetch(`/api/prospects?group=${encodeURIComponent(group)}`)
      .then((r) => r.json())
      .then((d) => { if (live) setPeople(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setPeople([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [group]);

  // The datalist offers "Name — Company" so two people of the same name are
  // told apart; a pick is recognised by that label and unpacks into all three
  // boxes. Typing a name nobody on the list has just leaves it as the name.
  const labelOf = (p) => (p.company ? `${p.name || p.email} — ${p.company}` : (p.name || p.email));
  // Somebody typed in rather than picked. Matched on the address when there is
  // one — the identity rule everywhere else in here — and on the name only
  // when there is not.
  const typed = name.trim().toLowerCase();
  const custom = !!typed && !people.some((p) =>
    (email ? p.email === email.trim().toLowerCase() : (p.name || p.email).toLowerCase() === typed));
  const pick = (v) => {
    const hit = people.find((p) => labelOf(p) === v) ?? people.find((p) => (p.name || p.email) === v);
    if (hit) { setName(hit.name || ""); setEmail(hit.email); setCompany(hit.company || ""); }
    else setName(v);
  };

  return (
    <>
      <select name="group" value={group} onChange={(e) => setGroup(e.target.value)}
        title="Which campaign is this person on?">
        <option value="">No campaign</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.display_name}</option>
        ))}
      </select>
      <input name="name" required list="campaign-prospects" style={{ minWidth: 260 }}
        placeholder={
          !group ? "Prospect name * — or pick a campaign first"
            : loading ? "Loading the list…"
            : `Prospect name * — pick one of ${people.length}, or type a new one`
        }
        value={name} onChange={(e) => pick(e.target.value)} />
      <datalist id="campaign-prospects">
        {people.map((p) => <option key={p.email} value={labelOf(p)} />)}
      </datalist>
      <input name="email" type="email" placeholder="Email" style={{ minWidth: 200 }}
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <input name="company" placeholder="Company" style={{ minWidth: 160 }}
        value={company} onChange={(e) => setCompany(e.target.value)} />

      {/* What happens to a name nobody on the campaign has — said before the
          button is pressed rather than discovered afterwards. The address is
          the condition because /leads is keyed on it: log_meeting writes the
          lead row only when there is one, so a meeting logged with a bare name
          is a meeting with somebody the lead list still cannot show. */}
      <p className="pickhint">
        {custom
          ? email
            ? <><b>{name.trim()}</b> is not on this campaign — they will be logged as a meeting
                and added to the lead list under this campaign.</>
            : <><b>{name.trim()}</b> is not on this campaign. Add their email and they go on the
                lead list too; without one the meeting is still logged, but they stay invisible
                on Leads.</>
          : <>Not on the list? Type their name straight into the box and fill in the email and
              company yourself — the list is a shortcut, never a fence.</>}
      </p>
    </>
  );
}
