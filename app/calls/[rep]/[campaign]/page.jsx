import { db, num, today, prettyDate, initials } from "../../../../lib/db";
import { contactsFor, callsFor, callStats, meetingsForCalls } from "../../../../lib/calls";
import { Tile, Pill, Chev } from "../../../../components/ui";
import { logCall, editCall, deleteCall, setContactDnc, updateContactDetail, setCallback, restoreContact } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Just enough markdown for the Context panel — headings, bold, lists,
 * paragraphs. summary_md is edited in the database, not deployed, and a
 * markdown library for four constructs is not worth a dependency.
 */
function Markdown({ text }) {
  const inline = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part
    );
  const blocks = (text ?? "").replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.trim());
  return blocks.map((b, i) => {
    const lines = b.trim().split("\n");
    if (/^#{1,6}\s/.test(lines[0])) return <h2 key={i}>{lines[0].replace(/^#+\s*/, "")}</h2>;
    if (lines.every((l) => /^[-*]\s/.test(l)))
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^[-*]\s*/, ""))}</li>)}</ul>;
    return <p key={i}>{inline(lines.join(" "))}</p>;
  });
}

/**
 * summary_md, one card per section instead of one long stack — the headings
 * ("WHAT THIS CAMPAIGN IS", "THE PITCH", …) already divide it; the layout
 * just honors the divisions. Content and storage unchanged.
 */
function ContextSections({ text }) {
  const blocks = (text ?? "").replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.trim());
  const sections = [];
  let cur = { title: null, body: [] };
  for (const b of blocks) {
    const lines = b.trim().split("\n");
    if (/^#{1,6}\s/.test(lines[0])) {
      if (cur.title || cur.body.length) sections.push(cur);
      cur = { title: lines[0].replace(/^#+\s*/, ""), body: [] };
      if (lines.length > 1) cur.body.push(lines.slice(1).join("\n"));
    } else {
      cur.body.push(b);
    }
  }
  if (cur.title || cur.body.length) sections.push(cur);
  return (
    <div className="ctxgrid">
      {sections.map((s, i) => (
        <section className="ctxcard" key={i}>
          {s.title ? <h3>{s.title}</h3> : null}
          <Markdown text={s.body.join("\n\n")} />
        </section>
      ))}
    </div>
  );
}

// Contact avatar tint follows the call status the row already shows — blue for
// "in motion" outcomes, green for a booked meeting, neutral for the rest.
// Hues from the validated palette in ui.jsx's CAT_OF, not new colors.
const GLYPH_TINT = {
  booked_meeting: ["var(--tint-3)", "var(--good)"],
  follow_up: ["var(--tint-1)", "var(--s1)"],
};

// The four. One call ends one way, so these are radio buttons: pick one, press
// Log call, that is one call on the Overview — and if it is the first one,
// one meeting too.
//
// There were seven until 20 Aug 2026, and three of them ("No answer", "Left
// voicemail", "Left email") were one fact written three ways. Whether you left
// a message is a sentence in the note, not a category the dashboard counts.
// "Booked a meeting" is last so it is not one misclick from the Log call
// button, which is where it sat when it was a checkbox.
const OUTCOMES = [
  ["not_reached", "Didn't reach them"],
  ["follow_up", "Follow up"],
  ["not_interested", "Not interested"],
  ["booked_meeting", "Booked a meeting"],
];

const FILTERS = {
  called: "with at least one call",
  reached: "you got through to",
  meetings: "with a meeting booked",
  due: "with a follow-up due",
  never: "never called",
  notreached: "called but never reached",
  notint: "not interested",
  dnc: "do-not-call",
};

/**
 * The call crib, personalized from the contact's own book — the Day 1 call
 * sheet's script (opener → stop talking → the reseller ask → close on their
 * top building), templated so every one of the 1,252 people gets one without
 * anyone writing 1,252 scripts. Owners get the owner variant: they are a
 * buyer, not a channel.
 */
function Crib({ ct, rep }) {
  const first = ct.full_name.split(" ")[0];
  const caller = rep.split(" ")[0];
  const bldgs = ct.buildings ?? [];
  const top = bldgs[0]; // buildings are stored best-rank first
  const n = ct.buildings_count;

  const boroughs = [...bldgs.reduce((m, b) => m.set(b.borough, (m.get(b.borough) ?? 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");

  return (
    <>
      <h2>The book — why this call</h2>
      <p className="note" style={{ marginBottom: 10 }}>
        {num(n)} SAFE building{n === 1 ? "" : "s"} carried · top building ranks #{ct.best_rank}
        {top?.streak ? ` (${top.streak}-cycle SAFE streak)` : ""}{boroughs ? ` · ${boroughs}` : ""}
      </p>

      <h2>Script</h2>
      {ct.role === "engineer" ? (
        <>
          <p><b>Opener —</b> &ldquo;{first}? {caller} from QEA Tech — do you have thirty seconds?
            I was going through the public FISP filings and your name is on {num(n)} building{n === 1 ? "" : "s"} that
            all read SAFE, on time, no violations. You clearly run a tight book, which is exactly why I called you
            and not chased a problem building. We scan building envelopes with drones — thermal and visual, whole
            building in a day, no scaffold. FISP only checks what&rsquo;s falling off; Local Law 97 carbon penalties
            are the next bill your owners see. Are they asking you about LL97 yet?&rdquo;
            <b> Then stop talking.</b></p>
          <p><b>The real ask — reseller.</b> &ldquo;Would you run this under {ct.org_name || "your firm"}? You scope
            it, we fly it, you file and bill it, you keep the margin — and you clear more buildings a cycle with the
            same people.&rdquo;</p>
          <p><b>Close —</b> &ldquo;Let&rsquo;s do one building.
            {top ? ` ${top.address}, ${top.borough} —` : ""} we fly it, you see the output, and if it&rsquo;s not
            useful you&rsquo;ve lost nothing. What&rsquo;s your week look like?&rdquo;</p>
          <p className="note">No answer? Leave the voicemail every single time — one hook (drone scans, no scaffold,
            LL97), your number twice, twenty seconds. The follow-up email is warm only because the voicemail happened.</p>
        </>
      ) : (
        <>
          <p><b>Opener —</b> &ldquo;{first}? {caller} from QEA Tech.
            {top ? ` Your building at ${top.address} passed FISP` : " Your building passed FISP"}
            {top?.streak ? ` — ${top.streak} cycles SAFE in a row, no fines` : ""} — that puts you in the most
            compliant slice of the city, and it&rsquo;s why I called. LL11 only checks falling hazards. It says
            nothing about where the building leaks energy, and Local Law 97 carbon penalties are the next bill.
            Our drone scan shows exactly where it leaks — one day, no scaffold. Has anyone put an LL97 number in
            front of you yet?&rdquo; <b>Then stop talking.</b></p>
          <p><b>Close —</b> &ldquo;We fly it, you see the output, and if it&rsquo;s not useful you&rsquo;ve lost
            nothing. What&rsquo;s your week look like?&rdquo;</p>
        </>
      )}
    </>
  );
}

export default async function CallWorkspace({ params, searchParams }) {
  const rep = decodeURIComponent(params.rep);
  const sp = searchParams ?? {};
  const filter = FILTERS[sp.f] ? sp.f : null;
  const showAll = sp.v === "all";

  const { data: camp } = await db
    .from("call_campaigns").select("*").eq("slug", params.campaign).single();
  if (!camp) return <p className="empty">No call campaign called &ldquo;{params.campaign}&rdquo;.</p>;

  const [contacts, calls] = await Promise.all([contactsFor(camp.id), callsFor(camp.id)]);
  const meetingOf = await meetingsForCalls(calls);
  const s = callStats(contacts, calls, meetingOf);
  const t = today();

  const base = `/calls/${encodeURIComponent(rep)}/${camp.slug}`;
  const here = (f, v = sp.v) => {
    const q = new URLSearchParams();
    if (f) q.set("f", f);
    if (v === "all") q.set("v", "all");
    return `${base}${q.size ? `?${q}` : ""}#list`;
  };

  // Editing a call history row reuses the "open" mechanism above — the
  // contact stays expanded — plus an editCall id that swaps one row for
  // its edit form. Filter/view state rides along so cancelling an edit
  // doesn't also drop the list back to the unfiltered view.
  const rowHref = (ct, callId) => {
    const q = new URLSearchParams();
    if (filter) q.set("f", filter);
    if (showAll) q.set("v", "all");
    q.set("open", ct.id);
    if (callId) q.set("editCall", callId);
    return `${base}?${q}#c-${ct.id}`;
  };

  // The working list: dnc rows are out unless asked for, and — because only
  // ~63 of 1,252 people have any contact detail yet — the default view is
  // "has a phone or email", with a toggle for the rest.
  let list = contacts.filter((ct) => (filter === "dnc" ? true : !ct.dnc));
  if (filter) list = list.filter(s.is[filter]);
  const undialable = list.filter((ct) => !(ct.phone || ct.email)).length;
  if (!showAll) list = list.filter((ct) => ct.phone || ct.email);

  // Follow-ups due sort to the top with a marker; beneath them, buildings
  // carried descending — the strategic point of this list: the top 32
  // engineers reach 50% of the buildings.
  list.sort((a, b) =>
    (s.is.due(b) - s.is.due(a)) ||
    (b.buildings_count - a.buildings_count) ||
    ((a.best_rank ?? 9e9) - (b.best_rank ?? 9e9))
  );

  const statusOf = (ct) =>
    ct.dnc ? "dnc" : !s.callsOf(ct).length ? "never_called" : s.lastOutcome(ct);

  return (
    <>
      <div className="rise">
        <h1>{camp.display_name}</h1>
        <p className="sub">{camp.description}</p>
      </div>

      <div className="range" style={{ marginBottom: 18 }}>
        <a href={`/calls/${encodeURIComponent(rep)}`}>&larr; {rep}&rsquo;s lists</a>
      </div>

      {/* A write that the database refused. It says why in a sentence; the
          rep needs to read it, not a stack trace. */}
      {sp.err ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn-ink)" }}>
          <p style={{ margin: 0 }}>
            <b>That didn&rsquo;t save.</b> {sp.err}{" "}
            <a href={base}>dismiss</a>
          </p>
        </div>
      ) : null}

      {/* Context — prose from summary_md, editable in the database without a deploy. */}
      {camp.summary_md
        ? <ContextSections text={camp.summary_md} />
        : <div className="card" style={{ marginBottom: 26 }}>
            <p className="empty" style={{ padding: 0 }}>
              No context written yet — set <code>summary_md</code> on this campaign to brief
              the rep on who we&rsquo;re calling, the pitch, and the open questions.
            </p>
          </div>}

      {/* Data summary — every tile filters the list beneath it. */}
      <div className="grid g4">
        <Tile hero label="Calls made" value={num(s.callsMade)} raw={s.callsMade}
          tone={s.callsMade ? undefined : "muted"} note="one per call logged, whatever the outcome" href={here("called")} />
        {/* Was "People reached", which is now the Overview's name for a wider
            pile — anyone we emailed or dialled, whatever happened (20 Aug).
            This one has always meant the narrower fact: a human picked up. Two
            definitions one click apart under one name is the whole bug, so the
            name moved rather than the meaning. */}
        <Tile hero label="Spoke to someone" value={num(s.peopleReached)} raw={s.peopleReached}
          tone={s.peopleReached ? undefined : "muted"} note="the three outcomes that aren't &ldquo;didn't reach them&rdquo;" href={here("reached")} />
        <Tile hero label="Meetings booked" value={num(s.meetingsBooked)} raw={s.meetingsBooked}
          tone={s.meetingsBooked ? undefined : "muted"} note="the same rows the Overview counts" href={here("meetings")} />
        <Tile hero label="Follow-ups due" value={num(s.followupsDue)} raw={s.followupsDue}
          tone={s.followupsDue ? undefined : "muted"} note="callback today or overdue" href={here("due")} />
      </div>
      <div className="grid g5" style={{ marginBottom: 30 }}>
        <Tile label="Never called" value={num(s.neverCalled)} raw={s.neverCalled} href={here("never")} />
        {/* Named after what it counts. It was "No answer" over a pile that
            also held every voicemail and every email left instead — 6 people,
            and not one call in this database has ever been a no-answer. */}
        <Tile label="Didn&rsquo;t reach them" value={num(s.notReached)} raw={s.notReached}
          tone={s.notReached ? undefined : "muted"} note="called, never got through" href={here("notreached")} />
        <Tile label="Not interested" value={num(s.notInterested)} raw={s.notInterested}
          tone={s.notInterested ? undefined : "muted"} href={here("notint")} />
        <Tile label="Buildings covered" value={num(s.buildingsCovered)} raw={s.buildingsCovered}
          tone={s.buildingsCovered ? undefined : "muted"}
          note={`of ${num(contacts.reduce((a, c) => a + c.buildings_count, 0))} carried by the whole list`}
          href={here("reached")} />
        <Tile label="Do-not-call" value={num(s.doNotCall)} raw={s.doNotCall}
          tone="muted" note="incl. NYCHA, tagged institutional" href={here("dnc")} />
      </div>

      {/* The call list — one row per person, best call at the top. */}
      <h2 id="list">
        {filter ? `People ${FILTERS[filter]}` : "The call list"} — {num(list.length)} shown
      </h2>
      <div className="segrow">
        {filter ? <a className="choice" href={here(null)}>&times; clear filter</a> : null}
        <span className="note">
          {showAll
            ? "Showing everyone, including people with no phone or email yet."
            : `${num(undialable)} more have no phone or email yet.`}
        </span>
        <a className="choice" href={here(filter, showAll ? null : "all")}>
          {showAll ? "Only people I can reach" : "Show them anyway"}
        </a>
      </div>

      {list.map((ct, i) => {
              const history = s.callsOf(ct);
              const due = s.is.due(ct);
              const [glyphBg, glyphInk] = GLYPH_TINT[statusOf(ct)] ?? ["var(--tint-n)", "var(--ink-1)"];
              return (
                    <details
                      className={due ? "mrow hasgap" : "mrow"}
                      key={ct.id}
                      id={`c-${ct.id}`}
                      /* Reopened after a write, so logging a call doesn't
                         collapse the person you're still on the phone with. */
                      open={sp.open === ct.id}
                      style={{ animationDelay: `${0.04 + Math.min(i, 20) * 0.02}s` }}
                    >
                      <summary>
                        <span className="idx">{i + 1}</span>
                        <span className="glyph" style={{ background: glyphBg, color: glyphInk }}>
                          {initials(ct.full_name)}
                        </span>
                        <span className="meat">
                          <span className="who">
                            {due ? <span title="follow-up due" style={{ color: "var(--warn-ink)" }}>⚑ </span> : null}
                            {ct.full_name}
                          </span>
                          <span className="line">
                            {[ct.role, ct.org_name, ct.phone, ct.email].filter(Boolean).join(" · ") || "no contact details yet"}
                          </span>
                        </span>
                        <span className="who" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {num(ct.buildings_count)} bldg{ct.buildings_count === 1 ? "" : "s"}
                        </span>
                        <Pill status={statusOf(ct)} />
                        <span className="when">
                          {ct.callback_date ? `cb ${prettyDate(ct.callback_date)}` : `#${ct.best_rank}`}
                        </span>
                        <Chev />
                      </summary>

                      <div className="mbody"><div className="inner">
                        {/* The two things that matter mid-call: what to dial, then
                            where to write down what happened. Everything else is
                            reference and sits below or folds away. */}
                        <div className="meta" style={{ marginBottom: 16 }}>
                          <div><div className="k">Phone</div><div className="v">
                            {ct.phone || <span className="dim">none yet — firm mainline, ask for {ct.full_name.split(" ")[0]}</span>}
                          </div></div>
                          <div><div className="k">Email</div><div className="v">{ct.email || "—"}</div></div>
                          <div><div className="k">Licence</div><div className="v">{ct.license_no || "—"}</div></div>
                          <div><div className="k">Where</div><div className="v">{[ct.city, ct.state].filter(Boolean).join(", ") || "—"}</div></div>
                          <div><div className="k">Number from</div><div className="v">{ct.contact_source || "—"}</div></div>
                          {ct.dnc ? <div><div className="k">Do not call</div><div className="v">{ct.dnc_reason || "yes"}</div></div> : null}
                        </div>

                        <h2>Log the call</h2>
                        {/* One call, one outcome, one row. Radios, not
                            checkboxes: ticking three of them used to post three
                            rows and count as three calls.

                            Three dates, and they are three different facts: the
                            day you dialled, the day the meeting happens, and the
                            day to ring back. Two of them used to sit here as
                            bare unlabelled boxes and the third did not exist —
                            so a booked meeting was silently dated to the day of
                            the call. log_call now refuses that. */}
                        <form action={logCall} className="gapform">
                          <input type="hidden" name="contact_id" value={ct.id} />
                          <input type="hidden" name="rep" value={rep} />
                          <input type="hidden" name="path" value={base} />
                          <label className="datefield">
                            <span>Call date</span>
                            <input type="date" name="call_date" defaultValue={t} required />
                          </label>
                          <span className="outcomes">
                            {OUTCOMES.map(([k, l]) => (
                              <label key={k} className="outcome">
                                <input type="radio" name="outcome" value={k} required />
                                {l}
                              </label>
                            ))}
                          </span>
                          <input name="note" placeholder="What happened? Notes go here." style={{ flex: 2, minWidth: 220 }} />
                          <label className="datefield">
                            <span>Meeting on</span>
                            <input type="date" name="meeting_date"
                              title="The day the meeting actually happens. Required if you tick Booked a meeting — this is the date the Overview counts." />
                          </label>
                          <label className="datefield">
                            <span>Call back</span>
                            <input type="date" name="callback_date" title="Ring this person again on" />
                          </label>
                          <button className="choice" type="submit">Log call</button>
                        </form>
                        {history.length ? (
                          <div className="tw" style={{ marginTop: 14 }}>
                            <table>
                              <thead><tr>
                                <th>Date</th><th>Outcome</th><th>Rep</th>
                                <th style={{ textAlign: "left" }}>Note</th>
                                <th title="The meeting this call booked — the same row the Overview counts">Meeting</th>
                                <th>Callback</th><th></th>
                              </tr></thead>
                              <tbody>
                                {history.map((c) => (
                                  String(sp.editCall) === String(c.id) ? (
                                    <tr key={c.id}>
                                      {/* One cell holding the whole form — a <form> can't
                                          wrap a <tr> without the browser fostering it out
                                          of the table, so it lives inside a single <td>. */}
                                      <td colSpan={7}>
                                        <form action={editCall} className="gapform">
                                          <input type="hidden" name="call_id" value={c.id} />
                                          <input type="hidden" name="contact_id" value={ct.id} />
                                          <input type="hidden" name="rep" value={rep} />
                                          <input type="hidden" name="path" value={base} />
                                          <label className="datefield">
                                            <span>Call date</span>
                                            <input type="date" name="call_date" defaultValue={c.call_date} required />
                                          </label>
                                          <select name="outcome" defaultValue={c.outcome} required>
                                            {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                          </select>
                                          <input name="note" defaultValue={c.note ?? ""} placeholder="Note"
                                            style={{ flex: 2, minWidth: 200 }} />
                                          {/* Prefilled from the meeting this call
                                              made, so moving a meeting is editing
                                              the call that booked it — the one
                                              place that already keeps both rows
                                              in step (edit_call). */}
                                          <label className="datefield">
                                            <span>Meeting on</span>
                                            <input type="date" name="meeting_date"
                                              defaultValue={meetingOf.get(c.id)?.meeting_date ?? ""}
                                              title="The day the meeting actually happens. Required for a booked meeting." />
                                          </label>
                                          <label className="datefield">
                                            <span>Call back</span>
                                            <input type="date" name="callback_date" defaultValue={c.callback_date ?? ""}
                                              title="Ring this person again on" />
                                          </label>
                                          <button className="choice" type="submit">Save</button>
                                          <a className="choice" href={rowHref(ct, null)}>Cancel</a>
                                        </form>
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr key={c.id}>
                                      <td className="dim">{prettyDate(c.call_date)}</td>
                                      <td><Pill status={c.outcome} /></td>
                                      <td>{c.rep || "—"}</td>
                                      <td className="dim" style={{ textAlign: "left" }}>{c.note || "—"}</td>
                                      {/* Reads the meetings row itself, not a
                                          copy of its date kept here — there is
                                          one meeting and one place it lives. */}
                                      <td className="dim">
                                        {meetingOf.get(c.id)
                                          ? <a className="drilled" href="/meetings">{prettyDate(meetingOf.get(c.id).meeting_date)}</a>
                                          : "—"}
                                      </td>
                                      <td className="dim">{c.callback_date ? prettyDate(c.callback_date) : "—"}</td>
                                      <td className="rowactions">
                                        <a className="choice" href={rowHref(ct, c.id)}>Edit</a>
                                        <form action={deleteCall}>
                                          <input type="hidden" name="call_id" value={c.id} />
                                          <input type="hidden" name="contact_id" value={ct.id} />
                                          <input type="hidden" name="rep" value={rep} />
                                          <input type="hidden" name="path" value={base} />
                                          <button className="choice" type="submit">Delete</button>
                                        </form>
                                      </td>
                                    </tr>
                                  )
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}

                        <Crib ct={ct} rep={rep} />

                        {/* The full book is reference, not reading — folded so the
                            form above never sinks below 65 rows of addresses. */}
                        <details style={{ marginTop: 14 }}>
                          <summary className="note" style={{ cursor: "pointer" }}>
                            All {num(ct.buildings_count)} building{ct.buildings_count === 1 ? "" : "s"} on the SAFE list &rarr;
                          </summary>
                          <div className="tw" style={{ marginTop: 10 }}>
                            <table>
                              <thead><tr>
                                <th style={{ textAlign: "left" }}>Address</th><th>BIN</th>
                                <th>Borough</th><th>Rank</th><th>SAFE streak</th>
                              </tr></thead>
                              <tbody>
                                {(ct.buildings ?? []).map((b) => (
                                  <tr key={b.bin}>
                                    <td className="name">{b.address}</td>
                                    <td className="dim">{b.bin}</td>
                                    <td>{b.borough}</td>
                                    <td>#{b.rank}</td>
                                    <td>{b.streak ? `${b.streak} cycles` : num(b.score)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>

                        <div className="choices">
                          <span className="choices-label">Fix a detail</span>
                          <form action={updateContactDetail} className="gapform">
                            <input type="hidden" name="contact_id" value={ct.id} />
                            <input type="hidden" name="rep" value={rep} />
                            <input type="hidden" name="path" value={base} />
                            <select name="field">
                              <option value="phone">phone</option>
                              <option value="email">email</option>
                              <option value="linkedin">linkedin</option>
                            </select>
                            <input name="value" placeholder="new value" />
                            <button className="choice" type="submit">Save</button>
                          </form>
                        </div>

                        <div className="choices">
                          <span className="choices-label">Callback</span>
                          <form action={setCallback} className="gapform">
                            <input type="hidden" name="contact_id" value={ct.id} />
                            <input type="hidden" name="rep" value={rep} />
                            <input type="hidden" name="path" value={base} />
                            <input type="date" name="date" defaultValue={ct.callback_date ?? ""} />
                            <button className="choice" type="submit">Set</button>
                          </form>
                          {/* Retiring someone used to be one-way — a misclick
                              cost a contact until someone wrote SQL. */}
                          {ct.dnc ? (
                            <>
                              <span className="choices-label">Retired</span>
                              <form action={restoreContact} className="gapform">
                                <input type="hidden" name="contact_id" value={ct.id} />
                                <input type="hidden" name="rep" value={rep} />
                                <input type="hidden" name="path" value={base} />
                                <button className="choice" type="submit">Put back on the list</button>
                              </form>
                            </>
                          ) : (
                            <>
                              <span className="choices-label">Do not call</span>
                              <form action={setContactDnc} className="gapform">
                                <input type="hidden" name="contact_id" value={ct.id} />
                                <input type="hidden" name="rep" value={rep} />
                                <input type="hidden" name="path" value={base} />
                                <input name="reason" placeholder="why?" required />
                                <button className="choice" type="submit">Retire</button>
                              </form>
                            </>
                          )}
                        </div>
                      </div></div>
                    </details>
              );
            })}
      {!list.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>Nobody matches this view.</p></div>
      ) : null}
    </>
  );
}
