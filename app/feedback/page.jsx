import { db, prettyWhen } from "../../lib/db";
import { Tile, Pill } from "../../components/ui";
import { runStates, MOVING, REPO, shareable } from "../../lib/github";
import RefreshWhile from "../../components/refresh-while";
import Elapsed from "../../components/elapsed";
import { setFeedbackStatus, askClaude, ship, discard } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS = { open: "still open", done: "done", review: "waiting on you" };

/**
 * Everything the team has sent, newest first. A suggestion box nobody reads is
 * worse than none, so this is a working list: two states, one click between
 * them, and the count of what's open sits at the top where it nags.
 */
export default async function Feedback({ searchParams }) {
  const sp = searchParams ?? {};
  const filter = FILTERS[sp.f] ? sp.f : null;

  const { data } = await db.from("feedback").select("*").order("created_at", { ascending: false });
  const all = data ?? [];
  const open = all.filter((f) => f.status === "open");
  // "review" is a filter on what GitHub says rather than on a column, so it is
  // applied after the states come back, below.
  const rows = filter && filter !== "review" ? all.filter((f) => f.status === filter) : all;

  const url = (path) => db.storage.from("feedback").getPublicUrl(path).data.publicUrl;
  const here = (f) => (f ? `/feedback?f=${f}` : "/feedback");

  // Only the rows on screen, and only the ones that were actually dispatched.
  // One call covers every run; the rest is one lookup per asked card.
  const runs = await runStates(rows);
  const moving = Object.values(runs).some((r) => MOVING.includes(r?.phase));
  const shown = filter === "review"
    ? rows.filter((f) => runs[f.id]?.phase === "ready")
    : rows;

  return (
    <>
      <div className="rise">
        <h1>Feedback</h1>
        <p className="sub">
          What the team has asked for, from the page they asked for it on. Sent with the box at
          the foot of every page.
        </p>
      </div>

      {sp.sent ? (
        <div className="warnbox w">
          <b>Thanks — Claude is on it.</b> It&rsquo;s at the top of the list below, and the
          card will show a link the moment there is something to look at.
        </div>
      ) : null}
      {sp.asked ? (
        <div className="warnbox w">
          <b>Started again.</b> Watch the card below.
        </div>
      ) : null}
      {sp.shipped ? (
        <div className="warnbox w">
          <b>That&rsquo;s going on the live site.</b> Give it a minute to build, then
          reload the page it changed.
        </div>
      ) : null}
      {sp.err ? (
        <div className="warnbox">
          <b>That didn&rsquo;t save.</b> {sp.err}
        </div>
      ) : null}

      <div className="grid g3" style={{ marginBottom: 26 }}>
        <Tile hero label="Still open" value={open.length} raw={open.length}
          tone={open.length ? undefined : "muted"} note="asked for, not done yet"
          href={here("open")} />
        <Tile hero label="Done" value={all.length - open.length} raw={all.length - open.length}
          tone={all.length - open.length ? undefined : "muted"} href={here("done")} />
        <Tile hero label="Everything" value={all.length} raw={all.length}
          tone={all.length ? undefined : "muted"} note="since the box went up" href={here(null)} />
      </div>

      <h2>{filter ? `Feedback ${FILTERS[filter]}` : "Everything sent"} — {shown.length}</h2>
      {filter ? (
        <div className="segrow">
          <a className="choice" href={here(null)}>&times; clear filter</a>
        </div>
      ) : null}

      {shown.map((f, i) => (
        <div className="card" key={f.id}
          style={{ marginBottom: 12, animation: "fadeUp .45s cubic-bezier(.22,.8,.3,1) both",
                   animationDelay: `${0.04 + Math.min(i, 20) * 0.03}s` }}>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <Pill status={f.status} />
            <span className="who" style={{ fontWeight: 600 }}>{f.rep || "someone"}</span>
            <code>{f.page}</code>
            <span className="note" style={{ marginLeft: "auto" }}>{prettyWhen(f.created_at)}</span>
          </div>

          <p style={{ margin: "12px 0 0", whiteSpace: "pre-wrap", maxWidth: "74ch" }}>{f.body}</p>

          {f.screenshot ? (
            <a href={url(f.screenshot)} target="_blank" rel="noreferrer">
              {/* Not next/image: this is a handful of internal screenshots, and the
                  optimizer would be one more thing to configure for no gain. */}
              <img className="shot" src={url(f.screenshot)} alt="Screenshot attached to this feedback" />
            </a>
          ) : null}

          <Run run={runs[f.id]} id={f.id} />

          <div className="choices">
            <form action={setFeedbackStatus} className="gapform">
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="status" value={f.status === "open" ? "done" : "open"} />
              <button className="choice" type="submit">
                {f.status === "open" ? "Mark done" : "Reopen"}
              </button>
            </form>
            <a className="choice" href={f.page.startsWith("/") ? f.page : "/"}>Go to the page →</a>
            {/* Only after a run that produced nothing. Sending the feedback is
                the start now, and pressing this while one is working would put
                a second run on a branch the first is still pushing to. */}
            {f.status === "open" && (!runs[f.id] || runs[f.id].phase === "failed") ? (
              <form action={askClaude} className="gapform">
                <input type="hidden" name="id" value={f.id} />
                <button className="choice" type="submit">
                  {runs[f.id] ? "Try again" : "Ask Claude to build this"}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ))}

      {!shown.length ? (
        <div className="card">
          <p className="empty" style={{ padding: 0 }}>
            {filter ? "Nothing in this view." : "Nothing yet — the box is at the foot of every page."}
          </p>
        </div>
      ) : null}

      {/* Mounted only while something is actually in flight, so the polling
          stops by itself once the last card has a pull request on it. */}
      {moving ? <RefreshWhile /> : null}
    </>
  );
}

/** The four things a reader wants to know, in the order they become true. */
const PHASES = {
  queued:   { line: "Queued.", note: "something else is being built first — this one is next." },
  working:  { line: "Claude is working on this.", note: "reading the page, editing the file." },
  building: { line: "Built. Putting up a copy you can look at.", note: "usually another half minute." },
};

/**
 * What became of the feedback, said on the card that carries it.
 *
 * Sending used to save a row and stop. Every state here answers the same
 * question at a different moment — "can I look at it yet" — and the two that
 * are still moving carry a clock, because a page where nothing changes for two
 * minutes reads as a page that has hung.
 */
function Run({ run, id }) {
  if (!run) return null;
  const actions = `https://github.com/${REPO}/actions/workflows/feedback-agent.yml`;

  if (PHASES[run.phase]) {
    const { line, note } = PHASES[run.phase];
    return (
      <div className="runline">
        <span className="pulse" aria-hidden="true" />
        <b>{line}</b>
        <span className="note">{note}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <Elapsed since={run.since} />
          <a className="note" href={run.runUrl ?? actions} target="_blank" rel="noreferrer">
            watch it →
          </a>
        </span>
      </div>
    );
  }

  if (run.phase === "failed") {
    return (
      <div className="runline bad">
        <b>That run stopped without building anything.</b>
        <span className="note">Nothing was changed. Try again, or read why.</span>
        <a className="note" style={{ marginLeft: "auto" }} href={run.runUrl ?? actions}
          target="_blank" rel="noreferrer">see the run →</a>
      </div>
    );
  }

  if (run.phase === "shipped") {
    return (
      <div className="runline good">
        <b>Live on the dashboard.</b>
        <span className="note">Shipped {prettyWhen(run.since)}.</span>
        <a className="note" style={{ marginLeft: "auto" }} href={run.prUrl}
          target="_blank" rel="noreferrer">what changed →</a>
      </div>
    );
  }

  if (run.phase === "closed") {
    return (
      <div className="runline">
        <b>Turned down.</b>
        <span className="note">Closed without going live.</span>
        <a className="note" style={{ marginLeft: "auto" }} href={run.prUrl}
          target="_blank" rel="noreferrer">read it →</a>
      </div>
    );
  }

  // ready
  return (
    <div className="runline good">
      <b>Ready to look at.</b>
      <span className="note">{run.prTitle}</span>
      <div className="choices" style={{ marginLeft: "auto", marginTop: 0 }}>
        {/* The preview first and worded as a place rather than a link: it is a
            running copy of the change, and it is the only one of these three a
            person who does not read code has any use for. The same button that
            ships it is waiting at the top of that page.

            shareable() carries the bypass secret, so a colleague without a
            Vercel account can open this. Without the secret set it is the plain
            preview URL, which still works for anyone who is signed in. */}
        <a className="choice go" href={shareable(run.preview)} target="_blank" rel="noreferrer">
          See it live →
        </a>
        {/* Yes and no, side by side and the same size. A page that offers only
            the yes makes turning something down feel like a failure to find
            the button for it. */}
        <form action={ship} className="gapform">
          <input type="hidden" name="pr" value={run.prNumber} />
          <input type="hidden" name="id" value={id} />
          <button className="choice yes" type="submit">Yes, put it live</button>
        </form>
        <form action={discard} className="gapform">
          <input type="hidden" name="pr" value={run.prNumber} />
          <button className="choice no" type="submit">No</button>
        </form>
        <a className="choice" href={run.prUrl} target="_blank" rel="noreferrer">
          Read the change
        </a>
      </div>
    </div>
  );
}

