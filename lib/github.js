/**
 * What GitHub knows about a piece of feedback that was handed to Claude.
 *
 * Nothing about a run is stored here beyond the moment it was asked for. The
 * branch is named after the feedback id, so GitHub can always be asked "is
 * there a pull request from feedback/<id> yet?" and that single answer carries
 * the whole state: no pull request and it is still working, a pull request and
 * it is ready to look at. A copy of that in our own table would only be a
 * second version of the truth, kept up to date by a webhook we would then have
 * to keep alive.
 */

export const REPO = "tanaymehhta/qea-campaign-hq";

/** A run that has produced nothing after this long has died in a way we cannot
 *  see from the pull request list. Claude's own runs land in about two minutes;
 *  this is generous enough that a slow queue is never called a failure. */
const GIVE_UP_AFTER = 20 * 60 * 1000;

function gh(path, revalidate) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // The repo is public, so this reads fine unauthenticated -- but anonymous
      // callers get 60 requests an hour per IP, and every render of this page
      // shares one Vercel IP with every other render.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // A run takes minutes, so a few seconds of staleness costs nothing and
    // keeps a page with several open items from making a burst of calls.
    next: { revalidate: revalidate ?? 15 },
  });
}

/** The preview Vercel built for this branch. It announces the URL in a comment
 *  on the pull request, which is the only place it is written down that we can
 *  read without a second vendor's token. The link is the branch alias rather
 *  than one build, so it keeps working as Claude pushes more commits. */
async function previewUrl(number) {
  try {
    const res = await gh(`/issues/${number}/comments`);
    if (!res.ok) return null;
    const comments = await res.json();
    for (const c of comments) {
      // "vercel[bot]" from the API itself. The gh CLI prints this as plain
      // "vercel", which is what an equality check here was written against and
      // why it silently never matched.
      if (!c.user?.login?.startsWith("vercel")) continue;
      const m = c.body?.match(/\[Preview\]\((https:\/\/[^)\s]+)\)/);
      if (m) return m[1];
    }
  } catch {
    // A missing preview link is not worth failing the page over. The pull
    // request link below it still gets the reader where they are going.
  }
  return null;
}

/**
 * One of: null (never asked), "working", "ready", "stalled".
 * `ready` carries the pull request and, when Vercel has finished, the preview.
 */
export async function runState(id, askedAt) {
  if (!askedAt) return null;

  let pr = null;
  try {
    const res = await gh(`/pulls?head=${REPO.split("/")[0]}:feedback/${id}&state=all`);
    if (res.ok) pr = (await res.json())[0] ?? null;
  } catch {
    // GitHub being unreachable should read as "still working", not as a
    // failure of the thing being reported on.
  }

  if (!pr) {
    const waited = Date.now() - new Date(askedAt).getTime();
    return { state: waited > GIVE_UP_AFTER ? "stalled" : "working", askedAt };
  }

  return {
    state: "ready",
    askedAt,
    prUrl: pr.html_url,
    prNumber: pr.number,
    prTitle: pr.title,
    merged: !!pr.merged_at,
    closed: pr.state === "closed",
    preview: pr.merged_at ? null : await previewUrl(pr.number),
  };
}
