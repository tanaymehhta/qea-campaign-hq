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
    <span className="lab-rank">
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
 * Overrule Ready / Needs a check.
 *
 * Three states, not two: once a human has answered, the row stops listening to
 * the classifier, so there has to be a way to hand it back. `manualled` is the
 * override being set at all — `null` means nobody has touched it.
 */
export function ReadyToggle({ personId, companyId, ready, manualled }) {
  return (
    <span className="lab-toggle">
      <form action={setPersonReady}>
        <input type="hidden" name="id" value={personId} />
        <input type="hidden" name="company" value={companyId ?? ""} />
        <input type="hidden" name="ready" value={ready ? "no" : "yes"} />
        <button type="submit" className={ready ? "off" : "on"}>
          {ready ? "Mark not ready" : "Mark ready"}
        </button>
      </form>
      {manualled ? (
        <form action={setPersonReady}>
          <input type="hidden" name="id" value={personId} />
          <input type="hidden" name="company" value={companyId ?? ""} />
          <input type="hidden" name="ready" value="clear" />
          <button type="submit" className="plain" title="Let the pipeline decide again">
            Undo
          </button>
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
 */
export function RelevanceToggle({ companyId, relevant }) {
  return (
    <span className="lab-toggle">
      <form action={setCompanyRelevant}>
        <input type="hidden" name="id" value={companyId} />
        <input type="hidden" name="relevant" value={relevant ? "no" : "yes"} />
        <button type="submit" className={relevant ? "off" : "on"}
                title={relevant
                  ? "Drop this account out of the queue"
                  : "Put it back in the queue and research it on the next run"}>
          {relevant ? "Move to not relevant" : "Mark relevant"}
        </button>
      </form>
    </span>
  );
}
