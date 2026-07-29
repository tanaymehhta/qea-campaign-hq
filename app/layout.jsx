import "./globals.css";
import { db, prettyWhen } from "../lib/db";

export const metadata = {
  title: "QEA Campaign HQ",
  description: "Live outreach results across Instantly and lemlist.",
};

export const dynamic = "force-dynamic";

async function lastSync() {
  const { data } = await db
    .from("sync_runs")
    .select("finished_at, status, mode")
    .eq("status", "ok")
    .order("finished_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export default async function RootLayout({ children }) {
  const [s, { count: conflicts }] = await Promise.all([
    lastSync(),
    db.from("v_conflicts").select("*", { count: "exact", head: true }),
  ]);
  const ageMin = s?.finished_at
    ? Math.round((Date.now() - new Date(s.finished_at).getTime()) / 60000)
    : null;
  const stale = ageMin === null || ageMin > 75;

  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <nav className="top">
            <a className="brand" href="/">QEA Campaign HQ</a>
            <a href="/">Overview</a>
            <a href="/campaigns">Campaigns</a>
            <a href="/leads">Leads</a>
            <a href="/replies">Replies</a>
            <a href="/conflicts">
              Conflicts{conflicts ? <span className="badge">{conflicts}</span> : null}
            </a>
            <a href="/health">Health</a>
            <span className="spacer" />
            <span className="sync">
              <span className={stale ? "dot stale" : "dot"} />
              {s ? <>synced <b>{ageMin < 1 ? "just now" : `${ageMin} min ago`}</b></> : "never synced"}
            </span>
          </nav>
          {children}
          <p className="foot">
            Synced from Instantly and lemlist every 30 minutes. All dates in America/New_York.
            Reply counts are a floor, not a total — replies sent outside the original sequence, and
            CC&rsquo;d third-party replies, never surface in lemlist.
          </p>
        </div>
      </body>
    </html>
  );
}
