/**
 * What GitHub and Vercel know about a piece of feedback that was handed to
 * Claude, turned into the four things a reader actually wants to know: is it
 * waiting, is it working, can I look at it, is it live.
 *
 * None of this is stored. The branch and the run are both named after the
 * feedback id, so GitHub can always be asked, and an answer asked for is an
 * answer that cannot go stale. A copy kept here would need a webhook to
 * maintain, and a webhook that quietly stops leaves cards lying about what
 * happened -- which is worse than not showing a state at all.
 */

export const REPO = "tanaymehhta/qea-campaign-hq";
const OWNER = REPO.split("/")[0];
const WORKFLOW = "feedback-agent.yml";

function gh(path, revalidate = 10) {
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
    // Short: a run changes phase in seconds and the page polls while one is in
    // flight. Long enough that several cards on screen do not each pay for it.
    next: { revalidate },
  });
}

async function json(path, revalidate) {
  try {
    const res = await gh(path, revalidate);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Every recent run, keyed by the feedback id in its title. One call, however
 *  many cards are on screen. */
async function runsByFeedback() {
  const data = await json(`/actions/workflows/${WORKFLOW}/runs?per_page=60`);
  const out = {};
  for (const r of data?.workflow_runs ?? []) {
    // run-name puts the id here: "Feedback <uuid>".
    const id = r.display_title?.match(/[0-9a-f-]{36}/i)?.[0];
    // Newest first from the API, so the first one seen is the current attempt.
    if (id && !out[id]) out[id] = r;
  }
  return out;
}

/** The preview Vercel built for this branch. It announces the URL in a comment
 *  on the pull request, which is the only place it is written down that we can
 *  read without a second vendor's token. The link is the branch alias rather
 *  than one build, so it keeps working as Claude pushes more commits. */
async function previewUrl(number) {
  const comments = await json(`/issues/${number}/comments`);
  for (const c of comments ?? []) {
    // "vercel[bot]" from the API itself. The gh CLI prints this as plain
    // "vercel", which is what an equality check here was written against and
    // why it silently never matched.
    if (!c.user?.login?.startsWith("vercel")) continue;
    const m = c.body?.match(/\[Preview\]\((https:\/\/[^)\s]+)\)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Phases, in the order a piece of feedback moves through them:
 *
 *   queued    something else is being built; this one is next
 *   working   Claude is editing files right now
 *   building  Claude is done and Vercel is putting the preview up
 *   ready     there is a running copy of the change to look at
 *   shipped   it was merged and is on the live dashboard
 *   closed    it was turned down without going live
 *   failed    the run stopped without producing anything
 *
 * `since` is when the current phase started, so a timer can count from it.
 */
export async function runStates(rows) {
  const asked = rows.filter((f) => f.asked_at);
  if (!asked.length) return {};

  const runs = await runsByFeedback();
  const pairs = await Promise.all(
    asked.map(async (f) => [f.id, await stateFor(f, runs[f.id])]),
  );
  return Object.fromEntries(pairs);
}

async function stateFor(f, run) {
  const runUrl = run?.html_url ?? `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

  // Before the pull request exists, the run itself is the only source of truth
  // about what is happening. GitHub reports "queued" for a dispatch that is
  // waiting behind the concurrency group as well as one waiting for a machine;
  // both mean the same thing to a reader, which is "not yet".
  if (run && run.status !== "completed") {
    return {
      phase: run.status === "queued" || run.status === "waiting" ? "queued" : "working",
      since: run.run_started_at ?? run.created_at ?? f.asked_at,
      runUrl,
    };
  }

  const pulls = await json(`/pulls?head=${OWNER}:feedback/${f.id}&state=all`);
  const pr = pulls?.[0] ?? null;

  if (!pr) {
    // A finished run with nothing to show for it failed, or decided the request
    // was not a code change. Either way there is nothing to preview, and the
    // run's own page is where the reason is written.
    if (run?.status === "completed") {
      return { phase: "failed", since: run.updated_at ?? f.asked_at, runUrl };
    }
    // No run found at all: either the dispatch never landed, or it has aged out
    // of the sixty we asked for.
    return { phase: "working", since: f.asked_at, runUrl };
  }

  const base = { since: pr.updated_at ?? f.asked_at, runUrl, prUrl: pr.html_url,
                 prNumber: pr.number, prTitle: pr.title };

  if (pr.merged_at) return { ...base, phase: "shipped", since: pr.merged_at };
  if (pr.state === "closed") return { ...base, phase: "closed" };

  const preview = await previewUrl(pr.number);
  return preview
    ? { ...base, phase: "ready", preview }
    : { ...base, phase: "building" };
}

/** Phases where something is still moving, so the page should keep looking. */
export const MOVING = ["queued", "working", "building"];

/**
 * A preview link a person without a Vercel account can actually open.
 *
 * Preview deployments sit behind Vercel Authentication, which is right for a
 * dashboard full of client data but wrong for the one thing previews exist for
 * here: showing a colleague the change they asked for. Protection Bypass for
 * Automation is Vercel's answer — a secret that opens previews and nothing
 * else. Vercel hands it to the deployment as VERCEL_AUTOMATION_BYPASS_SECRET
 * once it has been generated in the project's settings.
 *
 * The cookie parameter matters as much as the secret: without it only the first
 * request is let through, so the page loads and every link on it is a login
 * wall. With it, the visitor can move around the preview normally.
 *
 * This does put the secret in the href of a page anyone can read. That is the
 * trade being made and it is worth naming: it means "anyone who can see the
 * feedback list can see previews", which is the same audience that can already
 * see the live dashboard. It does not open production, and it can be revoked in
 * one click without touching this code.
 */
export function shareable(url) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!url || !secret) return url ?? null;
  try {
    const u = new URL(url);
    u.searchParams.set("x-vercel-protection-bypass", secret);
    u.searchParams.set("x-vercel-set-bypass-cookie", "true");
    return u.toString();
  } catch {
    return url;
  }
}
