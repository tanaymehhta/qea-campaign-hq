/**
 * What is running, in the one place that says so.
 *
 * The complaint this answers: press Restart on the queue and the page you land
 * back on is identical to the one you left. It was not lying — nothing on it
 * had asked the database whether anything was running, and nothing asked again
 * — but a button that produces no visible change reads as a button that did
 * nothing, and the honest response to that is to press it four more times.
 *
 * Fixed to the corner rather than a block at the foot of the document. The
 * queue runs to a couple of thousand pixels and the card you pressed is usually
 * far above the fold; a dock at the bottom of the page is invisible at exactly
 * the moment it is needed.
 *
 * One per page, and the only thing in the section that plays the mark. The
 * small rings on the timeline dots stay — those say which stage is live and
 * which are waiting their turn, which is a different sentence from "the system
 * is working" and one this cannot say.
 *
 * A server component: autoplay, loop and muted are attributes, and the polling
 * is `Live`, which already exists. No new client JavaScript, so the section
 * keeps its one-JS-file rule.
 */

const STAGE_WORDS = {
  1: "researching the company",
  2: "finding the people",
  3: "writing the emails",
};

/**
 * How long it has been going, in the units a person waiting actually uses.
 *
 * Computed on the server, which is only honest because the page re-renders
 * every four seconds — a number that ages on screen for ten minutes would be
 * worse than no number. Under five seconds it says nothing rather than
 * flickering through "1s, 2s": the press was a moment ago and the reader knows.
 */
function sinceWords(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (!Number.isFinite(secs) || secs < 5) return null;
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return mins < 60 ? `${mins}m ${secs % 60}s` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * `rows` is `{ id, name, busy }` for every company in flight — the queue's own
 * lead objects work unchanged.
 *
 * It renders the batch as well as anything a rep pressed. The 3-hourly schedule
 * holds the same workflow-wide concurrency group, so a restart pressed while it
 * is mid-flight waits behind it; a dock that showed only your own press would
 * leave that wait unexplained.
 */
export function Running({ rows = [], linked = true }) {
  const live = rows.filter((r) => r.busy);
  if (!live.length) return null;

  return (
    <aside className="i-dock" aria-live="polite">
      {/* The mark itself, clipped to its disc: the file is a white square with
          no alpha, and this app has a dark theme. `circle(44%)` cuts the white
          away and leaves the badge, in both.

          The still sits behind it as the wrapper's background, which is what
          shows when a reader has asked for no motion — the dock keeps its
          identity rather than losing an eye and going lopsided. */}
      <span className="i-dockicon" aria-hidden="true">
        <video className="i-dockmark" src="/qea-running.mp4"
               autoPlay loop muted playsInline />
      </span>
      <div className="i-dockbody">
        <div className="head">
          Restarting{live.length > 1 ? ` ${live.length} companies` : ""}
        </div>
        {live.map((r) => {
          const ago = sinceWords(r.busy.since);
          return (
            <div className="row" key={r.id}>
              {linked
                ? <a href={`/inbound/company/${r.id}`}>{r.name}</a>
                : <span className="nm">{r.name}</span>}
              <span className="what">
                {r.busy.phase === "starting"
                  ? "starting"
                  : STAGE_WORDS[r.busy.stage] ?? "running"}
                {ago ? ` · ${ago}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
