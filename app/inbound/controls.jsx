import { movePerson, setPersonReady, setCompanyRelevant } from "./actions";

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
 * Rendered disabled, and the title says exactly what is missing rather than
 * "coming soon". The three writes this section can make all go through
 * `security definer` functions, and there is no `inbound_request_rerun` among
 * them — a button that queued nothing but said "Restarting" would be the worst
 * thing on the page, because the whole point of this view is that a rep can
 * trust what it says happened.
 */
export function RestartButton({ small }) {
  return (
    <button type="button" disabled className={`i-act${small ? " small" : ""}`}
            title="Not wired up: the backend has no inbound_request_rerun function to call yet">
      Restart
    </button>
  );
}
