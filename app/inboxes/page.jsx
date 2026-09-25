import "./inboxes.css";
import { db, windowFrom, num } from "../../lib/db";
import { RangePicker } from "../../components/ui";
import InboxesConsole from "./console";
import {
  DOMAIN_OWNER, CAMPAIGNS, CAMPAIGNS_OF_EMAIL, CAMPAIGN_OWNER, ownerOf, HEALTH,
} from "../../lib/inboxes/assignments";

export const dynamic = "force-dynamic";

/**
 * The mailbox console.
 *
 * Every mailbox in one sortable, filterable, searchable table — the one place to
 * find the single address that is off and fix it. The interactive part is a
 * client component (`console.jsx`); this server component fetches the mailboxes,
 * joins each to its owner and campaigns from the hand-kept spreadsheet
 * (`lib/inboxes/assignments`), attaches the InboxKit health reading where there
 * is one, and hands the rows down. Warmup is on for every mailbox by standing
 * instruction from the team, so the sync's stale flag is not shown.
 */

const CAMPAIGN_ORDER = CAMPAIGNS.map((c) => c.name);

export default async function Inboxes({ searchParams }) {
  const sp = searchParams ?? {};
  const w = windowFrom(sp);

  const [{ data: accounts }, { data: daily }] = await Promise.all([
    db.from("email_accounts").select("*").eq("source", "instantly").order("domain").order("email"),
    db.from("email_account_daily").select("email, metric_date, sent")
      .gte("metric_date", w.from).lte("metric_date", w.to),
  ]);

  // Per email: total sent over the window and the days it actually sent.
  const volumeByEmail = new Map();
  for (const d of daily ?? []) {
    const email = d.email.toLowerCase();
    if (!volumeByEmail.has(email)) volumeByEmail.set(email, { total: 0, days: [] });
    const v = volumeByEmail.get(email);
    v.total += d.sent ?? 0;
    v.days.push(d.sent ?? 0);
  }
  for (const v of volumeByEmail.values()) {
    v.avg = v.days.length ? Math.round((v.total / v.days.length) * 10) / 10 : 0;
    v.max = v.days.length ? Math.max(...v.days) : 0;
    v.min = v.days.length ? Math.min(...v.days) : 0;
  }

  // The rows the console renders: mailbox joined to owner, campaigns and health.
  const rows = (accounts ?? []).map((a) => {
    const email = a.email.toLowerCase();
    const ownerName = (DOMAIN_OWNER[a.domain] ?? "—").split(",")[0].trim();
    const o = ownerOf(DOMAIN_OWNER[a.domain] ?? ownerName);
    const campaigns = (CAMPAIGNS_OF_EMAIL.get(email) ?? []).map((name) => {
      const co = ownerOf(CAMPAIGN_OWNER[name]);
      return { name, tint: co.tint, ink: co.ink };
    });
    const health = Object.prototype.hasOwnProperty.call(HEALTH, email) ? HEALTH[email] : null;
    return {
      id: a.id,
      email: a.email,
      domain: a.domain,
      owner: ownerName,
      ownerStyle: { short: o.short, initials: o.initials, tint: o.tint, ink: o.ink },
      campaigns,
      health,
      healthReal: health != null,
      dailyLimit: a.daily_limit ?? 0,
      active: a.status === "1" || a.status === "active",
    };
  });

  const domainsCount = new Set(rows.map((r) => r.domain)).size;
  const assigned = rows.filter((r) => r.campaigns.length).length;
  const known = rows.filter((r) => r.health != null);
  const avgHealth = known.length ? Math.round(known.reduce((t, r) => t + r.health, 0) / known.length) : null;

  const registeredEmails = new Set((accounts ?? []).map((a) => a.email.toLowerCase()));
  const missing = [...CAMPAIGNS_OF_EMAIL.keys()].filter((e) => !registeredEmails.has(e));

  return (
    <>
      <h1>Inboxes</h1>
      <p className="ibx-lede">
        Every mailbox in one console — sort any column, filter by rep or campaign, search any field.
        <b> {num(rows.length)} mailboxes</b> across <b>{num(domainsCount)} domains</b>, all warming.
      </p>

      <div className="ibxc-rail">
        <div className="u"><span className="v">{num(rows.length)}</span><span className="k">Mailboxes</span></div>
        <span className="sep" />
        <div className="u"><span className="v">{num(domainsCount)}</span><span className="k">Domains</span></div>
        <span className="sep" />
        <div className="u"><span className="v">{num(assigned)}</span><span className="k">On a campaign</span></div>
        <span className="sep" />
        <div className="u"><span className="v">{avgHealth == null ? "—" : `${avgHealth}%`}</span><span className="k">Avg health</span></div>
        <span className="sep" />
        <div className="u"><span className="v">{num(rows.length)}</span><span className="k">Warming</span></div>
      </div>

      <InboxesConsole rows={rows} campaignOrder={CAMPAIGN_ORDER} />

      <p className="ibx-lede" style={{ marginTop: 4, fontSize: 12.5 }}>
        Health is a mailbox&rsquo;s sender reputation from InboxKit. {num(known.length)} are synced;
        the rest show &ldquo;—&rdquo; until the full InboxKit export lands. Warmup and daily limit come from the
        Instantly sync.
      </p>

      <h2>Campaigns and the mailboxes behind them</h2>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Campaign</th>
              <th style={{ textAlign: "left" }}>Owner</th>
              <th>Domains</th>
              <th>Mailboxes</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>
            {CAMPAIGNS.map((c) => {
              const o = ownerOf(c.owner);
              const doms = new Set(c.emails.map((e) => e.split("@")[1])).size;
              const synced = c.emails.filter((e) => registeredEmails.has(e.toLowerCase())).length;
              return (
                <tr key={c.name}>
                  <td className="name" style={{ textAlign: "left" }}>
                    <span className="ibxc-cmp" style={{ background: o.tint, color: o.ink }}>{c.name}</span>
                  </td>
                  <td className="dim" style={{ textAlign: "left" }}>{c.owner}</td>
                  <td>{num(doms)}</td>
                  <td>{num(c.emails.length)}</td>
                  <td className={synced === c.emails.length ? "" : "mid"}>{num(synced)}/{num(c.emails.length)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Send volume per mailbox</h2>
      <p className="sub">Instantly only, over the chosen window.</p>
      <RangePicker base="/inboxes" current={w.range} />
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Email</th>
              <th>Total sent</th>
              <th>Avg/day</th>
              <th>Highest day</th>
              <th>Lowest day</th>
              <th>Days sent</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) => {
              const v = volumeByEmail.get(a.email.toLowerCase());
              if (!v) return (
                <tr key={a.id}>
                  <td className="name" style={{ textAlign: "left" }}>{a.email}</td>
                  <td className="zero" colSpan={5}>no sends in this window</td>
                </tr>
              );
              return (
                <tr key={a.id}>
                  <td className="name" style={{ textAlign: "left" }}>{a.email}</td>
                  <td>{num(v.total)}</td>
                  <td>{v.avg}</td>
                  <td>{num(v.max)}</td>
                  <td>{num(v.min)}</td>
                  <td className="dim">{v.days.length}</td>
                </tr>
              );
            })}
            {!accounts?.length ? <tr><td colSpan={6} className="empty">No Instantly mailboxes synced yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {missing.length ? (
        <>
          <h2>Campaign senders with no mailbox on record</h2>
          <p className="sub">
            These addresses are assigned to a campaign but never showed up in a mailbox sync — check
            they still exist in the sending tool.
          </p>
          <div className="card tw">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Email</th><th style={{ textAlign: "left" }}>Campaigns</th></tr></thead>
              <tbody>
                {missing.map((e) => (
                  <tr key={e}>
                    <td className="name" style={{ textAlign: "left" }}>{e}</td>
                    <td style={{ textAlign: "left" }}>{(CAMPAIGNS_OF_EMAIL.get(e) ?? []).join(", ")}</td>
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
