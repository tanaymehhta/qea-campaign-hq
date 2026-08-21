import { db, num, today, prettyDate, initials } from "../../../../lib/db";
import { callRepList, contactsFor, callsFor, callStats, meetingsForCalls, callsElsewhere, callListOwners } from "../../../../lib/calls";
import { Tile, Pill, Chev } from "../../../../components/ui";
import { Board, Card } from "../../../../components/board";
import { Drawer } from "../../../../components/drawer";
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

// The five. One call ends one way, so these are radio buttons: pick one, press
// Log call, that is one call on the Overview — and if it is the first one,
// one meeting too.
//
// The first two are both "no human answered", split on 21 Aug 2026 because the
// difference decides the next call: a voicemail is one touch, a voicemail plus
// an email is two, and only the second leaves something they can reply to.
// Neither is a conversation — "Spoke to someone" excludes both — so the split
// costs no tile its meaning.
//
// There were seven until 20 Aug and three of them were collapsed, which makes
// this look like a reversal and it is only half of one. What was wrong then was
// three tags for one fact ("No answer", "Left voicemail", "Left email") with a
// tile counting the wrong one; what is back now is one tag for a different
// action. The valid list lives in the database — `call_outcomes()`, migration
// 20260821200000 — and this array is its order on screen.
//
// "Booked a meeting" is last so it is not one misclick from the Log call
// button, which is where it sat when it was a checkbox.
const OUTCOMES = [
  ["not_reached", "Didn't reach them / left a voicemail"],
  ["emailed_and_called", "Left an email and made a phone call"],
  ["follow_up", "Follow up"],
  ["not_interested", "Not interested"],
  ["booked_meeting", "Booked a meeting"],
];

/** Which dot the chosen tag lights. Order and keys follow OUTCOMES. */
const TAG_CLASS = {
  not_reached: "miss", emailed_and_called: "mail",
  follow_up: "fu", not_interested: "no", booked_meeting: "win",
};

/**
 * The six columns are the six values statusOf() can return, in the order a
 * shift works them: everyone unrung, then the two kinds of tried-and-missed,
 * then the two conversations that are still alive, then the one that isn't,
 * then the win.
 *
 * A column per outcome is not decoration. statusOf() returns the last outcome
 * verbatim, so an outcome with no column here does not fall into a neighbour —
 * the person disappears off the board entirely.
 *
 * do-not-call is deliberately not here. It is a tile filter (?f=dnc) and stays
 * one: a seventh column would put five retired people on screen all day, and
 * CALL_LOGS §8-C — tiles count DNC people where lists hide them — would become
 * visible on a board and then get hidden again behind a column nobody reads.
 */
const COLUMNS = [
  ["never_called", "To call", "Nobody left to dial in this view."],
  ["not_reached", "Didn't reach", "Nobody tried and missed."],
  ["emailed_and_called", "Emailed + called", "Nobody has had both touches yet."],
  ["follow_up", "Follow up", "Nothing to ring back."],
  ["not_interested", "Not interested", "Nobody has said no."],
  ["booked_meeting", "Booked meeting", "No meeting off the phone yet."],
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
 * Not a script — the handful of things worth saying, in the order they land,
 * drawn from this person's own book. It replaced an Opener/Close screenplay on
 * 21 Aug 2026: nobody reads two paragraphs of quoted prose with a phone
 * against their ear, and the one instruction in it that mattered ("then stop
 * talking") was buried inside them. Owners get the owner points: they are a
 * buyer, not a channel.
 */
function Points({ ct, rep, unsafe }) {
  const first = ct.full_name.split(" ")[0];
  const caller = rep.split(" ")[0];
  const bldgs = ct.buildings ?? [];
  const top = bldgs[0]; // buildings are stored best-rank first
  const n = ct.buildings_count;
  const org = ct.org_name || "their firm";

  const boroughs = [...bldgs.reduce((m, b) => m.set(b.borough, (m.get(b.borough) ?? 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");

  // The two facts that make an UNSAFE call urgent, summed over the buildings
  // this person carries: what the city is owed, and how far past the 90-day
  // repair deadline the worst filing is.
  const owed = bldgs.reduce((a, b) => a + (b.ecb ?? 0), 0);
  const overdue = bldgs.filter((b) => b.overdue > 0).length;
  const worst = bldgs.reduce((a, b) => Math.max(a, b.overdue ?? 0), 0);

  if (unsafe) {
    return (
      <>
        <div className="pbook">
          <b>{num(n)} UNSAFE building{n === 1 ? "" : "s"}</b> carried · top building ranks{" "}
          <b>#{ct.best_rank}</b>
          {owed ? ` · $${num(owed)} unpaid` : ""}
          {overdue ? ` · ${num(overdue)} past the 90 days` : ""}
          {boroughs ? ` · ${boroughs}` : ""}
        </div>

        {ct.role === "engineer" ? (
          <ul className="ppoints">
            <li><b>Thirty seconds</b> — {caller} from QEA Tech, calling about the FISP filings
              under {first}&rsquo;s name.</li>
            <li><b>{num(n)} of them read UNSAFE</b>
              {overdue ? <> — {num(overdue)} already past the 90-day repair deadline
                {worst ? `, the worst by ${num(worst)} days` : ""}</> : null}
              {owed ? <>, and the owners are carrying <b>${num(owed)}</b> in unpaid ECB
                penalties</> : null}. No repair permit pulled on any of them.</li>
            <li><b>Nobody has been hired yet.</b> That is the whole reason for the call — the
              work has to happen and the scope does not exist.</li>
            <li>Drone scan of the envelope: thermal and visual,{" "}
              <b>whole building in a day, no scaffold</b>, so the condition survey stops
              waiting on a sidewalk shed.</li>
            <li className="stop">&ldquo;Who is scoping the repair on{" "}
              {top ? top.address : "that one"}?&rdquo; — then stop talking.</li>
            <li><b>The real ask, reseller:</b> {org} scopes it, we fly it, they file and bill
              it — and the owner gets out from under the fine faster.</li>
            <li><b>Close on one building:</b>{top ? ` ${top.address}, ${top.borough}` : " one building"}
              {top?.overdue ? `, ${num(top.overdue)} days overdue` : ""}. We fly it, they see the
              output, and if it is not useful nothing was lost.</li>
          </ul>
        ) : (
          <ul className="ppoints">
            <li><b>Thirty seconds</b> — {caller} from QEA Tech, calling about{" "}
              {top ? top.address : "the building"}.</li>
            <li><b>It is filed UNSAFE with the city</b>
              {top?.overdue ? <> — the 90-day repair clock ran out{" "}
                <b>{num(top.overdue)} days ago</b></> : <> — the 90-day repair clock is running</>}
              {top?.ecb ? <>, and there is <b>${num(top.ecb)}</b> outstanding on it</> : null}.</li>
            <li><b>No repair permit has been pulled</b>, so the fines keep compounding while
              nothing is scoped.</li>
            <li>A drone scan puts the whole facade in front of your engineer in a day —{" "}
              <b>no scaffold, no shed</b> — so the repair can be priced and filed.</li>
            <li className="stop">&ldquo;Who is handling the FISP repair for you?&rdquo; —
              then stop talking.</li>
            <li><b>Close:</b> we fly it this week, your engineer gets the survey, and if it is
              not useful nothing was lost.</li>
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <div className="pbook">
        <b>{num(n)} SAFE building{n === 1 ? "" : "s"}</b> carried · top building ranks{" "}
        <b>#{ct.best_rank}</b>{top?.streak ? ` (${top.streak}-cycle SAFE streak)` : ""}
        {boroughs ? ` · ${boroughs}` : ""}
      </div>

      {ct.role === "engineer" ? (
        <ul className="ppoints">
          <li><b>Thirty seconds</b> — {caller} from QEA Tech, calling about the public FISP filings.</li>
          <li><b>{num(n)} filing{n === 1 ? "" : "s"} under {first}&rsquo;s name all read SAFE</b> —
            on time, no violations. That is why this call happened and a problem building did not.</li>
          <li>Drone scan of the envelope: thermal and visual,{" "}
            <b>whole building in a day, no scaffold</b>.</li>
          <li>FISP only checks what is falling off.{" "}
            <b>Local Law 97 carbon penalties are the next bill</b> those owners see.</li>
          <li className="stop">&ldquo;Are they asking you about LL97 yet?&rdquo; — then stop talking.</li>
          <li><b>The real ask, reseller:</b> {org} scopes it, we fly it, they file and bill it
            and keep the margin — more buildings a cycle with the same people.</li>
          <li><b>Close on one building:</b>{top ? ` ${top.address}, ${top.borough}.` : " one building."}{" "}
            We fly it, they see the output, and if it is not useful nothing was lost.</li>
        </ul>
      ) : (
        <ul className="ppoints">
          <li><b>Thirty seconds</b> — {caller} from QEA Tech.</li>
          <li><b>{top ? `${top.address} passed FISP` : "The building passed FISP"}</b>
            {top?.streak ? ` — ${top.streak} cycles SAFE in a row, no fines` : ""} — the most
            compliant slice of the city, and why this call happened.</li>
          <li>LL11 only checks falling hazards. It says nothing about{" "}
            <b>where the building leaks energy</b> — and LL97 carbon penalties are the next bill.</li>
          <li>Our drone scan shows exactly where it leaks — <b>one day, no scaffold</b>.</li>
          <li className="stop">&ldquo;Has anyone put an LL97 number in front of you yet?&rdquo; —
            then stop talking.</li>
          <li><b>Close:</b> we fly it, they see the output, and if it is not useful nothing was lost.</li>
        </ul>
      )}
    </>
  );
}

/**
 * Everything the page can do to one person, in two columns: what to say on the
 * left, where to write down what happened on the right. The right column
 * sticks, so reading the points never scrolls the form off screen.
 *
 * Rebuilt 21 Aug 2026 around one question — what is the least a rep has to
 * type. The answer is the day and one of four tags; the note is optional and
 * everything else is conditional or gone:
 *
 *   · a date box exists only for the tag that needs one. "Ring back on"
 *     belongs to Follow up, "Meeting on" to Booked a meeting, and neither was
 *     ever relevant to the other two. CSS `:has()` does it — no JavaScript.
 *   · the standalone Callback form is gone. It wrote call_contacts.callback_date,
 *     the same column the form above it already writes, so the panel offered
 *     the same fact twice in two different shapes. Clearing one — the only
 *     thing it could do that the form cannot — moved into the overflow.
 *   · "Fix a detail" is gone as a select-a-field row. Correcting a number is a
 *     mid-call move, so it lives on the number.
 *   · do-not-call moved into the overflow. It retires somebody off the list;
 *     it does not belong on screen all day underneath the phone number.
 *
 * The panel also answers now. The database's refusals used to be printed at
 * the top of the *page* — behind the scrim, under the open drawer — so a
 * booked meeting with no meeting date (which log_call has always refused) came
 * back looking exactly like a saved one. Both answers render here, where the
 * rep is already looking, and only for the person they are open on.
 */
function PersonPanel({ ct, rep, base, t, s, meetingOf, sp, rowHref, dropped, unsafe, elsewhere, listOf }) {
  const history = s.callsOf(ct);
  const label = Object.fromEntries(OUTCOMES);
  const first = ct.full_name.split(" ")[0];
  // ?err= and ?ok= belong to the person the write was about. In the list view
  // every row renders one of these panels, so an unscoped banner would tell
  // ninety-three people that their call was logged.
  const mine = String(sp.open) === String(ct.id);
  const last = history[0];

  const hidden = (
    <>
      <input type="hidden" name="contact_id" value={ct.id} />
      <input type="hidden" name="rep" value={rep} />
      <input type="hidden" name="path" value={base} />
    </>
  );

  // One field, edited where it is displayed.
  const fix = (field, value, placeholder) => (
    <details className="pedit">
      <summary>{value ? "edit" : "add"}</summary>
      <form action={updateContactDetail} className="gapform">
        {hidden}
        <input type="hidden" name="field" value={field} />
        <input name="value" defaultValue={value ?? ""} placeholder={placeholder} />
        <button className="choice" type="submit">Save</button>
      </form>
    </details>
  );

  return (
    <>
      {mine && sp.err ? (
        <p className="pres bad">
          <span className="tick">!</span>
          <span><b>Not saved.</b> {sp.err}</span>
          <a href={rowHref(ct, null)}>dismiss</a>
        </p>
      ) : mine && sp.ok && last ? (
        <p className="pres">
          <span className="tick">&#10003;</span>
          <span>
            <b>Logged.</b> {prettyDate(last.call_date)} · {label[last.outcome] ?? last.outcome}
            {meetingOf.get(last.id)
              ? ` · meeting ${prettyDate(meetingOf.get(last.id).meeting_date)}`
              : last.callback_date ? ` · ring back ${prettyDate(last.callback_date)}` : ""}
          </span>
          <a href={rowHref(ct, null)}>dismiss</a>
        </p>
      ) : null}

      {/* This person has been rung already — on the other list, where they are
          a second row for the same human. Shown before the script, because
          "we spoke on the 4th" is the first thing they will say. The calls are
          not counted by this list's tiles; they belong to the list they were
          logged on and the link goes there. */}
      {(elsewhere?.get(ct.id) ?? []).length ? (() => {
        const other = elsewhere.get(ct.id);
        const list = listOf?.get(other[0].call_contacts.call_campaign_id);
        const owner = other[0].rep ?? list?.owner;
        return (
          <p className="pres">
            <span className="tick">!</span>
            <span>
              <b>Already rung {num(other.length)} time{other.length === 1 ? "" : "s"}</b>
              {list ? <> on <b>{list.display_name}</b></> : null} — last{" "}
              {prettyDate(other[0].call_date)}, {label[other[0].outcome] ?? other[0].outcome}
              {other[0].note ? <> · &ldquo;{other[0].note}&rdquo;</> : null}
            </span>
            {list && owner
              ? <a href={`/calls/${encodeURIComponent(owner)}/${list.slug}?open=${other[0].call_contacts.id}`}>open it</a>
              : null}
          </p>
        );
      })() : null}

      <div className="phead">
        <div className="meta">
          <div><div className="k">Phone</div><div className="v">
            {ct.phone || <span className="dim">none yet — firm mainline, ask for {first}</span>}
            {fix("phone", ct.phone, "+1 212 555 0100")}
          </div></div>
          <div><div className="k">Email</div><div className="v">
            {ct.email || <span className="dim">none yet</span>}
            {fix("email", ct.email, "name@firm.com")}
          </div></div>
          <div><div className="k">Licence</div><div className="v">{ct.license_no || "—"}</div></div>
          <div><div className="k">Where</div><div className="v">
            {[ct.city, ct.state].filter(Boolean).join(", ") || "—"}</div></div>
          <div><div className="k">Number from</div><div className="v">{ct.contact_source || "—"}</div></div>
          {ct.dnc ? <div><div className="k">Do not call</div><div className="v">{ct.dnc_reason || "yes"}</div></div> : null}
        </div>

        {/* Rare and destructive, so: present, one click away, not underfoot. */}
        <details className="pmenu">
          <summary className="choice">More &#8964;</summary>
          <div className="sheet">
            <div className="k">LinkedIn</div>
            <form action={updateContactDetail} className="gapform">
              {hidden}
              <input type="hidden" name="field" value="linkedin" />
              <input name="value" defaultValue={ct.linkedin ?? ""} placeholder="linkedin.com/in/…" />
              <button className="choice" type="submit">Save</button>
            </form>

            {/* The one thing the log form cannot do: take a follow-up off the
                books when the conversation ended some other way. */}
            {ct.callback_date ? (
              <>
                <div className="k" style={{ marginTop: 12 }}>Follow-up {prettyDate(ct.callback_date)}</div>
                <form action={setCallback} className="gapform">
                  {hidden}
                  <input type="hidden" name="date" value="" />
                  <button className="choice" type="submit">Clear the follow-up</button>
                </form>
              </>
            ) : null}

            {ct.dnc ? (
              <>
                <div className="k" style={{ marginTop: 12 }}>Retired</div>
                <form action={restoreContact} className="gapform">
                  {hidden}
                  <button className="choice" type="submit">Put back on the list</button>
                </form>
              </>
            ) : (
              <>
                <div className="k" style={{ marginTop: 12 }}>Do not call</div>
                <form action={setContactDnc} className="gapform">
                  {hidden}
                  <input name="reason" placeholder="why?" required />
                  <button className="choice danger" type="submit">Retire</button>
                </form>
              </>
            )}
          </div>
        </details>
      </div>

      <div className="psplit">
        <div className="pcol">
          <h2>What to say</h2>
          <Points ct={ct} rep={rep} unsafe={unsafe} />
          {/* Reference, not reading — folded so the form never sinks below 46
              rows of addresses. The last two columns are the list's own
              urgency: a SAFE streak where there is one, the unpaid balance and
              the days past the 90-day deadline where the building is UNSAFE. */}
          <details className="pfold" style={{ marginTop: 14 }}>
            <summary>
              All {num(ct.buildings_count)} building{ct.buildings_count === 1 ? "" : "s"} on the{" "}
              {unsafe ? "UNSAFE" : "SAFE"} list
            </summary>
            <div className="tw" style={{ marginTop: 10 }}>
              <table>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Address</th><th>BIN</th>
                  <th>Borough</th><th>Rank</th>
                  <th>{unsafe ? "Unpaid" : "SAFE streak"}</th>
                  {unsafe ? <th>Past 90 days</th> : null}
                </tr></thead>
                <tbody>
                  {(ct.buildings ?? []).map((b) => (
                    <tr key={b.bin}>
                      <td className="name">{b.address}</td>
                      <td className="dim">{b.bin}</td>
                      <td>{b.borough}</td>
                      <td>#{b.rank}</td>
                      {unsafe ? (
                        <>
                          <td>{b.ecb ? `$${num(b.ecb)}` : <span className="dim">—</span>}</td>
                          <td>{b.overdue > 0
                            ? <b>{num(b.overdue)} days</b>
                            : <span className="dim">clock running</span>}</td>
                        </>
                      ) : (
                        <td>{b.streak ? `${b.streak} cycles` : num(b.score)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="pcol pstick">
          <div className="plog">
            <p className="bigq">
              {dropped ? `Moving to “${label[dropped]}”` : "How did it go?"}
            </p>
            {dropped ? (
              <p className="note" style={{ margin: "-6px 0 12px" }}>
                Nothing has moved yet. A card changes column because a call was logged,
                so this needs the call that did it
                {dropped === "booked_meeting"
                  ? " — including the day the meeting actually happens."
                  : "."}
              </p>
            ) : null}

            {/* One call, one outcome, one row. Radios, not checkboxes: ticking
                three of them used to post three rows and count as three calls. */}
            <form action={logCall}>
              {hidden}
              <div className="ptags">
                {OUTCOMES.map(([k, l]) => (
                  <label key={k} className={`ptag ${TAG_CLASS[k]}`}>
                    <input type="radio" name="outcome" value={k} required
                      defaultChecked={dropped === k} />
                    <span className="dot" />
                    {l}
                    {k === "follow_up" ? <span className="sub">asks for a date</span> : null}
                    {k === "booked_meeting" ? <span className="sub">asks for a date</span> : null}
                  </label>
                ))}
              </div>

              {/* Shown by the tag above, and only by it. */}
              <div className="gapform">
                <label className="datefield datef fu">
                  <span>Ring back on</span>
                  <input type="date" name="callback_date" title="Ring this person again on" />
                </label>
                <label className="datefield datef win">
                  <span>Meeting on</span>
                  <input type="date" name="meeting_date"
                    required={dropped === "booked_meeting"}
                    title="The day the meeting actually happens — the date the Overview counts." />
                </label>
              </div>

              <div className="gapform">
                <input name="note" placeholder="Comments (optional)" />
              </div>

              <div className="gapform">
                <label className="when">
                  Called <input type="date" name="call_date" defaultValue={t} required />
                </label>
                <button className="choice on" type="submit" style={{ marginLeft: "auto" }}>Log call</button>
              </div>
            </form>
          </div>

          <h2>Earlier calls</h2>
          {history.length ? (
            <div className="tw">
              <table>
                <thead><tr>
                  <th>Date</th><th>Outcome</th>
                  <th style={{ textAlign: "left" }}>Comment</th><th></th>
                </tr></thead>
                <tbody>
                  {history.map((c) => (
                    String(sp.editCall) === String(c.id) ? (
                      <tr key={c.id}>
                        {/* One cell holding the whole form — a <form> can't wrap
                            a <tr> without the browser fostering it out of the
                            table, so it lives inside a single <td>. */}
                        <td colSpan={4}>
                          <form action={editCall} className="gapform">
                            <input type="hidden" name="call_id" value={c.id} />
                            {hidden}
                            <label className="datefield">
                              <span>Call date</span>
                              <input type="date" name="call_date" defaultValue={c.call_date} required />
                            </label>
                            <select name="outcome" defaultValue={c.outcome} required>
                              {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                            <input name="note" defaultValue={c.note ?? ""} placeholder="Comments" />
                            {/* Prefilled from the meeting this call made, so
                                moving a meeting is editing the call that booked
                                it — the one place that keeps both rows in step. */}
                            <label className="datefield">
                              <span>Meeting on</span>
                              <input type="date" name="meeting_date"
                                defaultValue={meetingOf.get(c.id)?.meeting_date ?? ""} />
                            </label>
                            <label className="datefield">
                              <span>Ring back on</span>
                              <input type="date" name="callback_date" defaultValue={c.callback_date ?? ""} />
                            </label>
                            <button className="choice on" type="submit">Save</button>
                            <a className="choice" href={rowHref(ct, null)}>Cancel</a>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.id}>
                        <td className="dim">
                          {prettyDate(c.call_date)}
                          {c.rep && c.rep !== rep ? <> · {c.rep}</> : null}
                          {meetingOf.get(c.id) ? (
                            <a className="drilled next" href="/meetings">
                              meeting {prettyDate(meetingOf.get(c.id).meeting_date)}
                            </a>
                          ) : c.callback_date ? (
                            <span className="next">ring back {prettyDate(c.callback_date)}</span>
                          ) : null}
                        </td>
                        <td><Pill status={c.outcome} /></td>
                        <td className="dim" style={{ textAlign: "left" }}>{c.note || "—"}</td>
                        <td className="rowactions">
                          <a className="choice" href={rowHref(ct, c.id)}>Edit</a>
                          <form action={deleteCall}>
                            <input type="hidden" name="call_id" value={c.id} />
                            {hidden}
                            <button className="choice" type="submit">Delete</button>
                          </form>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="note">No calls logged against this person yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

export default async function CallWorkspace({ params, searchParams }) {
  const rep = decodeURIComponent(params.rep);
  const sp = searchParams ?? {};
  const filter = FILTERS[sp.f] ? sp.f : null;
  const showAll = sp.v === "all";
  // Board is the view; ?view=list is the old row list, kept while the board
  // earns its keep. No param to preserve across a write this way, which is
  // why app/calls/actions.js needs no change to keep the rep where they were.
  const view = sp.view === "list" ? "list" : "board";
  // Set by a drop, and only ever one of the four. A drop picks the tag; it
  // cannot pick the date, the note or — for a booked meeting — the day the
  // meeting happens, so it preselects the tag and the panel asks for the rest.
  const dropped = OUTCOMES.some(([k]) => k === sp.outcome) ? sp.outcome : null;

  const { data: camp } = await db
    .from("call_campaigns").select("*").eq("slug", params.campaign).single();
  if (!camp) return <p className="empty">No call campaign called &ldquo;{params.campaign}&rdquo;.</p>;

  // The segment is checked before anything on this page can post it.
  //
  // Every form below carries `rep` as a hidden field and log_call writes it to
  // phone_calls.rep, which is where meeting_rows resolves a meeting's owner
  // from. /calls/all/nyc-ll11-safe is a URL /meetings generates itself for a
  // call with no rep whose list has no owner, so an unchecked segment was one
  // click from a meeting owned by a rep named "all".
  //
  // A name nobody answers to is worse than no name: the totals still sum, to
  // the wrong person. So this asks who you are and keeps the list you came for
  // — the click from /meetings still lands somewhere useful.
  const { reps: roster } = await callRepList();
  if (!roster.some((r) => r.id === rep)) {
    return (
      <>
        <div className="rise">
          <h1>{camp.display_name}</h1>
          <p className="sub">
            Nobody here is called &ldquo;{rep}&rdquo;. Every call logged on this page is filed
            under the name in the address bar, so it needs to be yours.
          </p>
        </div>
        <div className="reps big">
          {roster.map((r) => (
            <a key={r.id} href={`/calls/${encodeURIComponent(r.id)}/${camp.slug}`}>
              <span className="glyph" style={{ background: r.tint, color: r.ink }}>{r.initials}</span>
              <span className="who">
                {r.name.split(" ")[0]}<br />{r.name.split(" ").slice(1).join(" ")}
              </span>
              <span className="role">{r.role}</span>
            </a>
          ))}
        </div>
        <div className="range" style={{ marginTop: 18 }}>
          <a href="/calls">&larr; All reps</a>
        </div>
      </>
    );
  }

  const [contacts, calls] = await Promise.all([contactsFor(camp.id), callsFor(camp.id)]);
  // Calls the same people have taken on the other list. Not counted by
  // callStats — see callsElsewhere — but shown, so nobody rings a man on
  // Tuesday who said no on Monday under a different heading.
  const [meetingOf, elsewhere, { listOf }] = await Promise.all([
    meetingsForCalls(calls), callsElsewhere(contacts, camp.id), callListOwners(),
  ]);
  const s = callStats(contacts, calls, meetingOf);
  const t = today();

  // Which pitch the panel says out loud. Two call lists since 21 Aug 2026 and
  // they are opposites: a SAFE building has no deadline and the angle is LL97
  // energy, an UNSAFE one has a 90-day repair clock, an unpaid ECB balance and
  // no contractor hired, and the angle is the clock. Every "SAFE" on this page
  // was a hardcoded word until the second list existed.
  const unsafe = camp.slug === "nyc-ll11-unsafe";

  const base = `/calls/${encodeURIComponent(rep)}/${camp.slug}`;
  const here = (f, v = sp.v) => {
    const q = new URLSearchParams();
    if (f) q.set("f", f);
    if (v === "all") q.set("v", "all");
    if (view === "list") q.set("view", "list");
    return `${base}${q.size ? `?${q}` : ""}#list`;
  };
  // The view toggle keeps the filter and the show-everyone state — switching
  // how the same pile is drawn must not quietly change which pile it is.
  const viewHref = (want) => {
    const q = new URLSearchParams();
    if (filter) q.set("f", filter);
    if (showAll) q.set("v", "all");
    if (want === "list") q.set("view", "list");
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
    if (view === "list") q.set("view", "list");
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
  // Everyone this view is about, before the phone/email trim. The column
  // headers count this; the cards under them are the trimmed `list`. The two
  // are different piles on purpose and the foot of each column says so.
  const pile = list;
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

  // Cards per column, so ?v=all does not render 1,236 of them at once. Server
  // side, one link that bumps the cap — no virtualisation, no library.
  const cap = Math.max(10, Math.min(1000, Number(sp.n) || 50));
  const moreHref = (n) => {
    const q = new URLSearchParams();
    if (filter) q.set("f", filter);
    if (showAll) q.set("v", "all");
    if (view === "list") q.set("view", "list");
    q.set("n", String(n));
    return `${base}?${q}#list`;
  };

  const columns = COLUMNS.map(([key, label, empty]) => {
    const count = pile.filter((ct) => statusOf(ct) === key).length;
    const mine = list.filter((ct) => statusOf(ct) === key);
    const shown = mine.slice(0, cap);
    const hidden = count - shown.length;
    return {
      key, label, empty, count: num(count),
      cards: shown.map((ct) => {
        const [call] = s.callsOf(ct);
        const meeting = call ? meetingOf.get(call.id) : null;
        return (
          <Card
            key={ct.id}
            id={ct.id}
            from={key}
            href={rowHref(ct, null)}
            name={ct.full_name}
            due={s.is.due(ct)}
            age={call ? prettyDate(call.call_date) : `#${ct.best_rank}`}
            reach={ct.phone || ct.email || "no contact details yet"}
            buildings={`${num(ct.buildings_count)} bldg${ct.buildings_count === 1 ? "" : "s"}`}
            org={ct.org_name}
            note={call?.note}
            chip={
              meeting ? `Meeting ${prettyDate(meeting.meeting_date)}`
                : ct.callback_date ? `Call back ${prettyDate(ct.callback_date)}`
                : null
            }
            won={key === "booked_meeting"}
          />
        );
      }),
      // Two reasons a card can be missing and they are not the same reason:
      // past the cap on this page, or no phone or email yet. A column that
      // reported only one would be hiding the other behind a true sentence.
      more: hidden > 0 ? (
        <>
          {mine.length > shown.length ? (
            <a className="drilled" href={moreHref(cap + 50)}>
              {num(mine.length - shown.length)} more here — show 50 of them
            </a>
          ) : null}
          {count > mine.length ? (
            <span style={{ display: "block" }}>
              {num(count - mine.length)} more have no phone or email yet
            </span>
          ) : null}
        </>
      ) : null,
    };
  });

  const openContact = sp.open ? contacts.find((ct) => ct.id === sp.open) : null;

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
      {sp.err && !sp.open ? (
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
          tone="muted"
          /* NYCHA is a SAFE-list fact — 169 buildings behind four names, tagged
             institutional by that import. Nothing on the UNSAFE pilot is. */
          note={unsafe ? "retired off the working list" : "incl. NYCHA, tagged institutional"}
          href={here("dnc")} />
      </div>

      {/* The tiles above count calls filed on THIS list, and that is the rule
          that keeps them summing to the Overview's total. People on two lists
          break the reading of "never called" without breaking the arithmetic,
          so the overlap is stated here rather than folded into a tile. */}
      {elsewhere.size ? (
        <p className="note" style={{ marginTop: -18, marginBottom: 26 }}>
          <b>{num(elsewhere.size)} of these people have already been rung</b> on another list —
          they sit on both, and the calls are filed where they were logged, so the tiles above
          do not count them. Each one says so when you open it.{" "}
          <a className="drilled" href="/calls/log">See every call &rarr;</a>
        </p>
      ) : null}

      {/* The call list — one card or row per person, best call at the top. */}
      <div className="listhead">
        <h2 id="list">
          {filter ? `People ${FILTERS[filter]}` : "The call list"} — {num(list.length)} shown
        </h2>
        {/* Two drawings of one pile. Both read the same array, so the count
            above does not move when you switch. */}
        <div className="seg">
          <a className={view === "board" ? "on" : ""} href={viewHref("board")}>Kanban</a>
          <a className={view === "list" ? "on" : ""} href={viewHref("list")}>List</a>
        </div>
      </div>
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

      {view === "list" ? list.map((ct, i) => {
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
                        <PersonPanel ct={ct} rep={rep} base={base} t={t} s={s} meetingOf={meetingOf} sp={sp} rowHref={rowHref} dropped={dropped} unsafe={unsafe} elsewhere={elsewhere} listOf={listOf} />
                      </div></div>
                    </details>
              );
            }) : <Board columns={columns} />}
      {!list.length && view === "list" ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>Nobody matches this view.</p></div>
      ) : null}

      {/* The board's person panel. Same <PersonPanel> the list row renders —
          server HTML, server actions, one write path. The list keeps its own
          native <details>, so the panel is never on screen twice. */}
      {view === "board" ? (
        <Drawer
          open={!!openContact}
          title={openContact?.full_name}
          subtitle={openContact
            ? [openContact.role, openContact.org_name].filter(Boolean).join(" · ")
            : null}
        >
          {openContact ? (
            <PersonPanel ct={openContact} rep={rep} base={base} t={t} s={s} unsafe={unsafe} elsewhere={elsewhere} listOf={listOf}
              meetingOf={meetingOf} sp={sp} rowHref={rowHref} dropped={dropped} />
          ) : null}
        </Drawer>
      ) : null}
    </>
  );
}
