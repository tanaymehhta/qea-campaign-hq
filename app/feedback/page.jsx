import { db, prettyWhen } from "../../lib/db";
import { Tile, Pill } from "../../components/ui";
import { runState, REPO } from "../../lib/github";
import RefreshWhile from "../../components/refresh-while";
import { setFeedbackStatus, askClaude } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS = { open: "still open", done: "done" };

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
  const rows = filter ? all.filter((f) => f.status === filter) : all;

  const url = (path) => db.storage.from("feedback").getPublicUrl(path).data.publicUrl;
  const here = (f) => (f ? `/feedback?f=${f}` : "/feedback");

  // Only the rows on screen, and only the ones somebody actually pressed the
  // button on. Everything else costs no call at all.
  const runs = Object.fromEntries(
    await Promise.all(
      rows.filter((f) => f.asked_at).map(async (f) => [f.id, await runState(f.id, f.asked_at)]),
    ),
  );
  const anyWorking = Object.values(runs).some((r) => r?.state === "working");

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
          <b>Thanks — that&rsquo;s saved.</b> It&rsquo;s at the top of the list below.
        </div>
      ) : null}
      {sp.asked ? (
        <div className="warnbox w">
          <b>Handed to Claude.</b>{" "}
          <a href="https://github.com/tanaymehhta/qea-campaign-hq/actions/workflows/feedback-agent.yml"
             target="_blank" rel="noreferrer">Watch it work</a>, then{" "}
          <a href="https://github.com/tanaymehhta/qea-campaign-hq/pulls"
             target="_blank" rel="noreferrer">read the pull request</a> it opens.
          Nothing reaches the live site until you merge it.
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

      <h2>{filter ? `Feedback ${FILTERS[filter]}` : "Everything sent"} — {rows.length}</h2>
      {filter ? (
        <div className="segrow">
          <a className="choice" href={here(null)}>&times; clear filter</a>
        </div>
      ) : null}

      {rows.map((f, i) => (
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

          <Run run={runs[f.id]} />

          <div className="choices">
            <form action={setFeedbackStatus} className="gapform">
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="status" value={f.status === "open" ? "done" : "open"} />
              <button className="choice" type="submit">
                {f.status === "open" ? "Mark done" : "Reopen"}
              </button>
            </form>
            <a className="choice" href={f.page.startsWith("/") ? f.page : "/"}>Go to the page →</a>
            {/* Only on what's still open, and only once: handing Claude
                something already asked for is how you get a second run on a
                branch it is still pushing to. */}
            {f.status === "open" && (!runs[f.id] || runs[f.id].state === "stalled") ? (
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

      {!rows.length ? (
        <div className="card">
          <p className="empty" style={{ padding: 0 }}>
            {filter ? "Nothing in this view." : "Nothing yet — the box is at the foot of every page."}
          </p>
        </div>
      ) : null}

      {/* Mounted only while something is actually in flight, so the polling
          stops by itself once the last card has a pull request on it. */}
      {anyWorking ? <RefreshWhile /> : null}
    </>
  );
}

/**
 * What became of the press, said on the card that was pressed.
 *
 * The button used to vanish into nothing: the page looked identical before and
 * after, and the only way to find out whether anything had started was to open
 * GitHub. Each state here answers the question the reader actually has, which
 * is "can I look at it yet".
 */
function Run({ run }) {
  if (!run) return null;

  if (run.state === "working") {
    return (
      <div className="runline">
        <span className="pulse" aria-hidden="true" />
        <b>Claude is working on this.</b>
        <span className="note">
          started {prettyWhen(run.askedAt)} — usually about two minutes
        </span>
        <a className="note" style={{ marginLeft: "auto" }}
          href={`https://github.com/${REPO}/actions/workflows/feedback-agent.yml`}
          target="_blank" rel="noreferrer">watch it →</a>
      </div>
    );
  }

  if (run.state === "stalled") {
    return (
      <div className="runline bad">
        <b>That run didn&rsquo;t finish.</b>
        <span className="note">Nothing was changed. Try again, or look at why.</span>
        <a className="note" style={{ marginLeft: "auto" }}
          href={`https://github.com/${REPO}/actions/workflows/feedback-agent.yml`}
          target="_blank" rel="noreferrer">see the run →</a>
      </div>
    );
  }

  if (run.merged) {
    return (
      <div className="runline good">
        <b>Shipped.</b>
        <span className="note">This is live on the dashboard now.</span>
        <a className="note" style={{ marginLeft: "auto" }} href={run.prUrl}
          target="_blank" rel="noreferrer">what changed →</a>
      </div>
    );
  }

  if (run.closed) {
    return (
      <div className="runline">
        <b>Turned down.</b>
        <span className="note">The change was closed without going live.</span>
        <a className="note" style={{ marginLeft: "auto" }} href={run.prUrl}
          target="_blank" rel="noreferrer">read it →</a>
      </div>
    );
  }

  return (
    <div className="runline good">
      <b>Ready to look at.</b>
      <span className="note">{run.prTitle}</span>
      <div className="choices" style={{ marginLeft: "auto", marginTop: 0 }}>
        {/* The preview first and worded as a place rather than a link: it is a
            running copy of the change, and it is the only one of these two a
            person who does not read code has any use for. */}
        {run.preview ? (
          <a className="choice" href={run.preview} target="_blank" rel="noreferrer">
            See it live →
          </a>
        ) : (
          <span className="note">preview still building…</span>
        )}
        <a className="choice" href={run.prUrl} target="_blank" rel="noreferrer">
          Read the change
        </a>
      </div>
    </div>
  );
}
