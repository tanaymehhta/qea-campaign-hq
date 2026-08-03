import { db, prettyWhen } from "../../lib/db";
import { Tile, Pill } from "../../components/ui";
import { setFeedbackStatus } from "./actions";

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

          <div className="choices">
            <form action={setFeedbackStatus} className="gapform">
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="status" value={f.status === "open" ? "done" : "open"} />
              <button className="choice" type="submit">
                {f.status === "open" ? "Mark done" : "Reopen"}
              </button>
            </form>
            <a className="choice" href={f.page.startsWith("/") ? f.page : "/"}>Go to the page →</a>
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
    </>
  );
}
