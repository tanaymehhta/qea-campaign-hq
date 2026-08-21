import { db } from "../lib/db";
import { REPO } from "../lib/github";
import { ship, discard } from "../app/feedback/actions";

/**
 * The bar across the top of a preview that says what you are looking at, and
 * offers to make it real.
 *
 * This renders only inside a Vercel preview built from a feedback branch, which
 * it knows without being told: VERCEL_ENV says which kind of deployment this is
 * and VERCEL_GIT_COMMIT_REF says which branch it came from. On the live site
 * both are wrong for it and it returns nothing, so there is no way for this to
 * appear over production.
 *
 * It exists so that looking at a change and accepting it are the same visit.
 * The alternative is a link to GitHub, and the person this whole flow is for
 * does not have a GitHub account.
 */
export default async function PreviewBanner() {
  if (process.env.VERCEL_ENV !== "preview") return null;

  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  if (!branch.startsWith("feedback/")) return null;
  const id = branch.slice("feedback/".length);

  // Unauthenticated on purpose: a preview is built without the dashboard's
  // environment in some configurations, and the repo is public, so this is the
  // one call here that must not depend on a token being present.
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/pulls?head=${REPO.split("/")[0]}:${branch}&state=open`,
    { headers: { Accept: "application/vnd.github+json" }, next: { revalidate: 30 } },
  ).catch(() => null);
  const pr = res?.ok ? (await res.json())[0] : null;
  if (!pr) return null;

  const { data } = await db.from("feedback").select("body, rep").eq("id", id).single();

  return (
    <div className="pvbar">
      <div className="pvwrap">
        <span className="pvtag">Proposed change</span>
        <p className="pvsaid">
          {data?.body ? `“${data.body}”` : pr.title}
          {data?.rep ? <span className="note"> — asked for by {data.rep}</span> : null}
        </p>
        <form action={ship} className="gapform">
          <input type="hidden" name="pr" value={pr.number} />
          <input type="hidden" name="id" value={id} />
          <button className="choice pvgo" type="submit">Yes, put this live</button>
        </form>
        <form action={discard} className="gapform">
          <input type="hidden" name="id" value={id} />
          <button className="choice" type="submit">No</button>
        </form>
        <a className="note" href={pr.html_url} target="_blank" rel="noreferrer">
          what changed →
        </a>
      </div>
    </div>
  );
}
