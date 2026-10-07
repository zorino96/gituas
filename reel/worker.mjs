// The render worker, run by .github/workflows/reel.yml: claims voiced videos from the app, renders
// each with Remotion, uploads it straight to Blob with the one-file token it was given (videos are
// larger than a Vercel function accepts), and reports back. Never prints a token: Actions logs are public.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { put } from "@vercel/blob/client";

const BASE = (process.env.APP_URL || "https://gituas.com").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.log("CRON_SECRET not set; nothing to do");
  process.exit(0);
}
const auth = { Authorization: `Bearer ${SECRET}` };

async function report(id, body) {
  const r = await fetch(`${BASE}/api/cron/reel-jobs/${id}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`job ${id}: reported ${body.url ? "done" : "error"} (${r.status})`);
}

const res = await fetch(`${BASE}/api/cron/reel-jobs`, { headers: auth });
if (!res.ok) {
  console.log(`queue answered ${res.status}`);
  process.exit(1);
}
const { jobs = [] } = await res.json();
console.log(`${jobs.length} video(s) to render`);
fs.mkdirSync("out", { recursive: true });

for (const job of jobs) {
  const started = Date.now();
  try {
    const propsFile = `out/${job.id}.json`;
    const outFile = `out/${job.id}.mp4`;
    fs.writeFileSync(propsFile, JSON.stringify(job.props));
    const r = spawnSync(
      "npx",
      ["remotion", "render", "src/index.ts", job.props?.style === "HIGHLIGHT" ? "Highlight" : "NewsReel", outFile, `--props=${propsFile}`, "--codec", "h264", "--crf", "22", "--log", "error"],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error(`render exited ${r.status}`);
    const blob = await put(job.pathname, fs.readFileSync(outFile), {
      access: "public",
      token: job.uploadToken,
      contentType: "video/mp4",
      multipart: true,
    });
    console.log(`job ${job.id}: rendered in ${Math.round((Date.now() - started) / 1000)} s`);
    await report(job.id, { url: blob.url });
  } catch (e) {
    console.log(`job ${job.id}: failed: ${String(e?.message ?? e).slice(0, 200)}`);
    await report(job.id, { error: String(e?.message ?? e).slice(0, 200) });
  }
}
