import { num, prettyDate, windowFrom, shift, today } from "../../../lib/db";
import { callLog, callListOwners, callOwnerOf, callRepList } from "../../../lib/calls";
import { Tile, Pill, RangePicker } from "../../../components/ui";

export const dynamic = "force-dynamic";

/**
 * The calls, as rows.
 *
 * Every other tile on the Overview opens the people behind it. "Calls logged"
 * opened `/calls`, which is the name picker — so the one number a rep adds to
 * by hand was the one number nobody could ever see the working for. Reported
 * 21 Aug 2026 as "the number says 14 and the list is 0. There is no answer to
 * that", and it was CALL_LOGS §8-A before that.
 *
 * The pile is the tile's pile by construction: same table, same `deleted_at`
 * filter, same window, and the rep scope is `callOwnerOf` — one exported
 * function, not a second copy of the rule.
 *
 * One row is one call, not one person. Ringing the same engineer on Monday and
 * Friday is two rows here and one row on their list, and both are right.
 */
export default async function CallLogPage({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);
  const rep = sp.rep ?? "all";
  const t = today();

  const [calls, { ownerOf, listOf }, { reps }] = await Promise.all([
    callLog(w.range === "all" ? {} : w),
    callListOwners(),
    callRepList(),
  ]);

  const mine = rep === "all" ? calls : calls.filter((c) => callOwnerOf(c, ownerOf) === rep);

  const reached = mine.filter((c) => c.outcome !== "not_reached").length;
  const booked = mine.filter((c) => c.outcome === "booked_meeting").length;
  const noList = mine.filter((c) => !c.contact_id).length;

  // Which list each call sits on, counted so two lists running at once can be
  // told apart at a glance — the reason this page exists in a week that went
  // from one call list to two.
  const perList = [...mine.reduce((m, c) => {
    const list = listOf.get(c.call_contacts?.call_campaign_id);
    const key = list?.display_name ?? "On no list";
    return m.set(key, (m.get(key) ?? 0) + 1);
  }, new Map())].sort((a, b) => b[1] - a[1]);

  const base = `/calls/log${rep === "all" ? "" : `?rep=${encodeURIComponent(rep)}`}`;
  const withWindow = (href) =>
    w.range === "all" ? href : `${href}${href.includes("?") ? "&" : "?"}${w.range === "day" ? `d=${w.from}` : `range=${w.range}`}`;

  return (
    <>
      <div className="rise">
        <h1>Call log</h1>
        <p className="sub">
          Every call logged {w.range === "all" ? "so far" : `in the ${w.label.toLowerCase()}`}
          {rep === "all" ? "" : `, by ${rep}`}. One row is one call — the same rows the
          Overview&rsquo;s <b>Calls logged</b> counts.
        </p>
      </div>

      <RangePicker base={base} current={w.range} day={{ current: w.range === "day" ? w.from : t, prev: shift(w.range === "day" ? w.from : t, -1), next: shift(w.range === "day" ? w.from : t, 1) }} />

      <div className="range" style={{ marginBottom: 18 }}>
        <a href={withWindow("/calls/log")}>All reps</a>
        {reps.map((r) => (
          <a key={r.id} href={withWindow(`/calls/log?rep=${encodeURIComponent(r.id)}`)}
             className={rep === r.id ? "on" : ""}>{r.name}</a>
        ))}
      </div>

      <div className="grid g3" style={{ marginBottom: 26 }}>
        <Tile label="Calls logged" value={num(mine.length)} raw={mine.length}
          tone={mine.length ? undefined : "muted"} note="one per press of Log call" />
        <Tile label="Got through" value={num(reached)} raw={reached}
          tone={reached ? undefined : "muted"}
          note="a live conversation — the other three tags, not Didn't reach them" />
        <Tile label="Meetings booked" value={num(booked)} raw={booked}
          tone={booked ? undefined : "muted"} note="calls tagged Booked a meeting" />
      </div>

      {perList.length > 1 || noList ? (
        <p className="note" style={{ marginTop: -10, marginBottom: 18 }}>
          {perList.map(([name, n]) => `${name} ${num(n)}`).join(" · ")}
        </p>
      ) : null}

      {!mine.length ? (
        <div className="card">
          <p className="empty" style={{ padding: 0 }}>
            No calls in this window. Widen it, or pick another name.
          </p>
        </div>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Date</th>
                <th style={{ textAlign: "left" }}>Who</th>
                <th style={{ textAlign: "left" }}>List</th>
                <th style={{ textAlign: "left" }}>How it went</th>
                <th style={{ textAlign: "left" }}>Note</th>
                <th style={{ textAlign: "left" }}>Rep</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((c) => {
                const ct = c.call_contacts;
                const list = listOf.get(ct?.call_campaign_id);
                const who = ct?.full_name ?? c.prospect_name ?? "—";
                const owner = callOwnerOf(c, ownerOf);
                // The person opens on the list they are on, which is the page
                // that can log the next call. Without a contact there is no
                // such page — /calls/orphans is where that gets fixed.
                const href = list && owner
                  ? `/calls/${encodeURIComponent(owner)}/${list.slug}?open=${ct.id}`
                  : c.contact_id ? null : "/calls/orphans";
                return (
                  <tr key={c.id}>
                    <td className="dim" style={{ whiteSpace: "nowrap" }}>{prettyDate(c.call_date)}</td>
                    <td className="name">
                      {href ? <a className="drilled" href={href}>{who}</a> : who}
                      {ct?.org_name || c.company
                        ? <div className="dim">{ct?.org_name ?? c.company}</div>
                        : null}
                    </td>
                    <td>
                      {list
                        ? <a className="drilled" href={`/calls/${encodeURIComponent(list.owner ?? owner ?? "")}/${list.slug}`}>{list.display_name}</a>
                        : <span className="dim">on no list</span>}
                    </td>
                    <td><Pill status={c.outcome} /></td>
                    <td>{c.note ? c.note : <span className="dim">—</span>}</td>
                    <td className="dim">{c.rep ?? <span className="dim">nobody</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {noList ? (
        <p className="note">
          {num(noList)} of these {noList === 1 ? "is" : "are"} on no list, so {noList === 1 ? "it is" : "they are"}{" "}
          counted here and on no campaign page. <a className="drilled" href="/calls/orphans">Say who they were &rarr;</a>
        </p>
      ) : null}
    </>
  );
}
