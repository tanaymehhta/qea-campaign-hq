import { db, num, prettyWhen, initials } from "../../lib/db";
import { PersonLink, Pill, Chev } from "../../components/ui";

export const dynamic = "force-dynamic";

const TAGS = ["all", "unclassified", "interested", "referral", "not_now", "not_interested", "auto_reply"];

export default async function Replies({ searchParams }) {
  const tag = searchParams?.tag ?? "all";
  const search = (searchParams?.q ?? "").replace(/[,()%]/g, "").trim();

  let q = db.from("replies")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(300);
  if (tag !== "all") q = q.eq("sentiment", tag);
  if (search) q = q.or(`lead_name.ilike.%${search}%,lead_email.ilike.%${search}%,company.ilike.%${search}%`);

  const [{ data: replies }, { data: counts }, { data: subs }] = await Promise.all([
    q,
    db.from("replies").select("sentiment"),
    db.from("v_campaign_summary").select("campaign_id, name, sub_campaign_label, group_name"),
  ]);

  const tally = {};
  for (const r of counts ?? []) tally[r.sentiment] = (tally[r.sentiment] ?? 0) + 1;
  const total = (counts ?? []).length;

  // "Campaign" means the parent group; the sub-campaign label is a detail field.
  const subById = new Map((subs ?? []).map((s) => [s.campaign_id, s]));
  const campaignOf = (id) => {
    const s = subById.get(id);
    return s ? s.group_name || s.sub_campaign_label || s.name : null;
  };

  return (
    <>
      <h1>Replies</h1>
      <p className="sub">
        Every inbound across both tools, newest first. Treat the count as a floor: replies sent
        outside the original sequence, and CC&rsquo;d third-party replies, never appear in lemlist.
        Click a row to read the message.
      </p>

      <form action="/replies" method="GET" className="searchbox" style={{ marginBottom: 14 }}>
        {tag !== "all" ? <input type="hidden" name="tag" value={tag} /> : null}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          name="q"
          placeholder="Search name, email, or company…"
          defaultValue={search}
        />
      </form>

      <div className="seg" style={{ marginBottom: 20 }}>
        {TAGS.map((t) => (
          <a
            key={t}
            href={`/replies?tag=${t}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={tag === t ? "on" : ""}
          >
            {t === "all" ? `All (${num(total)})` : `${t.replace(/_/g, " ")} (${num(tally[t] ?? 0)})`}
          </a>
        ))}
      </div>

      {!replies?.length ? <p className="empty">Nothing here.</p> : null}

      {(replies ?? []).map((r, i) => (
        <details className="mrow" key={r.id} style={{ animationDelay: `${0.03 + Math.min(i, 15) * 0.02}s` }}>
          <summary>
            <span className="idx">{i + 1}</span>
            <span className="glyph" style={{ background: "var(--tint-n)", color: "var(--ink-1)" }}>
              {initials(r.lead_name || r.lead_email)}
            </span>
            <span className="meat">
              <span className="who">
                <PersonLink email={r.lead_email} name={r.lead_name} fallback="Unknown" />
              </span>
              <span className="line">
                {[r.company, campaignOf(r.campaign_id), r.channel].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Pill status={r.sentiment} />
            <span className="when">{prettyWhen(r.received_at)}</span>
            <Chev />
          </summary>
          <div className="mbody">
            <div className="inner">
              {r.subject ? (
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{r.subject}</div>
              ) : null}
              {/* Most lemlist replies carry a subject and a single space for a body. */}
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
            </div>
          </div>
        </details>
      ))}
    </>
  );
}
