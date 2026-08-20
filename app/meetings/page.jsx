import { db, num, prettyDate, today, initials, repList, listHref, meetingArgs, everyRow } from "../../lib/db";
import { Tile, Reps, Pill, PersonLink, Chev } from "../../components/ui";
import { logMeeting, editMeeting, setMeetingStatus, removeMeeting, restoreMeeting } from "./actions";

const STATUSES = ["booked", "held", "no_show", "cancelled"];

export const dynamic = "force-dynamic";

/**
 * The primary KPI, and the only thing on this dashboard no tool records.
 *
 * This page used to answer "whose meeting is this?" in JavaScript, and it was
 * the last of four readers to do so in its own way. On 20 Aug its rep strip read
 * All 9 · Mark Vasu 7 · Justin 0 · Mark Dolan 1 — 8 against an all-reps total of
 * 9, because a call logged with the rep box empty resolved to nobody here while
 * the Overview found it through the call campaign's owner.
 *
 * `meeting_rows` is now the only answer, for this page as well. It resolves the
 * rep once, scopes on that single value and returns it, so a meeting belongs to
 * exactly one rep and the strip sums by construction rather than by luck. Asked
 * with status "all" because this page lists cancellations too — the KPI still
 * counts booked + held, the same rule as everywhere else.
 *
 * Migration 20260821000000.
 */
export default async function Meetings({ searchParams }) {
  const rep = searchParams?.rep ?? "all";

  const showAllCalls = searchParams?.calls === "all";
  // The bin. `meeting_rows` with status "removed" is the only way to see a
  // removed meeting at all — every other reader filters them out — so this is
  // a deliberate trip rather than something you can wander into.
  const showRemoved = !!searchParams?.removed;

  // Two reads of the same function, because the bin must not empty the tiles.
  // The live pile always feeds the KPI and the rep strip; the removed pile is
  // fetched only when the bin is open and is only ever rendered as a list.
  // Paged, not because 7 rows need it but because PostgREST stops at 1,000
  // whatever is asked for, and past that there is no error — the rows at one
  // end simply stop arriving and every number on this page gets quietly
  // smaller. The tiles above are computed from these three piles. `everyRow`
  // needs a deterministic order to page safely, and `meeting_rows` returns
  // none of its own, so both reads ask for one; the display sort still happens
  // below.
  const [{ groups, reps }, { data: subs }, meetings, { data: proposals }, calls, { data: callCamps }, removedRows] = await Promise.all([
    repList(),
    db.from("v_campaign_summary").select("campaign_id, group_id, name, sub_campaign_label, group_name, group_slug, status, leads, replied, source"),
    everyRow(() => db.rpc("meeting_rows", meetingArgs({ status: "all" })).order("id")),
    db.from("proposals").select("id, campaign_id"),
    // `org_name` on the contact is the company. phone_calls has no such column
    // of its own, so the Company cell on every call row below read "—" whatever
    // the contact said.
    everyRow(() =>
      db.from("phone_calls")
        .select("*, call_contacts(id, call_campaign_id, org_name)")
        .is("deleted_at", null)
        .order("call_date", { ascending: false })
        .order("id")
    ),
    db.from("call_campaigns").select("id, slug, display_name, owner"),
    everyRow(() => db.rpc("meeting_rows", meetingArgs({ status: "removed" })).order("id")),
  ]);

  const subById = new Map((subs ?? []).map((s) => [s.campaign_id, s]));
  const groupOfCampaign = (id) => subById.get(id)?.group_id ?? null;

  const known = reps.find((r) => r.id === rep);
  const myGroupIds = known ? new Set(known.groupIds) : null;

  // `rep` comes off the row now — one value, resolved in Postgres, the same one
  // the Overview and /list scope by. Filtering on a returned column is not a
  // second definition of ownership; recomputing it here was.
  //
  // The function does not order its output, so the sort that used to live in
  // the query lives here.
  const allMeetings = [...meetings].sort((a, b) =>
    (b.meeting_date ?? "").localeCompare(a.meeting_date ?? "")
  );
  const mine = myGroupIds
    ? (subs ?? []).filter((s) => myGroupIds.has(s.group_id))
    : (subs ?? []);
  const myMeetings = known ? allMeetings.filter((m) => m.rep === rep) : allMeetings;
  const removed = [...removedRows]
    .filter((m) => !known || m.rep === rep)
    .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
  // What the list below renders. The tiles above never read this.
  const listed = showRemoved ? removed : myMeetings;
  const myProposals = (proposals ?? []).filter(
    (p) => !myGroupIds || myGroupIds.has(groupOfCampaign(p.campaign_id))
  );

  const sum = (k) => mine.reduce((a, s) => a + (s[k] ?? 0), 0);
  const running = mine.filter((s) => s.status === "running").length;
  // The KPI counts booked + held only — same rule as the Overview and the
  // campaign views. The list below still shows every row: a cancellation is
  // worth seeing, it just isn't worth counting.
  const counted = (m) => m.status === "booked" || m.status === "held";
  const kpiMeetings = myMeetings.filter(counted);
  const countFor = (r) =>
    (r.id === "all" ? allMeetings : allMeetings.filter((m) => m.rep === r.id))
      .filter(counted).length;

  const here = (id) => (id === "all" ? "/meetings" : `/meetings?rep=${encodeURIComponent(id)}`);
  // The bin link, keeping whichever rep is selected.
  const listHere = (bin) => {
    const q = new URLSearchParams();
    if (known) q.set("rep", rep);
    if (bin) q.set("removed", "1");
    return `/meetings${q.size ? `?${q}` : ""}`;
  };

  // A phone call's campaign lives on its contact, not the call row itself —
  // and so does the company. `phone_calls.company` has never existed, so every
  // Company cell on the call rows below read "—" no matter what the contact
  // said.
  const org = (c) => c.call_contacts?.org_name || null;
  const callCampById = new Map((callCamps ?? []).map((c) => [c.id, c]));
  const campOfCall = (c) => callCampById.get(c.call_contacts?.call_campaign_id) ?? null;
  const bookedCalls = calls.filter((c) => c.outcome === "booked_meeting");
  const shownCalls = showAllCalls ? calls : bookedCalls;
  const callToggle = (v) => {
    const q = new URLSearchParams();
    if (known) q.set("rep", rep);
    if (v) q.set("calls", v);
    return `/meetings${q.size ? `?${q}` : ""}#calls`;
  };
  // "Campaign" means the parent group, and it now arrives on the row as
  // `scope_label` — resolved from the group, else the campaign's group, else the
  // call list it came off. Every hand-logged meeting used to read "campaign
  // unknown" here because this page looked only at campaign_id, which the form
  // never sets: the one field it asks you for was invisible the moment you
  // saved it. The sub-campaign label below is still a detail field.
  const subLabelOf = (id) => {
    const s = subById.get(id);
    return s ? s.sub_campaign_label || s.name : null;
  };

  // A meeting that arrives from /replies or a person page brings the name, the
  // address and the campaign with it. Retyping those is precisely how the
  // duplicates in the audit were made — one row said "1287 East 19th
  // Condominium" and the next said "Condo". Nothing here is written from the
  // URL: it fills boxes that a human still reads and presses a button on, and
  // log_meeting validates every one of them either way.
  const pre = {
    name: searchParams?.name ?? "",
    email: searchParams?.email ?? "",
    company: searchParams?.company ?? "",
  };
  const preGroup = searchParams?.campaign
    ? subById.get(searchParams.campaign)?.group_id ?? null
    : null;
  const prefilled = !!(pre.name || pre.email || pre.company);

  return (
    <>
      <div className="rise">
        <h1>Meetings</h1>
        <p className="sub">
          The primary KPI, and the only thing on this dashboard no tool records. Pick a rep to see
          their meetings and the phone calls that booked one.
        </p>
      </div>

      <Reps
        reps={reps}
        current={known ? rep : "all"}
        hrefFor={here}
        big
        subtitleFor={(r) => {
          const n = countFor(r);
          return n === 1 ? "1 meeting" : `${n} meetings`;
        }}
      />

      <div className="grid g5" style={{ marginBottom: 34 }}>
        <Tile label="Campaigns" value={num(mine.length)} raw={mine.length} note={`${running} running`} />
        <Tile label="People" value={num(sum("leads"))} raw={sum("leads")} note="in their lists" />
        <Tile label="Replies" value={num(sum("replied"))} raw={sum("replied")}
          tone={sum("replied") ? undefined : "muted"} note="a floor, not a total" />
        <Tile label="Meetings" value={num(kpiMeetings.length)} raw={kpiMeetings.length}
          tone={kpiMeetings.length ? undefined : "muted"} note="booked or held — the primary KPI" />
        <Tile label="Proposals" value={num(myProposals.length)} raw={myProposals.length}
          tone={myProposals.length ? undefined : "muted"} note="logged by hand" />
      </div>

      {/* A write the database refused, said in its own sentence. */}
      {searchParams?.err ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn-ink)" }}>
          <p style={{ margin: 0 }}>
            <b>That didn&rsquo;t save.</b> {searchParams.err}{" "}
            <a href={here(known ? rep : "all")}>dismiss</a>
          </p>
        </div>
      ) : null}
      {searchParams?.logged ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0 }}>
            Meeting logged — it&rsquo;s in the list below and on the Overview.{" "}
            <a href={here(known ? rep : "all")}>dismiss</a>
          </p>
        </div>
      ) : null}
      {searchParams?.saved ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0 }}>
            Saved. Every number that counts this meeting has moved with it.{" "}
            <a href={listHere(showRemoved)}>dismiss</a>
          </p>
        </div>
      ) : null}
      {searchParams?.removed_one ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0 }}>
            Removed. It counts nowhere now, and the row is kept with your reason —{" "}
            <a href={listHere(true)}>see what has been removed</a>, or{" "}
            <a href={listHere(showRemoved)}>dismiss</a>.
          </p>
        </div>
      ) : null}
      {searchParams?.restored ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0 }}>
            Put back, at the status it had when it was removed.{" "}
            <a href={listHere(showRemoved)}>dismiss</a>
          </p>
        </div>
      ) : null}

      <details className="mrow" style={{ marginBottom: 22 }} open={!!searchParams?.err || prefilled}>
        <summary>
          <span className="meat">
            <span className="who">Log a meeting</span>
            <span className="line">
              {prefilled
                ? `Filled in from ${pre.name || pre.email} — check it and press Log it.`
                : "The one thing no tool records — booked over email, phone or anywhere else."}
            </span>
          </span>
          <Chev />
        </summary>
        <div className="mbody"><div className="inner">
          <form action={logMeeting} className="gapform">
            <input type="hidden" name="rep" value={known ? rep : ""} />
            <input name="name" placeholder="Prospect name *" required
              defaultValue={pre.name} style={{ minWidth: 180 }} />
            <input name="email" type="email" placeholder="Email"
              defaultValue={pre.email} style={{ minWidth: 200 }} />
            <input name="company" placeholder="Company"
              defaultValue={pre.company} style={{ minWidth: 160 }} />
            {/* Two dates, and the difference between them is the whole point.
                "Happens on" is when you will be in the room; "agreed on" is
                when the win landed, and it is what every date window counts by.
                A meeting booked today for September is a win today — dating it
                by the meeting would empty a rep's best week and fill one a
                fortnight out. Labelled, because two bare date boxes side by
                side are a coin toss. */}
            <label className="datefield">
              <span>Happens on</span>
              <input type="date" name="date" defaultValue={today()} required />
            </label>
            <label className="datefield">
              <span>Agreed on</span>
              <input type="date" name="booked_on" defaultValue={today()} max={today()} required />
            </label>
            {/* The campaign the click came from wins over the rep's own
                group: it names the list this person is actually on. */}
            <select name="group" defaultValue={preGroup ?? (known ? (groups.find((g) => g.owner === rep)?.id ?? "") : "")}>
              <option value="">No campaign</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.display_name}</option>
              ))}
            </select>
            <select name="evidence" defaultValue="calendar" title="How do we know it's booked?">
              <option value="calendar">calendar invite</option>
              <option value="tool">in the tool</option>
              <option value="crm">in the CRM</option>
              <option value="chat">said in chat</option>
            </select>
            {/* A typo here files the meeting under a rep who does not exist:
                it counts in the all-reps total and appears in nobody's column,
                and the parity gate only finds it afterwards. A datalist offers
                the names without refusing a new one — the stance set_group_owner
                takes, and for the same reason: there is no rep table, and the
                first meeting a new rep books should not be the thing that
                stops. */}
            <input name="logged_by" placeholder="Logged by" list="known-reps"
              defaultValue={known ? rep : ""} style={{ minWidth: 120 }} />
            <datalist id="known-reps">
              {reps.map((r) => <option key={r.id} value={r.id} />)}
            </datalist>
            <input name="note" placeholder="Note" style={{ flex: 2, minWidth: 200 }} />
            <button className="choice" type="submit">Log it</button>
          </form>
        </div></div>
      </details>

      <h2 style={{ marginTop: 0 }}>
        {showRemoved
          ? "Removed — meetings that were never meetings"
          : known ? `Meetings booked by ${rep}` : `All meetings — ${num(allMeetings.filter(counted).length)} booked or held, ever`}
      </h2>
      {showRemoved ? (
        <p className="sub" style={{ marginTop: -6 }}>
          Taken off the board as mistakes, not as cancellations — a meeting that was
          real and came off is cancelled instead, and stays in the list above. Nothing
          here counts anywhere. Put one back and it returns to the status it had.
        </p>
      ) : myMeetings.length > kpiMeetings.length ? (
        <p className="sub" style={{ marginTop: -6 }}>
          {num(myMeetings.length - kpiMeetings.length)} cancelled or no-show meeting
          {myMeetings.length - kpiMeetings.length === 1 ? " is" : "s are"} listed below but not counted.
        </p>
      ) : null}

      {/* The bin is a deliberate trip: no other reader can see a removed
          meeting, so the only way in is this link, and it only appears when
          there is something behind it. */}
      {removed.length || showRemoved ? (
        <div className="segrow">
          <span className="note">
            {showRemoved
              ? `${num(removed.length)} removed.`
              : `${num(removed.length)} meeting${removed.length === 1 ? " has" : "s have"} been removed as mistakes.`}
          </span>
          <a className="choice" href={listHere(!showRemoved)}>
            {showRemoved ? "Back to the board" : "Show removed"}
          </a>
        </div>
      ) : null}

      {!listed.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>
          {showRemoved ? "Nothing has been removed." : "No meetings logged against this rep yet."}
        </p></div>
      ) : null}

      {listed.map((m, i) => {
        const campaign = m.scope_label;
        const owner = m.rep;
        const tint = reps.find((r) => r.id === owner);
        const anonymous = !m.prospect_name;
        return (
          <details
            className={anonymous ? "mrow hasgap" : "mrow"}
            key={m.id}
            open={i === 0}
            style={{ animationDelay: `${0.06 + i * 0.05}s` }}
          >
            <summary>
              <span
                className="glyph"
                style={{
                  background: tint?.tint ?? "var(--tint-4)",
                  color: anonymous ? "var(--warn-ink)" : tint?.ink ?? "var(--ink-1)",
                }}
              >
                {anonymous ? "?" : initials(m.prospect_name)}
              </span>
              <span className="meat">
                {/* A link inside a summary navigates on its own click and lets
                    every other click through to the toggle, so the name goes to
                    the person and the rest of the row still opens. */}
                <span className="who" style={anonymous ? { color: "var(--ink-3)" } : undefined}>
                  {m.prospect_email
                    ? <PersonLink email={m.prospect_email} name={m.prospect_name} />
                    : m.prospect_name || "No prospect recorded"}
                </span>
                <span className="line">
                  {(m.company || "No company")} — {campaign ?? "campaign unknown"}
                </span>
              </span>
              <Pill status={m.status} />
              <span className="when">{prettyDate(m.meeting_date)}</span>
              <Chev />
            </summary>

            <div className="mbody">
              <div className="inner">
                <div className="meta">
                  <div><div className="k">Prospect</div><div className="v">
                    {m.prospect_name || m.prospect_email
                      ? <PersonLink email={m.prospect_email} name={m.prospect_name} />
                      : <span className="dim">not recorded</span>}
                  </div></div>
                  <div><div className="k">Company</div><div className="v">{m.company || "—"}</div></div>
                  <div><div className="k">Email</div><div className="v">{m.prospect_email || "—"}</div></div>
                  {/* `group_slug` is null for a meeting that came off a phone
                      call — its label names a call list, which lives under
                      /calls, so linking it here would send you to a page that
                      does not exist. */}
                  <div><div className="k">Campaign</div><div className="v">
                    {campaign ? (
                      m.group_slug
                        ? <a className="drilled" href={`/campaigns/${m.group_slug}`}>{campaign}</a>
                        : campaign
                    ) : "—"}
                  </div></div>
                  <div><div className="k">Sub-campaign</div><div className="v">
                    {subLabelOf(m.campaign_id)
                      ? <a className="drilled" href={`/c/${m.campaign_id}`}>{subLabelOf(m.campaign_id)}</a>
                      : "—"}
                  </div></div>
                  <div><div className="k">Evidence</div><div className="v">{m.evidence}</div></div>
                  <div><div className="k">Happens on</div><div className="v">{prettyDate(m.meeting_date)}</div></div>
                  {/* Null on the four rows logged before the column existed.
                      "Not recorded" rather than a date invented from created_at,
                      which would be a guess — see migration 20260821010000. */}
                  <div><div className="k">Agreed on</div><div className="v">
                    {m.booked_on ? prettyDate(m.booked_on) : <span className="dim">not recorded</span>}
                  </div></div>
                  <div><div className="k">Owner</div><div className="v">{owner ?? "—"}</div></div>
                  <div><div className="k">Logged by</div><div className="v">{m.logged_by || "—"}</div></div>
                  <div><div className="k">Status</div><div className="v">{m.status.replace(/_/g, " ")}</div></div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="k">Note</div><div className="v">{m.note || "—"}</div>
                  </div>
                </div>
                {anonymous ? (
                  <div className="warnbox plain">
                    This meeting was logged by hand with no prospect name, so it counts towards the
                    KPI but cannot be traced to anyone.{" "}
                    <a className="drilled" href="/conflicts">Fill the name in on Conflicts</a>.
                  </div>
                ) : null}

                {/* --------------------------------------------------------
                    The rest of the lifecycle. Until 21 Aug a hand-typed
                    meeting was write-once and the only remedy was SQL.

                    A meeting that came from a call gets no edit and no remove:
                    it belongs to the call, which already keeps it in step in
                    both directions. Offering the controls and letting the
                    database refuse would be a worse interface than not
                    offering them and saying where to go.
                   -------------------------------------------------------- */}
                {showRemoved ? (
                  <>
                    <div className="warnbox plain">
                      <b>Removed.</b> {m.removed_reason || "No reason recorded."}
                    </div>
                    <form action={restoreMeeting} className="gapform">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="rep" value={known ? rep : ""} />
                      <input type="hidden" name="removed" value="1" />
                      <button className="choice" type="submit">Put it back</button>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="choices">
                      <span className="choices-label">Status</span>
                      {STATUSES.map((s) => (
                        <form action={setMeetingStatus} key={s}>
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="rep" value={known ? rep : ""} />
                          <button
                            className={m.status === s ? "choice on" : "choice"}
                            type="submit" name="status" value={s}
                            disabled={m.status === s}
                          >
                            {s.replace(/_/g, " ")}
                          </button>
                        </form>
                      ))}
                    </div>

                    {m.origin === "call" ? (
                      <p style={{ marginBottom: 0 }}>
                        This meeting came from a call on {prettyDate(m.call_date)}, so its dates and
                        note are the call&rsquo;s — change them there and the two cannot disagree.{" "}
                        <a className="drilled" href="/meetings#calls">Find the call below &rarr;</a>
                      </p>
                    ) : (
                      <>
                        <div className="choices">
                          <span className="choices-label">Fix a detail</span>
                          <form action={editMeeting} className="gapform">
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="rep" value={known ? rep : ""} />
                            <input name="name" defaultValue={m.prospect_name ?? ""}
                              placeholder="Prospect name *" required style={{ minWidth: 170 }} />
                            <input name="email" type="email" defaultValue={m.prospect_email ?? ""}
                              placeholder="Email" style={{ minWidth: 190 }} />
                            <input name="company" defaultValue={m.company ?? ""}
                              placeholder="Company" style={{ minWidth: 150 }} />
                            <label className="datefield">
                              <span>Happens on</span>
                              <input type="date" name="date" defaultValue={m.meeting_date ?? ""} required />
                            </label>
                            <label className="datefield">
                              <span>Agreed on</span>
                              <input type="date" name="booked_on" defaultValue={m.booked_on ?? ""} />
                            </label>
                            <select name="group" defaultValue={m.group_id ?? ""}>
                              <option value="">No campaign</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>{g.display_name}</option>
                              ))}
                            </select>
                            <select name="evidence" defaultValue={m.evidence}>
                              <option value="calendar">calendar invite</option>
                              <option value="tool">in the tool</option>
                              <option value="crm">in the CRM</option>
                              <option value="chat">said in chat</option>
                            </select>
                            <input name="note" defaultValue={m.note ?? ""} placeholder="Note"
                              style={{ flex: 2, minWidth: 190 }} />
                            <button className="choice" type="submit">Save</button>
                          </form>
                        </div>

                        {/* Cancel is for a meeting that was real. This is for
                            one that never was, so it asks why — the row is kept
                            as evidence, and evidence with no explanation is
                            just an absence. */}
                        <div className="choices">
                          <span className="choices-label">Remove</span>
                          <form action={removeMeeting} className="gapform">
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="rep" value={known ? rep : ""} />
                            <input name="reason" required style={{ minWidth: 240 }}
                              placeholder="Why? e.g. duplicate of the call-logged one" />
                            <button className="choice" type="submit">Remove it</button>
                          </form>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </details>
        );
      })}

      <h2 id="calls">
        {showAllCalls ? "Phone calls — every outcome" : "Phone calls that booked a meeting"}
      </h2>
      <div className="segrow">
        <span className="note">
          {showAllCalls
            ? `${num(shownCalls.length)} calls logged, every outcome.`
            : `${num(bookedCalls.length)} booked a meeting · ${num(calls.length - bookedCalls.length)} other outcomes hidden.`}
        </span>
        <a className="choice" href={callToggle(showAllCalls ? null : "all")}>
          {showAllCalls ? "Booked meetings only" : "Show all outcomes"}
        </a>
      </div>

      {shownCalls.map((c, i) => {
        const camp = campOfCall(c);
        const label = camp ? `Outbound — ${camp.display_name}` : c.campaign_label || "Cold Call";
        const workspace = camp && c.contact_id
          ? `/calls/${encodeURIComponent(c.rep || camp.owner || "all")}/${camp.slug}?open=${c.contact_id}#c-${c.contact_id}`
          : null;
        return (
          <details className="mrow" key={c.id} style={{ animationDelay: `${0.04 + Math.min(i, 12) * 0.03}s` }}>
            <summary>
              <span className="glyph" style={{ background: "var(--tint-n)", color: "var(--ink-1)" }}>
                {initials(c.prospect_name)}
              </span>
              <span className="meat">
                <span className="who">{c.prospect_name}</span>
                <span className="line">{[org(c), label].filter(Boolean).join(" — ")}</span>
              </span>
              <Pill status={c.outcome} />
              <span className="when">{prettyDate(c.call_date)}</span>
              <Chev />
            </summary>
            <div className="mbody">
              <div className="inner">
                <div className="meta">
                  <div><div className="k">Company</div><div className="v">{org(c) || "—"}</div></div>
                  <div><div className="k">Campaign</div><div className="v">{label}</div></div>
                  <div><div className="k">Rep</div><div className="v">{c.rep || "—"}</div></div>
                  <div><div className="k">Date</div><div className="v">{prettyDate(c.call_date)}</div></div>
                  <div><div className="k">Callback</div><div className="v">
                    {c.callback_date ? prettyDate(c.callback_date) : "—"}
                  </div></div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="k">Note</div><div className="v">{c.note || "—"}</div>
                  </div>
                </div>
                {workspace ? (
                  <p style={{ marginBottom: 0 }}>
                    <a className="drilled" href={workspace}>
                      Open {c.prospect_name.split(" ")[0]} in the call workspace — history, crib and buildings &rarr;
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        );
      })}
      {!shownCalls.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>
          {showAllCalls ? "No phone calls logged yet." : "No calls have booked a meeting yet."}
        </p></div>
      ) : null}

      <div className="range" style={{ marginTop: 18 }}>
        <a href={listHref({ metric: "meetings", range: "all" })}>Every meeting as a list &rarr;</a>
      </div>
    </>
  );
}
