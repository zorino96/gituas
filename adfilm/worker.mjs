// The AI video render worker, run by .github/workflows/reel.yml (the same workflow run that renders the
// newsroom reels): claims videos whose script and voice are ready from the app, downloads their files,
// draws each with render.py, uploads it straight to Blob with the one-file token it was given (videos are
// larger than a Vercel function accepts) and reports back. Never prints a token: Actions logs are public.
//
// The render itself runs in a child process with a scrubbed environment: no secrets, no tokens.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob/client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.APP_URL || "https://gituas.com").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.log("CRON_SECRET not set; nothing to do");
  process.exit(0);
}
const auth = { Authorization: `Bearer ${SECRET}` };
const PYTHON = process.env.PYTHON || "python3";
const MAX_FILE = 30 * 1024 * 1024;

/** Only our own Blob store and our own domain: a job's props can never point the worker anywhere else. */
function allowed(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname.endsWith(".public.blob.vercel-storage.com") || u.origin === BASE);
  } catch {
    return false;
  }
}

async function download(raw, file) {
  if (!allowed(raw)) throw new Error("file not from our storage");
  const r = await fetch(raw, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`download answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FILE) throw new Error("file too large");
  fs.writeFileSync(file, buf);
}

const extOf = (raw, fallback) => {
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(raw);
  return m ? m[1].toLowerCase() : fallback;
};

async function report(id, body) {
  const r = await fetch(`${BASE}/api/cron/ad-jobs/${id}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`ad ${id}: reported ${body.url ? "done" : "error"} (${r.status})`);
}

const res = await fetch(`${BASE}/api/cron/ad-jobs`, { headers: auth });
if (!res.ok) {
  console.log(`ad queue answered ${res.status}`);
  process.exit(1);
}
const { jobs = [] } = await res.json();
console.log(`${jobs.length} AI video(s) to render`);
fs.mkdirSync(path.join(HERE, "out"), { recursive: true });

for (const job of jobs) {
  const started = Date.now();
  try {
    const dir = path.join(HERE, "out", job.id);
    fs.mkdirSync(dir, { recursive: true });
    const props = JSON.parse(JSON.stringify(job.props ?? {}));
    if (!props || !Array.isArray(props.scenes) || !props.scenes.length) throw new Error("job has no scenes");

    for (const [i, s] of props.scenes.entries()) {
      const rel = `vo-${i}.${extOf(s.audio, "mp3")}`;
      await download(s.audio, path.join(dir, rel));
      s.audio = rel;
    }
    const photos = [];
    for (const [i, url] of (props.photos ?? []).slice(0, 6).entries()) {
      const rel = `photo-${i}.jpg`;
      try {
        await download(url, path.join(dir, rel));
        photos.push(rel);
      } catch (e) {
        console.log(`ad ${job.id}: photo ${i} skipped (${String(e?.message ?? e).slice(0, 80)})`);
        photos.push(null);
      }
    }
    props.photos = photos;
    // A photo that could not be fetched leaves its scene without one: the product scene is dropped.
    props.scenes = props.scenes.filter((s) => s.type !== "product" || (Number.isInteger(s.photo) && photos[s.photo]));
    let logo = null;
    if (props.brand?.logoUrl) {
      try {
        logo = `logo.${extOf(props.brand.logoUrl, "png")}`;
        await download(props.brand.logoUrl, path.join(dir, logo));
      } catch {
        logo = null;
      }
    }
    props.brand = { ...props.brand, logo };
    delete props.brand.logoUrl;
    fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(props));

    const outFile = path.join(dir, "ad.mp4");
    const r = spawnSync(PYTHON, ["render.py", "render", outFile], {
      cwd: HERE,
      stdio: "inherit",
      timeout: 18 * 60 * 1000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", AD_JOB: path.join(dir, "job.json") },
    });
    if (r.status !== 0) throw new Error(`render exited ${r.status}`);

    const blob = await put(job.pathname, fs.readFileSync(outFile), {
      access: "public",
      token: job.uploadToken,
      contentType: "video/mp4",
      multipart: true,
    });
    console.log(`ad ${job.id}: rendered in ${Math.round((Date.now() - started) / 1000)} s`);
    await report(job.id, { url: blob.url });
  } catch (e) {
    console.log(`ad ${job.id}: failed: ${String(e?.message ?? e).slice(0, 200)}`);
    await report(job.id, { error: String(e?.message ?? e).slice(0, 200) });
  }
}
