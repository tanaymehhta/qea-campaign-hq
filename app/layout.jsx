import "./globals.css";
import { db } from "../lib/db";
import Nav from "../components/nav";
import Tween from "../components/tween";
import FeedbackBox from "../components/feedback";
import MeshFooter from "../components/mesh-footer";
import PreviewBanner from "../components/preview-banner";

export const metadata = {
  title: "QEA Campaign HQ",
  description: "Live outreach results across Instantly and lemlist.",
};

export const dynamic = "force-dynamic";

// Runs before first paint so a dark-theme visitor never sees a white flash.
const THEME_BOOT = `try{var t=localStorage.getItem("qea-hq-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {/* Nothing on the live site: it returns null unless this build is a
            Vercel preview of a feedback/* branch. */}
        <PreviewBanner />
        <div className="wrap">
          <Nav
            synced={s ? (ageMin < 1 ? "just now" : `${ageMin} min ago`) : null}
            stale={stale}
            conflicts={conflicts ?? 0}
          />
          {children}
          {/* On every page, because the moment you notice something is the
              moment you'll say it — not after navigating somewhere else. */}
          <FeedbackBox />
          <p className="foot">
            Synced from Instantly and lemlist every 30 minutes. All dates in America/New_York.
            Reply counts are a floor, not a total — replies sent outside the original sequence, and
            CC&rsquo;d third-party replies, never surface in lemlist.
          </p>
        </div>
        <MeshFooter />
        <Tween />
      </body>
    </html>
  );
}
