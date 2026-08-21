/**
 * The five-column board. Dumb on purpose: it takes columns that already know
 * their count, their cards and their empty sentence, and lays them out. It
 * fetches nothing, groups nothing and counts nothing — a figure computed in
 * here would be a second definition of a pile that already has one.
 *
 * The header count is the count of everyone in that column, not the number of
 * cards rendered under it. They differ (1,236 never called, ~82 of them with a
 * phone) and the line at the foot of the column says by how much. A header that
 * read the rendered array would say 82 while the tile above it says 1,236, and
 * both would be right about different things with no way to tell.
 */
import { DragCard, DropColumn } from "./board-dnd";

export function Board({ columns }) {
  return (
    <div className="board">
      {columns.map((c) => (
        <section className="col" key={c.key}>
          <div className="colhead">
            {c.label}
            <span className="n">{c.count}</span>
          </div>
          <DropColumn outcome={c.key}>
            <div className="cards">
              {c.cards.length ? c.cards : <p className="colempty">{c.empty}</p>}
            </div>
          </DropColumn>
          {c.more ? <p className="more">{c.more}</p> : null}
        </section>
      ))}
    </div>
  );
}

/**
 * One person, as a card. Every line is a column on call_contacts or the newest
 * phone_calls row — nothing here is derived beyond what the list row already
 * showed. It is a link, not a button: the drawer's state is `?open=` in the
 * URL, so a card survives a refresh, a Back, and a pasted link.
 */
export function Card({ id, from, href, name, due, age, reach, buildings, org, note, chip, won }) {
  return (
    <DragCard
      id={id}
      from={from}
      href={href}
      className={`bcard${won ? " won" : ""}${due ? " due" : ""}`}
    >
      <span className="nm">
        <b>
          {due ? <span title="follow-up due">⚑ </span> : null}
          {name}
        </b>
        <span className="age">{age}</span>
      </span>
      <span className="line">{reach}</span>
      <span className="line dim">
        {buildings}
        {org ? ` · ${org}` : ""}
      </span>
      {note ? <span className="line dim quote">{note}</span> : null}
      {chip ? <span className="chip">{chip}</span> : null}
    </DragCard>
  );
}
