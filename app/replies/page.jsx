import {
  db, num, prettyWhen, prettyDate, initials, today, shift,
  windowFrom, repList, campaignIdsForRep, campaignIdsForGroup,
  responseCounts, responsePeople,
  logMeetingHref,
} from "../../lib/db";
import { PersonLink, Pill, Chev, Reps, RangePicker } from "../../components/ui";
import { classifyReply } from "../conflicts/actions";

export const dynamic = "force-dynamic";

// Three answers, not five. Settled 20 Aug 2026 by Tanay after reading all 135
// replies in one sitting: a reply is interest, a refusal, or a machine. The
// schema still allows `referral` and `not_now`, and nothing is lost by dropping
// the buttons — not one row in the table has ever used either (measured the
// same day). The two referrals found in the lemlist inbox, Jennifer
// Berthelot-Jelovic passing us to BranchPattern and John Forester naming Jason
// Kilgo, he filed as Interested.
//
// `unclassified` is deliberately not a button. It is the state of mail nobody
// has read yet, which is a fact about us rather than an answer from them.
const LABELS = [
  ["interested", "Interested"],
  ["not_interested", "Not interested"],
  ["auto_reply", "Automatic"],
];

// The piles, in the order the homepage reads left to right.
//
// Total responses is the parent and the next two are its only children: a
// person who answered either said yes or said no. `not_interested` therefore
// needs no flag of its own — it is `responded` minus `interested`, both on the
// tile and in the filter below, so the three counts cannot fail to add up.
//
// Every pile here is both vendors, matching the homepage since 20 Aug 2026.
const VIEWS = {
  responded:      { label: "Total responses", count: (c) => c.responded },
  interested:     { label: "Interested",      count: (c) => c.interested },
  not_interested: { label: "Not interested",  count: (c) => (c.responded == null ? null : c.responded - c.interested) },
  needs_label:    { label: "Still to read",   count: (c) => c.needs_label },
  all:            { label: "Everything",      count: (c) => c.people },
};

const BLURB = {
  responded: "Everyone who wrote back and meant it — the interested and the not interested together. This is the homepage number.",
  interested: "People with an interested message anywhere in their thread. One yes wins, even if they later said no.",
  not_interested: "People who answered and said no. They are responses — someone read the mail and replied — they are just not leads.",
  needs_label: "Nobody has read these yet, so they count in no tile. The three buttons are how they leave this list.",
  all: "Every inbound message on file, both tools, machines included. Nothing is hidden here — it is just not what a tile click opens.",
};

// A person can hold several labels across a thread; show them all rather than
// picking one, because which one "wins" differs per pile and a single pill
// would have to lie about at least one of them.
const PILL_ORDER = ["interested", "not_interested", "unclassified", "auto_reply"];

export default async function Replies({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);
  const t = today();
  const search = (sp.q ?? "").replace(/[,()%]/g, "").trim();

  // Back-compat: the homepage linked here with ?tag=unclassified before the
  // piles existed, and /conflicts still speaks in sentiments. A tag that names
  // a pile becomes that pile; anything else falls through to All inbound with
  // the label filter still applied, so an old link narrows rather than lies.
  const tag = sp.tag && sp.tag !== "all" ? sp.tag : null;
  const view =
    VIEWS[sp.view] ? sp.view
    : tag === "unclassified" ? "needs_label"
    : tag ? "all"
    : "responded";

  const { reps } = await repList();
  const rep = reps.some((r) => r.id === sp.rep) ? sp.rep : "all";

  // Three scopes can arrive at once, because the tiles that link here sit on
  // pages that already know one or two of them: a rep strip, a group row, a
  // sub-campaign page. A rep owns groups and a group owns campaigns, so they
  // nest, and the honest combination is the **intersection** — ?rep=Justin&
  // group=lber-boston means the campaigns in both. Union would widen a scope
  // the clicked tile had already narrowed, which is how a tile and its own
  // click become two numbers again.
  //
  // A scope that was asked for and could not be resolved narrows to nothing —
  // never back to everything. A broken link should show an empty pile and say
  // why; widening it to the whole company would answer a question nobody
  // asked with a number that looks like an answer to the one they did.
  const campaignAsked = (sp.campaign ?? "").trim();
  const campaign =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignAsked)
      ? campaignAsked
      : null;
  const [repScope, groupScope] = await Promise.all([
    rep === "all" ? { ids: null } : campaignIdsForRep(rep),
    sp.group ? campaignIdsForGroup(sp.group) : { group: null, ids: null },
  ]);
  const asked = [
    repScope.ids,
    sp.group ? groupScope.ids ?? [] : null,
    campaignAsked ? (campaign ? [campaign] : []) : null,
  ].filter(Boolean);
  // No scope at all is `null` — every campaign the anon key can see — and not
  // an empty array, which means the opposite and would empty the page.
  const campaignIds = asked.length ? asked.reduce((a, b) => a.filter((id) => b.includes(id))) : null;

  // The same four arguments the tile counted with. If this object and the one
  // in app/page.jsx ever stop matching, the number and the list are two piles
  // again — that is the only way this page can go wrong now.
  const scope = {
    from: w.range === "all" ? null : w.from,
    to: w.range === "all" ? null : w.to,
    campaignIds,
    source: null,
  };

  const LIMIT = 300;
  const [counts, people, { data: subs }] = await Promise.all([
    responseCounts(scope),
    responsePeople(scope, { pile: view, limit: LIMIT, tag, search }),
    db.from("v_campaign_summary").select("campaign_id, name, sub_campaign_label, group_name"),
  ]);

  const shown = VIEWS[view].count(counts);
  const emails = people.map((p) => p.lead_email);

  // The messages behind the people on this page, and only them. Bounded by the
  // page, so it cannot become the unpaged fetch this change exists to delete.
  //
  // Matched on the stored address rather than a lowercased one: PostgREST
  // cannot express `lower(col) in (...)`, and every one of the 193 rows on file
  // is already lowercase (measured 20 Aug 2026). If a mixed-case address ever
  // does arrive, its message goes missing from an expanded thread — the counts
  // above come from the RPC, which lowercases properly, so no number moves.
  const { data: msgs } = emails.length
    ? await db.from("replies").select("*").in("lead_email", emails).order("received_at", { ascending: false })
    : { data: [] };

  const thread = new Map();
  for (const m of msgs ?? []) {
    const k = (m.lead_email ?? "").toLowerCase();
    if (!thread.has(k)) thread.set(k, []);
    thread.get(k).push(m);
  }

  // "Campaign" means the parent group; the sub-campaign label is a detail field.
  const subById = new Map((subs ?? []).map((s) => [s.campaign_id, s]));
  const campaignOf = (id) => {
    const s = subById.get(id);
    return s ? s.group_name || s.sub_campaign_label || s.name : null;
  };

  const windowParams = w.range === "day" ? { d: w.from } : { range: w.range };
  const here = (params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return q.toString() ? `/replies?${q}` : "/replies";
  };
  const base = {
    view, ...windowParams, rep: rep === "all" ? "" : rep, q: search,
    // Carried on every control, so narrowing to a group and then changing the
    // window or the pile does not silently widen back to the whole company.
    group: sp.group ?? "", campaign: campaignAsked,
  };

  // What the page is scoped to, said out loud. A number that is smaller than
  // the homepage's because it is one group's is fine; a number that is smaller
  // for a reason nobody can see is the fault this page exists to end.
  const scopeName = campaignAsked
    ? subById.get(campaign)?.sub_campaign_label
      || subById.get(campaign)?.name
      || `an unknown campaign (${campaignAsked})`
    : sp.group
      ? groupScope.group?.display_name ?? `an unknown group (${sp.group})`
      : null;

  // Rebuilt from the params this page understands rather than echoed back from
  // the URL, so whatever the label action receives is something this file wrote.
  const backHere = here(base);

  return (
    <>
      <h1>Replies</h1>
      <p className="sub">
        The people behind the homepage tiles, not a separate count of them — this page and
        those numbers ask the same question of the database. One row per person; open a row
        to read the thread and change what it means.
      </p>
      {scopeName ? (
        <p className="sub" style={{ marginTop: -10 }}>
          Scoped to <b>{scopeName}</b>.{" "}
          <a className="drilled" href={here({ ...base, group: "", campaign: "" })}>everything</a>
        </p>
      ) : null}

      <Reps reps={reps} current={rep} hrefFor={(id) => here({ ...base, rep: id === "all" ? "" : id })} />

      <RangePicker
        base={here({ ...base, range: "", d: "" })}
        current={w.range}
        day={{
          current: w.range === "day" ? w.from : t,
          prev: shift(w.range === "day" ? w.from : t, -1),
          next: shift(w.range === "day" ? w.from : t, 1),
        }}
        note={w.range === "today" ? "Today so far" : `${w.label}, to ${prettyDate(t)}`}
      />

      <div className="seg" style={{ marginBottom: 14 }}>
        {Object.entries(VIEWS).map(([k, v]) => (
          <a key={k} href={here({ ...base, view: k, tag: "" })} className={view === k ? "on" : ""}>
            {v.label} ({num(v.count(counts))})
          </a>
        ))}
      </div>

      <p className="sub" style={{ marginTop: -4, marginBottom: 14 }}>
        {BLURB[view]}
        {tag && view === "all" ? ` Filtered to ${tag.replace(/_/g, " ")}.` : null}
      </p>

      <form action="/replies" method="GET" className="searchbox" style={{ marginBottom: 14 }}>
        <input type="hidden" name="view" value={view} />
        {w.range === "day" ? <input type="hidden" name="d" value={w.from} /> : <input type="hidden" name="range" value={w.range} />}
        {rep !== "all" ? <input type="hidden" name="rep" value={rep} /> : null}
        {base.group ? <input type="hidden" name="group" value={base.group} /> : null}
        {base.campaign ? <input type="hidden" name="campaign" value={base.campaign} /> : null}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input type="search" name="q" placeholder="Search name, email, or company…" defaultValue={search} />
      </form>

      {/* The tile said a number; this says whether the list under it is all of
          them. A page that quietly stops at 300 is the silent truncation this
          whole change exists to end, so it is stated rather than hidden. */}
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>
        {search
          ? `${num(people.length)} of ${num(shown)} match “${search}”`
          : people.length < shown
            ? `Showing the ${num(people.length)} most recent of ${num(shown)}`
            : `${num(people.length)} ${people.length === 1 ? "person" : "people"}`}
      </p>

      {!people.length ? <p className="empty">Nothing here.</p> : null}

      {people.map((p, i) => {
        const rows = thread.get(p.lead_email) ?? [];
        const labels = PILL_ORDER.filter((l) => (p.labels ?? []).includes(l));
        return (
          <details className="mrow" key={p.lead_email} style={{ animationDelay: `${0.03 + Math.min(i, 15) * 0.02}s` }}>
            <summary>
              <span className="idx">{i + 1}</span>
              <span className="glyph" style={{ background: "var(--tint-n)", color: "var(--ink-1)" }}>
                {initials(p.lead_name || p.lead_email)}
              </span>
              <span className="meat">
                <span className="who">
                  <PersonLink email={p.lead_email} name={p.lead_name} fallback="Unknown" />
                </span>
                <span className="line">
                  {[
                    p.company,
                    campaignOf(rows[0]?.campaign_id),
                    p.msgs > 1 ? `${p.msgs} messages` : null,
                    (p.sources ?? []).length > 1 ? "both tools" : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </span>
              {labels.map((l) => <Pill key={l} status={l} />)}
              <span className="when">{prettyWhen(p.last_at)}</span>
              <Chev />
            </summary>
            <div className="mbody">
              <div className="inner">
                {/* Every message this person sent, newest first, each with its
                    own buttons. The buttons stay per-message on purpose: a
                    thread can hold an out-of-office and a real answer, and
                    `classify_reply` labels a row. One control for a person
                    would have to pick a row to write to, silently. */}
                {rows.map((r, n) => (
                  <div
                    key={r.id}
                    style={n ? { borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 14 } : undefined}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                      {r.subject ? (
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.subject}</div>
                      ) : null}
                      <span className="dim" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                        {prettyWhen(r.received_at)}
                      </span>
                    </div>
                    {r.body?.trim() ? (
                      <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                        {r.body.trim()}
                      </div>
                    ) : (
                      <div className="dim" style={{ fontSize: 12.5 }}>
                        {r.source === "lemlist" ? "lemlist recorded the subject only" : "No message body recorded"}
                      </div>
                    )}
                    <div className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>
                      {[
                        subById.get(r.campaign_id)?.sub_campaign_label || subById.get(r.campaign_id)?.name,
                        r.lead_email,
                      ].filter(Boolean).join(" · ")}
                    </div>

                    {/* lemlist only, and it will stay that way. Its /activities
                        feed carries `messagePreview` and nothing else — usually
                        the greeting and no more — so what is above is a fragment
                        and labelling from it is guessing. The full text does
                        exist behind a second call, per contact, which is not
                        being built: lemlist is being retired.

                        Instantly needs no such warning any more. Its whole
                        message is stored now, quoted thread and all. */}
                    {r.source === "lemlist" ? (
                      <div className="dim" style={{ fontSize: 11.5, marginTop: 6, fontStyle: "italic" }}>
                        Preview only — lemlist never handed over the rest of this message.
                      </div>
                    ) : null}

                    <form action={classifyReply} className="choices">
                      <span className="choices-label">
                        {r.classified_by === "human" ? "You said" : "It is actually"}
                      </span>
                      {LABELS.map(([v, label]) => (
                        <button key={v} name="sentiment" value={v} className={r.sentiment === v ? "choice on" : "choice"}>
                          {label}
                        </button>
                      ))}
                      <input type="hidden" name="id" value={r.id} />
                      {/* Land back on the pile, window and search the click came
                          from, so a run through the homework list survives each
                          label. */}
                      <input type="hidden" name="from" value={backHere} />
                    </form>
                  </div>
                ))}

                {/* The end of a reply worth having is a meeting, and the only
                    place that gets recorded is a form on another page. Carry
                    the name, the address and the campaign into it: the audit's
                    duplicates were made by retyping them. */}
                <div className="range" style={{ marginTop: 14 }}>
                  <a
                    href={logMeetingHref({
                      name: p.lead_name,
                      email: p.lead_email,
                      company: p.company,
                      campaign: rows[0]?.campaign_id,
                    })}
                  >
                    Log a meeting with {(p.lead_name || p.lead_email || "them").split(" ")[0]} &rarr;
                  </a>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}
