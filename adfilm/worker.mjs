// The AI video render worker, run by .github/workflows/reel.yml (the same workflow run that renders the
// newsroom reels). It runs in three separate steps so the picture and clip decoders never share a
// process or an environment with the secret:
//
//   node worker.mjs fetch    (has CRON_SECRET)  claims videos whose script and voice are ready, downloads
//                            their files, checks what they really are, writes out/manifest.json
//   node worker.mjs render   (NO secrets)       draws each video with render.py, writes a status next to it
//   node worker.mjs upload   (has CRON_SECRET)  uploads each video straight to Blob with the one-file token
//                            it was given (videos are larger than a Vercel function accepts) and reports
//
// Never prints a token: Actions logs are public.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanCredits, frameOf, settleScenes } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const MANIFEST = path.join(OUT, "manifest.json");
const BASE = (process.env.APP_URL || "https://gituas.com").replace(/\/$/, "");
const PYTHON = process.env.PYTHON || "python3";
/** How long one render may take before it is stopped (a story is longer than an ad, so it gets a little more). */
const AD_RENDER_MINUTES = 18;
const STORY_RENDER_MINUTES = 20;
const MAX_FILE = 30 * 1024 * 1024;
/** The owner's own clips (the app accepts up to 40 MB). */
const MAX_CLIP = 45 * 1024 * 1024;
const BLOB_SUFFIX = ".public.blob.vercel-storage.com";

const mode = process.argv[2];
if (!["fetch", "render", "upload"].includes(mode ?? "")) {
  console.log("usage: node worker.mjs fetch | render | upload");
  process.exit(2);
}

/** What a file really is, from its first bytes: the name and the declared type are the owner's word, not ours. */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 12 && ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(buf.toString("latin1", 4, 8))) return "mp4";
  return null;
}

const extOf = (raw, fallback) => {
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(raw);
  return m ? m[1].toLowerCase() : fallback;
};

/** Only our own Blob store (the host the app named in the job) and our own domain. */
function allowed(raw, blobHost) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.origin === BASE) return true;
    return blobHost ? u.hostname === blobHost : u.hostname.endsWith(BLOB_SUFFIX);
  } catch {
    return false;
  }
}

/** Downloads one file with a size cap counted while it streams; a redirect is followed once, only to an allowed place. */
async function download(raw, file, { blobHost, max = MAX_FILE, kinds } = {}) {
  let url = raw;
  for (let hop = 0; hop < 3; hop++) {
    if (!allowed(url, blobHost)) throw new Error("file not from our storage");
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url).toString();
      continue;
    }
    if (!r.ok || !r.body) throw new Error(`download answered ${r.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > max) throw new Error("file too large");
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    if (kinds) {
      const kind = sniff(buf);
      if (!kind || !kinds.includes(kind)) throw new Error("file is not what it says it is");
    }
    fs.writeFileSync(file, buf);
    return;
  }
  throw new Error("too many redirects");
}

const readManifest = () => {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
};

// ---- fetch -----------------------------------------------------------------------------------------

async function doFetch() {
  const SECRET = process.env.CRON_SECRET;
  if (!SECRET) {
    console.log("CRON_SECRET not set; nothing to do");
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(MANIFEST, "[]");
    return;
  }
  const auth = { Authorization: `Bearer ${SECRET}` };
  const res = await fetch(`${BASE}/api/cron/ad-jobs`, { headers: auth });
  if (!res.ok) {
    console.log(`ad queue answered ${res.status}`);
    process.exit(1);
  }
  const { jobs = [] } = await res.json();
  console.log(`${jobs.length} AI video(s) to render`);
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];

  for (const job of jobs) {
    try {
      const dir = path.join(OUT, job.id);
      fs.mkdirSync(dir, { recursive: true });
      const blobHost = typeof job.blobHost === "string" ? job.blobHost : null;
      const props = JSON.parse(JSON.stringify(job.props ?? {}));
      if (!props || !Array.isArray(props.scenes) || !props.scenes.length) throw new Error("job has no scenes");

      for (const [i, s] of props.scenes.entries()) {
        const rel = `vo-${i}.${["mp3", "wav", "m4a", "ogg"].includes(extOf(s.audio, "mp3")) ? extOf(s.audio, "mp3") : "mp3"}`;
        await download(s.audio, path.join(dir, rel), { blobHost });
        s.audio = rel;
      }
      const photos = [];
      for (const [i, url] of (props.photos ?? []).slice(0, 16).entries()) {
        const rel = `photo-${i}.jpg`;
        try {
          await download(url, path.join(dir, rel), { blobHost, kinds: ["jpeg", "png", "webp"] });
          photos.push(rel);
        } catch (e) {
          console.log(`ad ${job.id}: photo ${i} skipped (${String(e?.message ?? e).slice(0, 80)})`);
          photos.push(null);
        }
      }
      props.photos = photos;

      // The frame: only a story can be wide (16:9, 1920x1080); anything else is the vertical reel. The photo credit lines are the closing
      // scene's, a few short strings: the render step draws nothing else from the job's words.
      const frame = frameOf(props);
      props.size = frame.size;
      if (frame.wide) props.format = "wide";
      else delete props.format;
      const credits = cleanCredits(props.credits, props.kind === "story");
      if (credits.length) props.credits = credits;
      else delete props.credits;

      // The owner's own clips, for footage scenes. A clip that cannot be fetched drops the scenes that wanted it
      // (in a story they stay on the look's own background: see settleScenes).
      const clips = [];
      const clipIndex = new Map();
      for (const [i, url] of (Array.isArray(props.clips) ? props.clips : []).slice(0, 3).entries()) {
        const rel = `clip-${i}.${extOf(url, "mp4") === "mov" ? "mov" : "mp4"}`;
        try {
          await download(url, path.join(dir, rel), { blobHost, max: MAX_CLIP, kinds: ["mp4"] });
          clipIndex.set(i, clips.length);
          clips.push(rel);
        } catch (e) {
          console.log(`ad ${job.id}: clip ${i} skipped (${String(e?.message ?? e).slice(0, 80)})`);
        }
      }
      props.clips = clips;
      // A photo that could not be fetched leaves its product scene without one, which is dropped; a footage scene
      // loses its clip the same way. A story beat is never dropped for its backdrop (settleScenes).
      props.scenes = settleScenes(props.scenes, { photos, clipIndex, story: props.kind === "story" });

      let logo = null;
      if (props.brand?.logoUrl) {
        try {
          logo = `logo.${extOf(props.brand.logoUrl, "png") === "jpg" ? "jpg" : "png"}`;
          await download(props.brand.logoUrl, path.join(dir, logo), { blobHost, kinds: ["jpeg", "png", "webp"] });
        } catch {
          logo = null;
        }
      }
      props.brand = { ...props.brand, logo };
      delete props.brand.logoUrl;
      fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(props));
      manifest.push({ id: job.id, pathname: job.pathname, uploadToken: job.uploadToken });
    } catch (e) {
      const error = String(e?.message ?? e).slice(0, 200);
      console.log(`ad ${job.id}: failed: ${error}`);
      await report(auth, job.id, { error });
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest));
}

async function report(auth, id, body) {
  const r = await fetch(`${BASE}/api/cron/ad-jobs/${id}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`ad ${id}: reported ${body.url ? "done" : "error"} (${r.status})`);
}

// ---- render ----------------------------------------------------------------------------------------

function doRender() {
  // This step decodes files the shops uploaded: it must never be handed the secret.
  if (process.env.CRON_SECRET) {
    console.log("the render step must run without secrets");
    process.exit(1);
  }
  for (const job of readManifest()) {
    const dir = path.join(OUT, job.id);
    const outFile = path.join(dir, "ad.mp4");
    // A story is longer than an ad and gets a little more time. A run renders one story at a time and nothing else
    // (see src/app/api/cron/ad-jobs), so its claim, its render and its upload fit in the 25 minutes a claim lasts.
    let story = false;
    let wide = false;
    try {
      const props = JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8"));
      story = props.kind === "story";
      wide = frameOf(props).wide;
    } catch {
      /* an ad */
    }
    const started = Date.now();
    const r = spawnSync(PYTHON, ["render.py", "render", outFile, "--crf", "23"], {
      cwd: HERE,
      stdio: "inherit",
      timeout: (story ? STORY_RENDER_MINUTES : AD_RENDER_MINUTES) * 60 * 1000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", AD_JOB: path.join(dir, "job.json") },
    });
    const ok = r.status === 0 && fs.existsSync(outFile);
    const seconds = Math.round((Date.now() - started) / 1000);
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(ok ? { ok: true, seconds, kind: story ? "story" : "ad", format: wide ? "wide" : "vertical" } : { ok: false, error: `render exited ${r.status}` }));
    console.log(`ad ${job.id}: ${ok ? `drawn (${story ? "story" : "ad"}${wide ? ", wide" : ""}, ${seconds} s)` : "render failed"}`);
  }
}

// ---- upload ----------------------------------------------------------------------------------------

async function doUpload() {
  const SECRET = process.env.CRON_SECRET;
  if (!SECRET) {
    console.log("CRON_SECRET not set; nothing to do");
    return;
  }
  const { put } = await import("@vercel/blob/client");
  const auth = { Authorization: `Bearer ${SECRET}` };
  for (const job of readManifest()) {
    try {
      const dir = path.join(OUT, job.id);
      let status = { ok: false, error: "the render did not run" };
      try {
        status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
      } catch {
        /* keeps the default */
      }
      if (!status.ok) throw new Error(String(status.error ?? "render failed"));
      const file = path.join(dir, "ad.mp4");
      const blob = await put(job.pathname, fs.readFileSync(file), {
        access: "public",
        token: job.uploadToken,
        contentType: "video/mp4",
        multipart: true,
      });
      console.log(`ad ${job.id}: ${status.kind ?? "ad"} rendered in ${status.seconds ?? "?"} s`);
      await report(auth, job.id, { url: blob.url });
    } catch (e) {
      const error = String(e?.message ?? e).slice(0, 200);
      console.log(`ad ${job.id}: failed: ${error}`);
      await report(auth, job.id, { error });
    }
  }
}

if (mode === "fetch") await doFetch();
else if (mode === "render") doRender();
else await doUpload();
