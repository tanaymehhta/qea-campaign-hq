import {
  db, num, pct, prettyDate, prettyWhen, listHref, pageSize,
  responseCounts, reachedCounts,
} from "../../../lib/db";
import { Pill, PeopleTable, PersonLink, ShareDonut, tally } from "../../../components/ui";

export const dynamic = "force-dynamic";

const PLACEHOLDER = /\[\s*PLACEHOLDER|\bTODO\b|\{\{\s*\}\}|\[swap for real/i;

function stripHtml(html) {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function Campaign({ params, searchParams }) {
  const sp = searchParams ?? {};
  const { data: c } = await db
    .from("v_campaign_summary").select("*").eq("campaign_id", params.id).single();
  if (!c) return <><h1>Not found</h1></>;

  const size = pageSize(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * size;
  const peopleRes = await db.from("people")
    .select("id, campaign_id, source, email, name, company, status, opened_count, clicked_count, replied_count, last_contacted_at", { count: "exact" })
    .eq("campaign_id", params.id)
    .order("last_contacted_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + size - 1);
  const people = peopleRes.data ?? [];
  const peopleCount = peopleRes.count ?? 0;
  // One column for everyone, so the ring describes the campaign rather than the
  // twenty-five rows on screen.
  const { data: statuses } = await db.from("people")
    .select("status").eq("campaign_id", params.id).limit(5000);
  const pageHref = (extra) => {
    const q = new URLSearchParams({ size: String(size), page: String(page), ...extra });
    return `/c/${params.id}?${q}#people`;
  };
  const drill = (metric) => listHref({ metric, range: "all", campaign: params.id });

  // The tile pair, from the two functions every other page now asks. This read
  // `v_campaign_summary.replied ÷ leads` — the vendor's message counter over
  // the size of the list — and the table at the foot of this page has always
  // listed the messages behind it, robots and all. Two numbers on one page,
  // one of them not what the tile was counting.
  const lifetime = { from: null, to: null, source: null, campaignIds: [params.id] };
  const [{ data: steps }, { data: stepStats }, { data: replies }, resp, reach] = await Promise.all([
    db.from("template_versions").select("*").eq("campaign_id", params.id)
      .order("step_index").order("last_seen", { ascending: false }),
    db.from("step_metrics").select("*").eq("campaign_id", params.id).order("step_index"),
    db.from("replies").select("*").eq("campaign_id", params.id).order("received_at", { ascending: false }).limit(20),
    responseCounts(lifetime),
    reachedCounts({ ...lifetime, rep: null }),
  ]);
  const respRate = pct(resp.responded, reach.people);

  // latest version per step, plus how many versions have existed
  const latest = new Map();
  const versionCount = new Map();
  for (const s of steps ?? []) {
    const k = `${s.step_index}|${s.variant}`;
    versionCount.set(k, (versionCount.get(k) ?? 0) + 1);
    if (!latest.has(k)) latest.set(k, s);
  }
  const statOf = new Map((stepStats ?? []).map((s) => [`${s.step_index}|${s.variant}`, s]));
  const ordered = [...latest.entries()].sort((a, b) => {
    const [ai, av] = a[0].split("|"), [bi, bv] = b[0].split("|");
    return Number(ai) - Number(bi) || av.localeCompare(bv);
  });

  const flagged = ordered.filter(([, s]) => PLACEHOLDER.test(`${s.subject} ${s.body}`));

  return (
    <>
      <p className="dim" style={{ fontSize: 13, marginBottom: 6 }}>
        <a href={`/campaigns/${c.group_slug}`}>&larr; {c.group_name}</a>
      </p>
      <h1>{c.sub_campaign_label || c.name}</h1>
      <p className="sub">
        <Pill status={c.status} /> &nbsp; {c.source}
        {c.daily_limit ? ` · cap ${c.daily_limit}/day` : ""}
        {c.started_on ? ` · started ${prettyDate(c.started_on)}` : ""}
        {c.open_tracking === false ? " · open tracking off" : ""}
        {c.text_only ? " · plain text (no open pixel)" : ""}
      </p>

      {flagged.length ? (
        <div className="warnbox">
          <b>Unfilled placeholder in {flagged.length === 1 ? "step" : "steps"}{" "}
          {flagged.map(([k]) => Number(k.split("|")[0]) + 1).join(", ")}.</b>{" "}
          This copy will go to prospects as written.
        </div>
      ) : null}

      <div className="grid g5">
        <a className="tile plus" href="#people"><div className="lbl">People</div>
          <div className="val">{num(peopleCount || c.leads)}</div>
          <div className="drill">see the list &darr;</div></a>
        <a className="tile plus" href={drill("sent")}><div className="lbl">Sent</div>
          <div className="val">{num(c.sent)}</div>
          <div className="note">{num(c.bounced)} bounced{c.sent ? ` · ${pct(c.bounced, c.sent)}%` : ""}</div>
          <div className="drill">see who &rarr;</div></a>
        <a className="tile plus" href={`/replies?view=responded&range=all&campaign=${params.id}`}>
          <div className="lbl">Responses</div>
          <div className={resp.responded ? "val" : "val muted"}>{num(resp.responded)}</div>
          <div className="note">
            {respRate == null ? "—" : `${respRate}% of the ${num(reach.people)} reached`}
          </div>
          <div className="drill">see who &rarr;</div></a>
        <a className="tile plus" href="/meetings" title="Meetings has one page and no campaign filter — this opens every meeting"><div className="lbl">Meetings</div>
          <div className={c.meetings ? "val" : "val muted"}>{num(c.meetings)}</div>
          <div className="drill">see who &rarr;</div></a>
        <a className="tile plus" href={drill("proposals")}><div className="lbl">Proposals sent</div>
          <div className={c.proposals ? "val" : "val muted"}>{num(c.proposals)}</div>
          <div className="drill">see who &rarr;</div></a>
      </div>

      <h2 id="people">Everyone in this sub-campaign</h2>
      <ShareDonut title="people" items={tally(statuses, "status")}
        note="By status, across everyone in the campaign — not just this page." />
      <PeopleTable rows={people} count={peopleCount} size={size} page={page} hrefFor={pageHref} />

      <h2>The sequence</h2>
      {ordered.length === 0 ? <p className="empty">No sequence copy synced for this campaign yet.</p> : null}
      {ordered.map(([k, s]) => {
        const st = statOf.get(k);
        const versions = versionCount.get(k) ?? 1;
        const bad = PLACEHOLDER.test(`${s.subject} ${s.body}`);
        return (
          <div className="step" key={k} style={bad ? { borderColor: "var(--crit)" } : undefined}>
            <div className="head">
              <div>
                <div className="n">
                  Email {s.step_index + 1}
                  {s.delay_days != null ? ` · then wait ${s.delay_days}d` : ""}
                  {versions > 1 ? ` · ${versions} versions, latest ${prettyDate(String(s.last_seen).slice(0, 10))}` : ""}
                </div>
                <div className="subj">{s.subject?.trim() || <span className="dim">(same thread, no subject)</span>}</div>
              </div>
              <div className="stats">
                {st
                  ? <>{num(st.sent)} sent · {num(st.opened)} opened ·{" "}
                      <span title="The vendor's own count, and the only reply number that exists per step — our labels are attached to a message, not to the email that provoked it. It counts anything the vendor's auto-reply filter let through, so it will not match the Responses tile above.">
                        {num(st.replied)} replied (vendor)
                      </span>
                      {st.replies_automatic ? ` · ${num(st.replies_automatic)} auto` : ""}</>
                  : <span className="dim">no step data</span>}
              </div>
            </div>
            <div className="body">
              {stripHtml(s.body).split("\n").map((line, i) => <div key={i}>{line || " "}</div>)}
            </div>
          </div>
        );
      })}

      {replies?.length ? (
        <>
          <h2>Every inbound message</h2>
          <p className="sub">
            One row per message, machines included — this is the raw inbox, not the
            Responses tile above, which counts people who wrote an answer.{" "}
            <a className="drilled" href={`/replies?view=all&range=all&campaign=${params.id}`}>
              open it by person
            </a>
          </p>
          <div className="card tw">
            <table>
              <thead><tr><th>Who</th><th>Company</th><th>Channel</th><th>Tag</th><th>When</th></tr></thead>
              <tbody>
                {replies.map((r) => (
                  <tr key={r.id}>
                    <td className="name"><PersonLink email={r.lead_email} name={r.lead_name} /></td>
                    <td className="dim" style={{ textAlign: "left" }}>{r.company ?? "—"}</td>
                    <td className="dim">{r.channel}</td>
                    <td><span className="pill">{r.sentiment.replace(/_/g, " ")}</span></td>
                    <td className="dim">{prettyWhen(r.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
