import { nodeState, nodeFacts, nodeErrors, secs, money } from "../../lib/pipeline";

/**
 * One node = one chip, left to right in execution order.
 *
 * Extracted from the company page when the run log needed the same strip: a
 * second copy would have been the place where "ok but it wrote nothing" stopped
 * being visible on one of the two pages.
 *
 * The cost is per node and comes off the node's own row, which is the finest
 * grain the pipeline records — a stage's bill, itemised by the step that ran it.
 */
export function NodeChip({ n }) {
  const state = nodeState(n);
  const errs = nodeErrors(n);
  const cost = Number(n.llm_cost_usd ?? 0);
  return (
    // `s-` prefix: globals.css carries a bare `.ok` text utility, so
    // `class="ib-node ok"` had been painting every healthy chip's text green and
    // bold since this strip shipped — which is exactly backwards, since the
    // chips worth looking at are the degraded ones.
    <div className={`ib-node s-${state}`}>
      <div className="ib-node-name">{n.sequence}. {n.node_name}</div>
      <div className="ib-node-time">
        {state === "running" ? "running…" : secs(n.duration_ms)}
        {cost ? ` · ${money(cost)}` : ""}
        {state === "degraded" ? " · degraded" : ""}
      </div>
      <div className="ib-facts">
        {nodeFacts(n).map(([k, v]) => (
          <div className="ib-fact" key={k}><b>{v}</b> {k}</div>
        ))}
      </div>
      {errs.length ? (
        <div className="ib-err">
          {errs.slice(0, 2).map((e, i) => <div key={i}>{e.slice(0, 200)}</div>)}
          {errs.length > 2 ? <div>+{errs.length - 2} more</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The strip. It scrolls rather than wrapping so a sequence reads as a sequence. */
export function NodeStrip({ nodes }) {
  if (!nodes?.length) return <div className="ib-not-run">No node events recorded.</div>;
  return (
    <div className="ib-flow">
      {nodes.map((n, i) => (
        <span key={n.id} style={{ display: "contents" }}>
          {i > 0 ? <span className="ib-arrow">&rsaquo;</span> : null}
          <NodeChip n={n} />
        </span>
      ))}
    </div>
  );
}
