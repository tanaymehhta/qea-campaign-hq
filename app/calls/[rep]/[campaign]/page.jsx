import { db, num, today, prettyDate, initials } from "../../../../lib/db";
import { contactsFor, callsFor, callStats } from "../../../../lib/calls";
import { Tile, Pill } from "../../../../components/ui";
import { logCall, setContactDnc, updateContactDetail, setCallback, restoreContact } from "../../actions";

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

const OUTCOMES = [
  ["booked_meeting", "Booked a meeting"],
  ["follow_up", "Follow up"],
  ["not_interested", "Not interested"],
  ["no_answer", "No answer"],
  ["other", "Other"],
];

const FILTERS = {
  called: "with at least one call",
  reached: "reached — a call that wasn't a no-answer",
  meetings: "with a meeting booked",
  due: "with a follow-up due",
  never: "never called",
  noanswer: "called but never reached",
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
  const s = callStats(contacts, calls);
  const t = today();

  const base = `/calls/${encodeURIComponent(rep)}/${camp.slug}`;
  const here = (f, v = sp.v) => {
    const q = new URLSearchParams();
    if (f) q.set("f", f);
    if (v === "all") q.set("v", "all");
    return `${base}${q.size ? `?${q}` : ""}#list`;
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
      <div className="card" style={{ marginBottom: 26 }}>
        {camp.summary_md
          ? <Markdown text={camp.summary_md} />
          : <p className="empty" style={{ padding: 0 }}>
              No context written yet — set <code>summary_md</code> on this campaign to brief
              the rep on who we&rsquo;re calling, the pitch, and the open questions.
            </p>}
      </div>

      {/* Data summary — every tile filters the list beneath it. */}
      <div className="grid g4">
        <Tile hero label="Calls made" value={num(s.callsMade)} raw={s.callsMade}
          tone={s.callsMade ? undefined : "muted"} note="every dial, logged below" href={here("called")} />
        <Tile hero label="People reached" value={num(s.peopleReached)} raw={s.peopleReached}
          tone={s.peopleReached ? undefined : "muted"} note="distinct people, no-answers excluded" href={here("reached")} />
        <Tile hero label="Meetings booked" value={num(s.meetingsBooked)} raw={s.meetingsBooked}
          tone={s.meetingsBooked ? undefined : "muted"} note="from calls on this list" href={here("meetings")} />
        <Tile hero label="Follow-ups due" value={num(s.followupsDue)} raw={s.followupsDue}
          tone={s.followupsDue ? undefined : "muted"} note="callback today or overdue" href={here("due")} />
      </div>
      <div className="grid g5" style={{ marginBottom: 30 }}>
        <Tile label="Never called" value={num(s.neverCalled)} raw={s.neverCalled} href={here("never")} />
        <Tile label="No answer" value={num(s.noAnswer)} raw={s.noAnswer}
          tone={s.noAnswer ? undefined : "muted"} note="called, never reached" href={here("noanswer")} />
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
                        <span className="glyph" style={{ background: "var(--tint-n)", color: "var(--ink-1)" }}>
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
                        <span className="chev">⌄</span>
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
                        <form action={logCall} className="gapform">
                          <input type="hidden" name="contact_id" value={ct.id} />
                          <input type="hidden" name="rep" value={rep} />
                          <input type="hidden" name="path" value={base} />
                          <input type="date" name="call_date" defaultValue={t} required />
                          <select name="outcome" required>
                            {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          <input name="note" placeholder="What happened? Notes go here." style={{ flex: 2, minWidth: 220 }} />
                          <input type="date" name="callback_date" title="Callback date, if any" />
                          <button className="choice" type="submit">Log call</button>
                        </form>
                        {history.length ? (
                          <div className="tw" style={{ marginTop: 14 }}>
                            <table>
                              <thead><tr>
                                <th>Date</th><th>Outcome</th><th>Rep</th>
                                <th style={{ textAlign: "left" }}>Note</th><th>Callback</th>
                              </tr></thead>
                              <tbody>
                                {history.map((c) => (
                                  <tr key={c.id}>
                                    <td className="dim">{prettyDate(c.call_date)}</td>
                                    <td><Pill status={c.outcome} /></td>
                                    <td>{c.rep || "—"}</td>
                                    <td className="dim" style={{ textAlign: "left" }}>{c.note || "—"}</td>
                                    <td className="dim">{c.callback_date ? prettyDate(c.callback_date) : "—"}</td>
                                  </tr>
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
