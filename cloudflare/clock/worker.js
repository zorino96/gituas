// Gituas clock — a Cloudflare Worker with a cron trigger ("* * * * *", free plan).
// GitHub's scheduled workflows fire hours late, so this is the reliable one-minute beat:
//   1. the app's background routes: due scheduled posts, the shop outbox, the newsroom tick
//      (each desk refreshes at its plan's speed; the autopilot runs inside the tick);
//   2. auto-videos: when the app has videos waiting and no render is running, it starts the
//      render workflow on GitHub (reel.yml) at once instead of waiting for GitHub's schedule.
// Secrets (Worker settings → Variables and Secrets): CRON_SECRET (the app's), GITHUB_TOKEN
// (fine-grained, repository zorino96/gituas, "Actions: Read and write" only).

const APP = "https://gituas.com";
const REPO = "zorino96/gituas";
const ROUTES = ["/api/cron/scheduled", "/api/cron/shop-outbox", "/api/cron/news"];

async function call(path, secret) {
  try {
    const r = await fetch(`${APP}${path}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) });
    return `${path} ${r.status}`;
  } catch (e) {
    return `${path} failed: ${e?.message ?? e}`;
  }
}

async function renderIfWaiting(env) {
  if (!env.GITHUB_TOKEN) return "reel: no GITHUB_TOKEN";
  const peek = await fetch(`${APP}/api/cron/reel-jobs?peek=1`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  const { waiting = 0 } = await peek.json().catch(() => ({}));
  if (!waiting) return "reel: nothing waiting";
  const gh = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "gituas-clock" };
  // One render at a time: a run already queued or running will take the waiting videos.
  for (const status of ["in_progress", "queued"]) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reel.yml/runs?status=${status}&per_page=1`, { headers: gh });
    const j = await r.json().catch(() => ({}));
    if ((j.total_count ?? 0) > 0) return `reel: ${waiting} waiting, a render is ${status}`;
  }
  const d = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reel.yml/dispatches`, {
    method: "POST",
    headers: { ...gh, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "master" }),
  });
  return `reel: ${waiting} waiting, render started (${d.status})`;
}

export default {
  async scheduled(_event, env, ctx) {
    if (!env.CRON_SECRET) return console.log("CRON_SECRET not set");
    ctx.waitUntil(
      (async () => {
        const results = await Promise.all([...ROUTES.map((p) => call(p, env.CRON_SECRET)), renderIfWaiting(env).catch((e) => `reel failed: ${e?.message ?? e}`)]);
        console.log(results.join(" | "));
      })(),
    );
  },
  // Opening the Worker's URL shows nothing secret: just that it is alive.
  async fetch() {
    return new Response("gituas clock: ok", { headers: { "content-type": "text/plain" } });
  },
};
