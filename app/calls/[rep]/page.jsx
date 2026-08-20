import { db, num, prettyDate } from "../../../lib/db";
import { callRepList, contactsFor, callsFor, callStats } from "../../../lib/calls";
import { Pill, Chev } from "../../../components/ui";

export const dynamic = "force-dynamic";

/**
 * A rep's call campaigns, as cards — the /campaigns treatment. Every rep can
 * see every list, so lists owned by others follow below the rep's own.
 */
export default async function RepCalls({ params }) {
  const rep = decodeURIComponent(params.rep);
  const { campaigns } = await callRepList();

  const mine = campaigns.filter((c) => c.owner?.trim() === rep);
  const others = campaigns.filter((c) => c.owner?.trim() !== rep);
  const ordered = [...mine, ...others];

  const enriched = await Promise.all(
    ordered.map(async (c) => {
      const [contacts, calls] = await Promise.all([contactsFor(c.id), callsFor(c.id)]);
      return { ...c, contacts, stats: callStats(contacts, calls) };
    })
  );

  return (
    <>
      <div className="rise">
        <h1>{rep} — call lists</h1>
        <p className="sub">
          Every phone list, {rep}&rsquo;s first. Open one to see the campaign context, the
          numbers, and the people to dial, best call at the top.
        </p>
      </div>

      <div className="range" style={{ marginBottom: 18 }}>
        <a href="/calls">&larr; All reps</a>
      </div>

      {!enriched.length ? (
        <div className="card"><p className="empty" style={{ padding: 0 }}>No call campaigns yet — run the import script.</p></div>
      ) : null}

      {enriched.map((c, i) => {
        const s = c.stats;
        const dialable = c.contacts.filter((ct) => !ct.dnc && (ct.phone || ct.email)).length;
        const open = `/calls/${encodeURIComponent(rep)}/${c.slug}`;
        return (
          <details className="gcard" key={c.id} open={i === 0} style={{ animationDelay: `${0.08 + i * 0.05}s` }}>
            <summary>
              <div className="ghead">
                <div className="title">
                  <div className="row">
                    <a className="nm" href={open}>{c.display_name}</a>
                    <Pill status={c.status} />
                  </div>
                  <div className="byline">
                    {[c.owner, `${num(c.contacts.length)} people`, `created ${prettyDate(c.created_at?.slice(0, 10))}`]
                      .filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="gstats">
                  <div><div className="k">Dialable</div><div className="v" data-count={dialable}>{num(dialable)}</div></div>
                  <div><div className="k">Calls</div><div className={s.callsMade ? "v" : "v dim"} data-count={s.callsMade}>{num(s.callsMade)}</div></div>
                  <div><div className="k" title="A live conversation — not a voicemail or an email left instead. The Overview's People reached is a wider pile.">Spoke to</div><div className={s.peopleReached ? "v" : "v dim"}>{num(s.peopleReached)}</div></div>
                  <div><div className="k">Meetings</div><div className={s.meetingsBooked ? "v" : "v dim"}>{num(s.meetingsBooked)}</div></div>
                  <div><div className="k">Due</div><div className={s.followupsDue ? "v" : "v dim"}>{num(s.followupsDue)}</div></div>
                  <div><div className="k">Bldgs covered</div><div className={s.buildingsCovered ? "v" : "v dim"}>{num(s.buildingsCovered)}</div></div>
                </div>
              </div>
              <div className="gfoot">
                <div className="gbar">
                  <div className="note">
                    {num(c.contacts.length)} people · {num(dialable)} dialable · {num(s.neverCalled)} never called ·{" "}
                    {num(s.doNotCall)} do-not-call
                  </div>
                </div>
                <span className="ghost">Detail<Chev /></span>
                <a className="solid" href={open}>Open &rarr;</a>
              </div>
            </summary>
            <div className="gbody">
              <div className="inner">
                {c.description ? <p className="desc">{c.description}</p> : null}
                <div className="meta">
                  <div><div className="k">Objective</div><div className="v">{c.objective ?? "—"}</div></div>
                  <div><div className="k">Owner</div><div className="v">{c.owner ?? "—"}</div></div>
                  <div><div className="k">Source</div><div className="v">{c.source_file ?? "—"}</div></div>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}
