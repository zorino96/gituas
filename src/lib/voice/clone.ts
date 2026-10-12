// ---------------------------------------------------------------------------
//  A desk's own voice (ENTERPRISE): Pawan.Krd's private TTS (pkrd/tts-ku-private) reads the video
//  script in the voice of a short reference recording the desk uploads, with the exact words spoken
//  in it and the speaker's consent.
// ---------------------------------------------------------------------------
//
//  Stored on Vercel Blob, not in the database (no schema change): the recording and a small JSON
//  record, at a path made from an HMAC of the desk id. Desk ids appear in public card links, so a
//  path built from the id alone could be guessed; this one cannot without AUTH_SECRET.
import { createHmac } from "node:crypto";
import { del, head, put } from "@vercel/blob";

/** The value NewsSettings.videoVoice / NewsVideo.voice take for the desk's own voice. */
export { CUSTOM_VOICE } from "./voices";

export const CLONE_MIMES = ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/ogg"] as const;
export const CLONE_MAX_BYTES = 3 * 1024 * 1024;
/** Pawan's example reference is ~9 s; a few seconds is too little to copy, a minute is wasted upload. */
export const CLONE_SECONDS = { min: 4, max: 30 } as const;
export const CLONE_TEXT_MAX = 400;

export interface VoiceClone {
  refUrl: string;
  mime: string;
  seconds: number;
  /** The exact words spoken in the recording (Pawan aligns the voice with them). */
  text: string;
  consentAt: string;
  /** Who confirmed the speaker agreed (the signed-in person's email). */
  consentBy: string;
}

function key(tenantId: string, secret = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`voice-clone:${tenantId}`).digest("hex").slice(0, 24);
}

export function clonePaths(tenantId: string, secret?: string): { meta: string; ref: (ext: string) => string } {
  const k = key(tenantId, secret);
  return { meta: `merchant/${tenantId}/voice-clone/${k}.json`, ref: (ext) => `merchant/${tenantId}/voice-clone/${k}-ref.${ext}` };
}

export function cloneExt(mime: string): string | null {
  if (/wav|wave/.test(mime)) return "wav";
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/mp4|m4a/.test(mime)) return "m4a";
  if (/ogg/.test(mime)) return "ogg";
  return null;
}

/** The words of the recording, one line, or null when there are none or too many. */
export function cleanCloneText(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && [...s].length <= CLONE_TEXT_MAX ? s : null;
}

export function cleanCloneSeconds(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= CLONE_SECONDS.min && n <= CLONE_SECONDS.max ? Math.round(n * 100) / 100 : null;
}

export async function saveVoiceClone(
  tenantId: string,
  input: { audio: Buffer; mime: string; seconds: number; text: string; consentBy: string },
): Promise<VoiceClone> {
  const ext = cloneExt(input.mime);
  if (!ext) throw new Error("unsupported audio type");
  const paths = clonePaths(tenantId);
  const old = await loadVoiceClone(tenantId);
  const ref = await put(paths.ref(ext), input.audio, { access: "public", contentType: input.mime, addRandomSuffix: false, allowOverwrite: true });
  const clone: VoiceClone = { refUrl: ref.url, mime: input.mime, seconds: input.seconds, text: input.text, consentAt: new Date().toISOString(), consentBy: input.consentBy };
  await put(paths.meta, JSON.stringify(clone), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  // A new recording of another type leaves the old file behind: remove it.
  if (old && old.refUrl !== ref.url) await del(old.refUrl).catch(() => {});
  return clone;
}

export async function loadVoiceClone(tenantId: string): Promise<VoiceClone | null> {
  try {
    const meta = await head(clonePaths(tenantId).meta);
    const res = await fetch(`${meta.url}?v=${meta.uploadedAt.getTime()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const c = (await res.json()) as Partial<VoiceClone>;
    if (!c.refUrl || !c.text || !c.seconds) return null;
    return c as VoiceClone;
  } catch {
    return null;
  }
}

export async function deleteVoiceClone(tenantId: string): Promise<void> {
  const old = await loadVoiceClone(tenantId);
  const paths = clonePaths(tenantId);
  await Promise.all([del(paths.meta).catch(() => {}), old ? del(old.refUrl).catch(() => {}) : Promise.resolve()]);
}

/** The recording as the data URI Pawan's private model takes as voice_reference. */
export async function referenceDataUri(clone: VoiceClone): Promise<string> {
  const res = await fetch(clone.refUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`voice reference ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = /wav|wave/.test(clone.mime) ? "audio/wav" : clone.mime;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * What the voice-over needs to read in the desk's own voice, or null (not ENTERPRISE any more, no
 * recording, or the recording could not be read): the caller then uses a ready-made voice.
 */
export async function cloneVoiceFor(tenantId: string): Promise<{ dataUri: string; seconds: number; text: string } | null> {
  try {
    const { db } = await import("@/lib/db");
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    if (tenant?.plan !== "ENTERPRISE") return null;
    const clone = await loadVoiceClone(tenantId);
    if (!clone) return null;
    return { dataUri: await referenceDataUri(clone), seconds: clone.seconds, text: clone.text };
  } catch (e) {
    console.error("[voice-clone]", e instanceof Error ? e.message : "failed");
    return null;
  }
}
