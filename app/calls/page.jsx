import { db, num } from "../../lib/db";
import { callRepList } from "../../lib/calls";

export const dynamic = "force-dynamic";

/**
 * Names only. Clicking a name is how you say who you are — the same
 * no-login contract as the ?rep= picker on Overview and Meetings.
 */
export default async function Calls() {
  const [{ reps, campaigns }, { data: calls }] = await Promise.all([
    callRepList(),
    db.from("phone_calls").select("rep, outcome").is("deleted_at", null),
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
                {num(mine.length)} call{mine.length === 1 ? "" : "s"}
                {booked ? ` · ${num(booked)} booked` : ""}
              </span>
            </a>
          );
        })}
      </div>
    </>
  );
}
