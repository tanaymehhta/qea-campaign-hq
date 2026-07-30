import { db, num, prettyWhen } from "../../lib/db";
import { PersonLink } from "../../components/ui";

export const dynamic = "force-dynamic";

const TAGS = ["all", "unclassified", "interested", "referral", "not_now", "not_interested", "auto_reply"];

export default async function Replies({ searchParams }) {
  const tag = searchParams?.tag ?? "all";
  const search = (searchParams?.q ?? "").replace(/[,()%]/g, "").trim();

  let q = db.from("replies")
    .select("*, campaigns(name, source)")
    .order("received_at", { ascending: false })
    .limit(300);
  if (tag !== "all") q = q.eq("sentiment", tag);
  if (search) q = q.or(`lead_name.ilike.%${search}%,lead_email.ilike.%${search}%,company.ilike.%${search}%`);
  const { data: replies } = await q;

  const { data: counts } = await db.from("replies").select("sentiment");
  const tally = {};
  for (const r of counts ?? []) tally[r.sentiment] = (tally[r.sentiment] ?? 0) + 1;
  const total = (counts ?? []).length;

  return (
    <>
      <h1>Replies</h1>
      <p className="sub">
        Every inbound across both tools, newest first. Treat the count as a floor: replies sent
        outside the original sequence, and CC&rsquo;d third-party replies, never appear in lemlist.
      </p>

      <form action="/replies" method="GET" style={{ marginBottom: 14 }}>
        {tag !== "all" ? <input type="hidden" name="tag" value={tag} /> : null}
        <input
          type="search"
          name="q"
          placeholder="Search name, email, or company…"
          defaultValue={search}
          style={{ width: 320, maxWidth: "100%" }}
        />
      </form>

      <div className="seg" style={{ marginBottom: 20 }}>
        {TAGS.map((t) => (
          <a
            key={t}
            href={`/replies?tag=${t}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={tag === t ? "on" : ""}
          >
            {t === "all" ? `All (${total})` : `${t.replace(/_/g, " ")} (${tally[t] ?? 0})`}
          </a>
        ))}
      </div>

      {!replies?.length ? <p className="empty">Nothing here.</p> : null}

      {(replies ?? []).map((r) => (
        <div className="card" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
            <div>
              <strong><PersonLink email={r.lead_email} name={r.lead_name} fallback="Unknown" /></strong>
              {r.company ? <span className="dim"> · {r.company}</span> : null}
              <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>
                {r.campaigns?.name ?? "—"} · {r.channel}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="pill">{r.sentiment.replace(/_/g, " ")}</span>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>{prettyWhen(r.received_at)}</div>
            </div>
          </div>
          {r.subject ? <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{r.subject}</div> : null}
          {/* Most lemlist replies carry a subject and a single space for a body. */}
          {r.body?.trim()
            ? <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{r.body.trim()}</div>
            : <div className="dim" style={{ fontSize: 12.5 }}>
                {r.source === "lemlist" ? "lemlist recorded the subject only" : "No message body recorded"}
              </div>}
        </div>
      ))}
    </>
  );
}
