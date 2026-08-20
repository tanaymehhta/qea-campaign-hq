import { db, num } from "../../lib/db";
import { callRepList, dialCount } from "../../lib/calls";

export const dynamic = "force-dynamic";

/**
 * Names only. Clicking a name is how you say who you are — the same
 * no-login contract as the ?rep= picker on Overview and Meetings.
 */
export default async function Calls() {
  const [{ reps, campaigns }, { data: calls }, { count: orphans }] = await Promise.all([
    callRepList(),
    // contact_id + call_date, because a dial is one person on one day: logCall
    // writes a row per ticked outcome and `.length` counted those instead.
    db.from("phone_calls").select("rep, outcome, contact_id, prospect_name, call_date").is("deleted_at", null),
    // Calls with no contact row belong to no list and no rep, so the chips
    // below cannot add up to the Overview's tile while one exists.
    db.from("phone_calls").select("id", { count: "exact", head: true })
      .is("deleted_at", null).is("contact_id", null),
  ]);

  const campaignsOf = (name) => campaigns.filter((c) => c.owner?.trim() === name).length;
  const callsOf = (name) => (calls ?? []).filter((c) => c.rep === name);

  return (
    <>
      <div className="rise">
        <h1>Calls</h1>
        <p className="sub">Who&rsquo;s calling? Pick your name to open your call lists.</p>
      </div>

      <div className="reps big">
        {reps.map((r, i) => {
          const mine = callsOf(r.id);
          const booked = mine.filter((c) => c.outcome === "booked_meeting").length;
          return (
            <a
              key={r.id}
              href={`/calls/${encodeURIComponent(r.id)}`}
              style={{ animationDelay: `${0.04 + i * 0.03}s` }}
            >
              <span className="glyph" style={{ background: r.tint, color: r.ink }}>{r.initials}</span>
              <span className="who">
                {r.name.split(" ")[0]}<br />{r.name.split(" ").slice(1).join(" ")}
              </span>
              <span className="role">
                {num(campaignsOf(r.id))} list{campaignsOf(r.id) === 1 ? "" : "s"} ·{" "}
                {num(dialCount(mine))} call{dialCount(mine) === 1 ? "" : "s"}
                {booked ? ` · ${num(booked)} booked` : ""}
              </span>
            </a>
          );
        })}
      </div>

      {orphans ? (
        <div className="card" style={{ marginTop: 26 }}>
          <p style={{ margin: 0 }}>
            <b>{num(orphans)} call{orphans === 1 ? "" : "s"} belong{orphans === 1 ? "s" : ""} to
            nobody.</b>{" "}
            Logged before the call lists existed, so they are on the Overview&rsquo;s tile and on
            no page below it.{" "}
            <a className="drilled" href="/calls/orphans">Say who they were &rarr;</a>
          </p>
        </div>
      ) : null}
    </>
  );
}
