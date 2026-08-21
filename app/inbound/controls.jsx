import { movePerson, setPersonReady, setCompanyRelevant, restartCompany, setReachedOut } from "./actions";
import { ALL_REPS, repById } from "../../lib/inbound/routing";
import { prettyWhen } from "../../lib/db";

/** The same tick the timeline draws, at label size. */
const Tick = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The hand controls: reorder a person, overrule a verdict, move a company.
 *
 * Plain `<form action={serverAction}>`, so these are server components and the
 * section keeps its one-JavaScript-file rule — the copy button on a draft is
 * still the only client component here. The cost is a full round trip per click,
 * which is the right trade for buttons pressed a few times a day.
 *
 * Every control says what it will do rather than what it is: "not relevant"
 * beats an icon nobody can read twice.
 */

/** Up and down, within one company. Disabled at the ends rather than hidden —
 *  a control that vanishes at the top of a list looks like a rendering bug. */
export function RankButtons({ personId, companyId, first, last }) {
  return (
    <span className="i-rank">
      <form action={movePerson}>
        <input type="hidden" name="id" value={personId} />
        <input type="hidden" name="company" value={companyId ?? ""} />
        <input type="hidden" name="dir" value="up" />
        <button type="submit" disabled={first} title={first ? "Already first" : "Move up"}
                aria-label="Move up">&uarr;</button>
      </form>
      <form action={movePerson}>
        <input type="hidden" name="id" value={personId} />
        <input type="hidden" name="company" value={companyId ?? ""} />
        <input type="hidden" name="dir" value="down" />
        <button type="submit" disabled={last} title={last ? "Already last" : "Move down"}
                aria-label="Move down">&darr;</button>
      </form>
    </span>
  );
}

/**
 * Ready to email, as a toggle whose label is its state.
 *
 * It used to say what pressing it would do — "Mark ready" — next to a separate
 * line saying what was true, and a rep had to hold both in their head to read
 * either. Now the button says the state and the line under it says what
 * pressing it does. One control, two sentences, and the second one only fits
 * at `big`.
 *
 * Two sizes, one behaviour. `big` is the block at the top of a person page: it
 * is the first question anyone asks about a name, so it is the first thing on
 * the page and it is the size of the answer. The pill is the same control in a
 * list of eight people, where eight filled blocks would be unreadable.
 *
 * Three states underneath, not two: once a human has answered, the row stops
 * listening to the classifier, so there has to be a way to hand it back.
 * `manualled` is the override being set at all — `null` means nobody has
 * touched it.
 */
export function ReadyToggle({ personId, companyId, ready, manualled, big, note }) {
  const fields = (
    <>
      <input type="hidden" name="id" value={personId} />
      <input type="hidden" name="company" value={companyId ?? ""} />
      <input type="hidden" name="ready" value={ready ? "no" : "yes"} />
    </>
  );

  if (big) {
    return (
      <div>
        <form action={setPersonReady}>
          {fields}
          <button type="submit" className={`i-state ${ready ? "on" : "off"}`}>
            {ready ? "Ready to email" : "Not ready to email"}
            <span className="hint">
              {ready ? "Press again to hold them back" : "Press to clear them for sending"}
            </span>
          </button>
        </form>
        {(note || manualled) ? (
          <div className="i-inline" style={{ marginTop: 10, justifyContent: "flex-start" }}>
            {note ? <span className="i-note">{note}</span> : null}
            {manualled ? (
              <form action={setPersonReady}>
                <input type="hidden" name="id" value={personId} />
                <input type="hidden" name="company" value={companyId ?? ""} />
                <input type="hidden" name="ready" value="clear" />
                <button type="submit" className="undo"
                        title="Let the pipeline decide again">Undo</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <span className="i-inline">
      <form action={setPersonReady}>
        {fields}
        <button type="submit" className={`i-pill ${ready ? "on" : "off"}`}
                title={ready ? "Press to mark them not ready" : "Press to mark them ready"}>
          {ready ? "Ready to email" : "Not ready to email"}
        </button>
      </form>
      {manualled ? (
        <form action={setPersonReady}>
          <input type="hidden" name="id" value={personId} />
          <input type="hidden" name="company" value={companyId ?? ""} />
          <input type="hidden" name="ready" value="clear" />
          <button type="submit" className="undo" title="Let the pipeline decide again">Undo</button>
        </form>
      ) : null}
    </span>
  );
}

/**
 * Move a company between the queue and the ruled-out lane.
 *
 * Marking one relevant re-queues it for research rather than just relabelling
 * it, so the button is honest about costing money: the next run picks it up.
 *
 * It renders bare, with no wrapper, because it belongs inside an `.i-links`
 * row beside Queue and Website — it is a sideways move like the rest of them,
 * not a floating action strip of its own.
 */
export function RelevanceToggle({ companyId, relevant }) {
  return (
    <form action={setCompanyRelevant}>
      <input type="hidden" name="id" value={companyId} />
      <input type="hidden" name="relevant" value={relevant ? "no" : "yes"} />
      <button type="submit" className={relevant ? "danger" : ""}
              title={relevant
                ? "Drop this account out of the queue"
                : "Put it back in the queue and research it on the next run"}>
        {relevant ? "Move to not relevant" : "Mark relevant"}
      </button>
    </form>
  );
}

/**
 * Run the pipeline over this company again.
 *
 * Restarting runs from `stage` through to the written draft — never a single
 * step, because a stage whose input was never produced has nothing to read.
 *
 * For most of the queue this is not a convenience. The 3-hourly schedule only
 * picks up `research_status='new'`, which is one company; `--stranded` covers
 * another 41. The rest sit at `needs_review` after a classifier 402 and nothing
 * in the automation ever revisits them, so for them the button is the only
 * route back.
 *
 * The refusals — already running, pressed a minute ago, out of credit — live in
 * `inbound_request_rerun`, not here, so a hostile POST meets the same rules.
 *
 * While one is in flight this renders a line instead of a button, and the
 * caller collapses whatever red box it was sitting in. Not a disabled button: a
 * greyed-out control still reads as the thing you want, broken. And the guard
 * is here rather than at the five places that render one — the timeline's three
 * broken dots, the failed-research panel and the empty people panel are all the
 * same run, so they cannot be allowed five opinions about whether it is going.
 *
 * TODO: when sign-in lands, render this only for admins (requireAdmin() from
 * lib/auth.js) and pass the actor into `p_actor`, which is null today because
 * there is no session to name.
 */
export function RestartButton({ companyId, stage = 1, small, caveat, wasCredit, busy }) {
  // What this press will actually run, named in the title. "Restart" on a stuck
  // draft must not read as paying to research the company a second time. While
  // something is running it is that run's stage that matters, not this button's
  // — a live restart from stage 1 is doing all three whichever box you read it
  // from.
  const rest = ["research", "people", "the draft"].slice((busy?.stage ?? stage) - 1);
  const does = rest.length > 1
    ? `${rest.slice(0, -1).join(", ")} and then ${rest[rest.length - 1]}`
    : rest[0];

  if (busy) {
    return (
      <div className="i-running">
        Restarting — {does}.{" "}
        <span className="dim">
          {busy.phase === "starting"
            ? "GitHub is starting a machine — about twenty seconds."
            : "Running now."}
        </span>
      </div>
    );
  }

  // When the last attempt died on an empty account, no read here can tell
  // whether it has been topped up since — a balance is not in this database.
  // So the button stops guessing and hands the judgement to the person who
  // would have done the topping up.
  return (
    <form action={restartCompany} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={companyId ?? ""} />
      <input type="hidden" name="stage" value={stage} />
      <input type="hidden" name="force" value={wasCredit ? "yes" : ""} />
      <button type="submit" className={`i-act${small ? " small" : ""}`}
              disabled={!companyId}
              title={companyId
                ? `Runs ${does}. Starts in a second or two; most companies finish inside two minutes.`
                : "No company on this row to restart"}>
        {wasCredit ? "Restart anyway" : "Restart"}
      </button>
      {wasCredit ? (
        <div className="hint" style={{ marginTop: 8 }}>
          It ran out of credit last time. If you have topped the account up this
          will work; if not, it fails the same way and costs the search spend.
        </div>
      ) : null}
      {/* Where a re-run cannot fix what the reader is looking at. Sixty drafts
          across nine companies are held only by an empty `assigned_to`, and
          re-running writes the same mail for the same refusal. */}
      {caveat ? <div className="hint" style={{ marginTop: 8 }}>{caveat}</div> : null}
    </form>
  );
}

/**
 * The tick: somebody has looked at this account and reached out.
 *
 * Three renderings of one control, and which one you get depends on where you
 * are standing — because the question "who did this" already has an answer in
 * two of the three cases and asking it again is a click nobody should have to
 * make.
 *
 *   ticked            the answer, and the way to take it back
 *   inside a rep      one press. You are in Mark Vasu's queue, so it was
 *                     Mark Vasu, and a dropdown here would only ever be used to
 *                     pick the name already at the top of the page
 *   All reps          the box opens a name first. Nothing is saved until one is
 *                     chosen — an account ticked by nobody is worse than one
 *                     nobody ticked
 *
 * The third is a hidden checkbox and a sibling selector, so the panel opens
 * without a byte of JavaScript and this stays a server component like the rest
 * of `controls.jsx`. The checkbox carries no `name`: it opens the drawer, it is
 * not the answer, and it must not be posted.
 */
export function ReachedOut({ companyId, touch, rep }) {
  if (touch) {
    const who = repById(touch.by);
    return (
      <form action={setReachedOut} className="i-touch is-on">
        <input type="hidden" name="id" value={companyId} />
        <input type="hidden" name="want" value="no" />
        <button type="submit" title="Press to undo — this goes back to nobody having reached out">
          <span className="box"><Tick /></span>
          Reached out
          <span className="dim">
            {" "}· {who ? who.name.split(" ")[0] : touch.by} · {prettyWhen(touch.at)}
          </span>
        </button>
      </form>
    );
  }

  if (rep && rep !== "all" && repById(rep)) {
    const who = repById(rep);
    return (
      <form action={setReachedOut} className="i-touch">
        <input type="hidden" name="id" value={companyId} />
        <input type="hidden" name="by" value={rep} />
        <button type="submit" title={`Marks this reached out by ${who.name}`}>
          <span className="box" />
          Reached out<span className="dim">{" "}· as {who.name.split(" ")[0]}</span>
        </button>
      </form>
    );
  }

  // `companyId` is in the id because these render forty to a page and a label
  // has to point at its own checkbox and no other one.
  const gate = `touch-${companyId}`;
  return (
    <form action={setReachedOut} className="i-touch">
      <input type="hidden" name="id" value={companyId} />
      <input type="checkbox" id={gate} className="gate" />
      <label htmlFor={gate} title="Tick when you have reached out, then say who you are">
        <span className="box" />Reached out
      </label>
      <span className="ask">
        <select name="by" defaultValue="">
          <option value="" disabled>Who reached out?</option>
          {ALL_REPS.filter((r) => r.id !== "unrouted").map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button type="submit">Save</button>
      </span>
    </form>
  );
}
