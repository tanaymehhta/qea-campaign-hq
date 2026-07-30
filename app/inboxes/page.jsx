import { db } from "../../lib/db";
import { Pill } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function Inboxes() {
  const [{ data: accounts }, { data: campaigns }, { data: members }, { data: groups }] = await Promise.all([
    db.from("email_accounts").select("*").order("domain").order("email"),
    db.from("campaigns").select("id, name, source, status, sender_emails").order("name"),
    db.from("campaign_group_members").select("group_id, campaign_id"),
    db.from("campaign_groups").select("id, display_name"),
  ]);

  const groupNameOf = new Map((groups ?? []).map((g) => [g.id, g.display_name]));
  const groupOfCampaign = new Map((members ?? []).map((m) => [m.campaign_id, groupNameOf.get(m.group_id)]));

  // Invert campaigns.sender_emails: which campaigns does each mailbox send for.
  const campaignsByEmail = new Map();
  for (const c of campaigns ?? []) {
    for (const raw of c.sender_emails ?? []) {
      const email = raw.toLowerCase();
      if (!campaignsByEmail.has(email)) campaignsByEmail.set(email, []);
      campaignsByEmail.get(email).push(c);
    }
  }

  const byDomain = new Map();
  for (const a of accounts ?? []) {
    const d = a.domain || "—";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(a);
  }
  const domains = [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const registeredEmails = new Set((accounts ?? []).map((a) => a.email.toLowerCase()));
  const unregistered = [...campaignsByEmail.keys()].filter((e) => !registeredEmails.has(e));

  return (
    <>
      <h1>Inboxes</h1>
      <p className="sub">
        Every mailbox we own, the domain it lives on, and which campaigns send from it.
      </p>

      <div className="grid g4">
        <div className="tile plus"><div className="lbl">Domains</div><div className="val">{domains.length}</div></div>
        <div className="tile plus"><div className="lbl">Mailboxes</div><div className="val">{(accounts ?? []).length}</div></div>
        <div className="tile plus"><div className="lbl">Campaigns</div><div className="val">{(campaigns ?? []).length}</div></div>
        <div className="tile plus"><div className="lbl">Idle mailboxes</div><div className="val">{(accounts ?? []).filter((a) => !campaignsByEmail.has(a.email.toLowerCase())).length}</div>
          <div className="note">not assigned to any campaign</div></div>
      </div>

      <h2>Domains</h2>
      <div className="card tw">
        <table>
          <thead><tr><th style={{ textAlign: "left" }}>Domain</th><th>Mailboxes</th><th>Warmed up</th></tr></thead>
          <tbody>
            {domains.map(([domain, emails]) => (
              <tr key={domain}>
                <td className="name" style={{ textAlign: "left" }}>{domain}</td>
                <td>{emails.length}</td>
                <td>{emails.filter((e) => e.warmup_enabled).length}/{emails.length}</td>
              </tr>
            ))}
            {!domains.length ? <tr><td colSpan={3} className="empty">No mailboxes synced yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Emails</h2>
      <div className="card tw">
        <table>
          <thead><tr><th style={{ textAlign: "left" }}>Email</th><th style={{ textAlign: "left" }}>Domain</th><th>Source</th><th style={{ textAlign: "left" }}>Campaign</th><th style={{ textAlign: "left" }}>Sub-campaign</th></tr></thead>
          <tbody>
            {(accounts ?? []).map((a) => {
              const cs = campaignsByEmail.get(a.email.toLowerCase()) ?? [];
              const groupNames = [...new Set(cs.map((c) => groupOfCampaign.get(c.id) ?? "—"))].join(", ");
              return (
                <tr key={a.id}>
                  <td className="name" style={{ textAlign: "left" }}>{a.email}</td>
                  <td className="dim" style={{ textAlign: "left" }}>{a.domain ?? "—"}</td>
                  <td className="dim">{a.source}</td>
                  <td style={{ textAlign: "left" }} className={cs.length ? "" : "zero"}>
                    {cs.length ? groupNames : "unassigned"}
                  </td>
                  <td style={{ textAlign: "left" }} className={cs.length ? "" : "zero"}>
                    {cs.length ? cs.map((c) => c.name).join(", ") : "unassigned"}
                  </td>
                </tr>
              );
            })}
            {!accounts?.length ? <tr><td colSpan={5} className="empty">No mailboxes synced yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Campaigns</h2>
      <div className="card tw">
        <table>
          <thead><tr><th style={{ textAlign: "left" }}>Campaign</th><th style={{ textAlign: "left" }}>Group</th><th>Tool</th><th>Status</th><th style={{ textAlign: "left" }}>Sender emails</th></tr></thead>
          <tbody>
            {(campaigns ?? []).map((c) => (
              <tr key={c.id}>
                <td className="name" style={{ textAlign: "left" }}><a href={`/c/${c.id}`}>{c.name}</a></td>
                <td className="dim" style={{ textAlign: "left" }}>{groupOfCampaign.get(c.id) ?? "—"}</td>
                <td className="dim">{c.source}</td>
                <td><Pill status={c.status} /></td>
                <td style={{ textAlign: "left" }} className={c.sender_emails?.length ? "" : "zero"}>
                  {c.sender_emails?.length ? c.sender_emails.join(", ") : "none"}
                </td>
              </tr>
            ))}
            {!campaigns?.length ? <tr><td colSpan={5} className="empty">No campaigns synced yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {unregistered.length ? (
        <>
          <h2>Unregistered senders</h2>
          <p className="sub">
            These addresses send for a campaign but never showed up in a mailbox sync — check they
            still exist in the sending tool.
          </p>
          <div className="card tw">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Email</th><th style={{ textAlign: "left" }}>Campaigns</th></tr></thead>
              <tbody>
                {unregistered.map((e) => (
                  <tr key={e}>
                    <td className="name" style={{ textAlign: "left" }}>{e}</td>
                    <td style={{ textAlign: "left" }}>{campaignsByEmail.get(e).map((c) => c.name).join(", ")}</td>
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
