import { db, num, prettyDate } from "../../../lib/db";
import { callRepList, dialCount } from "../../../lib/calls";
import { Tile, Pill } from "../../../components/ui";
import { adoptOrphanCall } from "../actions";

export const dynamic = "force-dynamic";

const ROLES = [["engineer", "Engineer"], ["owner", "Owner"], ["other", "Other / not sure"]];

/**
 * The calls that belong to nobody.
 *
 * A `phone_calls` row with no `contact_id` is counted by the Overview tile and
 * by "People reached · phoned", and is invisible on every campaign page and in
 * every rep's numbers — so no two pages on this site can be reconciled while
 * one exists. Measured 20 Aug 2026: 16 rows on the Overview, 13 across every
 * campaign page, and the 3 in between are all here.
 *
 * The missing facts are not recoverable by reading. They are in somebody's
 * memory, so this page is a form rather than a report.
 */
export default async function OrphanCalls({ searchParams }) {
  const sp = searchParams ?? {};
  const [{ reps, campaigns }, { data: calls }] = await Promise.all([
    callRepList(),
    db
      .from("phone_calls")
      .select("id, call_date, prospect_name, company, campaign_label, outcome, note, rep, callback_date")
      .is("deleted_at", null)
      .is("contact_id", null)
      .order("call_date", { ascending: false }),
  ]);

  const orphans = calls ?? [];
  const lists = campaigns ?? [];

  return (
    <>
      <div className="rise">
        <h1>Calls on no list</h1>
        <p className="sub">
          {orphans.length
            ? <>These {num(orphans.length)} call{orphans.length === 1 ? "" : "s"} have no
              contact record, so they are counted on the Overview and are invisible on every
              campaign page and in every rep&rsquo;s numbers. Nothing in the database can fill
              that in. Say who each person was, which list they belong on and who rang
              them, and the gap closes.</>
            : <>Every logged call now sits on a list and belongs to a rep. The Overview&rsquo;s
              &ldquo;Calls logged&rdquo; and the campaign pages count the same dials.</>}
        </p>
      </div>

      <div className="range" style={{ marginBottom: 18 }}>
        <a href="/calls">&larr; All reps</a>
      </div>

      {sp.err ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn-ink)" }}>
          <p style={{ margin: 0 }}>
            <b>That didn&rsquo;t save.</b> {sp.err} <a href="/calls/orphans">dismiss</a>
          </p>
        </div>
      ) : null}

      <div className="grid g4" style={{ marginBottom: 30 }}>
        <Tile label="Calls with no contact" value={num(orphans.length)} raw={orphans.length}
          tone={orphans.length ? "bad" : "muted"} note="counted on the Overview, on no campaign page" />
        <Tile label="Dials behind them" value={num(dialCount(orphans))} raw={dialCount(orphans)}
          tone={orphans.length ? undefined : "muted"} note="one person on one day" />
        <Tile label="With no rep" value={num(orphans.filter((c) => !c.rep).length)}
          raw={orphans.filter((c) => !c.rep).length} tone="muted" note="in nobody's numbers" />
        <Tile label="Call lists to choose from" value={num(lists.length)} raw={lists.length}
          tone="muted" note="where the person will be filed" />
      </div>

      {!orphans.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>Nothing to fix.</p></div>
      ) : null}

      {orphans.map((c, i) => (
        <div className="card" key={c.id} style={{ marginBottom: 18, animationDelay: `${0.05 + i * 0.05}s` }}>
          <div className="meta" style={{ marginBottom: 14 }}>
            <div><div className="k">Who we rang</div><div className="v">{c.prospect_name || "—"}</div></div>
            <div><div className="k">Date</div><div className="v">{prettyDate(c.call_date)}</div></div>
            <div><div className="k">Outcome</div><div className="v"><Pill status={c.outcome} /></div></div>
            <div><div className="k">Label on the row</div><div className="v">{c.campaign_label || "—"}</div></div>
            <div><div className="k">Company</div><div className="v">{c.company || "—"}</div></div>
            <div><div className="k">Rep on the row</div><div className="v">{c.rep || <span className="dim">nobody</span>}</div></div>
          </div>
          {c.note ? <p className="note" style={{ marginTop: 0 }}>{c.note}</p> : null}

          <h2>What was missing</h2>
          {/* Everything the database cannot work out for itself. `full_name` is
              prefilled from the name the call already carries, because that is
              the only identity these rows have and retyping it is how a
              second row for one human gets created. */}
          <form action={adoptOrphanCall} className="gapform">
            <input type="hidden" name="call_id" value={c.id} />
            <input type="hidden" name="path" value="/calls/orphans" />
            <label className="datefield" style={{ flex: "1 1 200px" }}>
              <span>Which list</span>
              <select name="campaign_id" required defaultValue="">
                <option value="" disabled>pick one</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.display_name}</option>)}
              </select>
            </label>
            <label className="datefield" style={{ flex: "1 1 180px" }}>
              <span>Who made the call</span>
              <select name="rep" required defaultValue={c.rep ?? ""}>
                <option value="" disabled>pick one</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="datefield" style={{ flex: "1 1 180px" }}>
              <span>Their name</span>
              <input name="full_name" defaultValue={c.prospect_name ?? ""} required />
            </label>
            <label className="datefield" style={{ flex: "1 1 160px" }}>
              <span>Role</span>
              <select name="role" defaultValue="other">
                {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="datefield" style={{ flex: "1 1 200px" }}>
              <span>Company</span>
              <input name="org_name" defaultValue={c.company ?? ""} placeholder="firm or building owner" />
            </label>
            <label className="datefield" style={{ flex: "1 1 170px" }}>
              <span>Phone</span>
              <input name="phone" placeholder="the number you rang" />
            </label>
            <label className="datefield" style={{ flex: "1 1 220px" }}>
              <span>Email</span>
              <input name="email" type="email" placeholder="if you have one" />
            </label>
            <button className="choice" type="submit">Put this call on the list</button>
          </form>
          <p className="note" style={{ marginBottom: 0 }}>
            If someone by this name is already on the list you pick, this call joins them
            rather than making a second row — and a box left empty never wipes what is
            already recorded against them.
          </p>
        </div>
      ))}
    </>
  );
}
