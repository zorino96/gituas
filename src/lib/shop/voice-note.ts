// A buyer's voice note → its words, so the shop's AI (and the owner, in the inbox) can read it.
// The message is stored as "[audio] <transcript>" — the same media token WhatsApp media already use —
// before the pipeline runs; when nothing could be heard it stays "[audio]" and the owner listens.
import { db } from "@/lib/db";
import { WA_GRAPH } from "@/lib/whatsapp/cloud";
import { STT_MAX_BYTES, transcribe } from "@/lib/voice/stt";
import { accountFor } from "./meta-client";

export type VoiceSource =
  /** Instagram / Messenger: the attachment's CDN url (no token needed). */
  | { kind: "url"; url: string }
  /** WhatsApp: a media id the store's token can fetch. */
  | { kind: "wa"; mediaId: string };

/** Only Meta's own CDNs are fetched: a webhook url is never followed anywhere else. */
export function metaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|facebook\.com|whatsapp\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<Buffer | null> {
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > STT_MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length && buf.length <= STT_MAX_BYTES ? buf : null;
}

async function download(storeId: string, src: VoiceSource): Promise<{ audio: Buffer; mime: string } | null> {
  if (src.kind === "url") {
    if (!metaMediaUrl(src.url)) return null;
    const res = await fetch(src.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const audio = await readCapped(res);
    return audio ? { audio, mime: (res.headers.get("content-type") ?? "audio/mp4").split(";")[0] } : null;
  }
  const store = await db.store.findUnique({ where: { id: storeId }, select: { tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true } });
  const acc = store ? await accountFor(store, "WHATSAPP") : null;
  if (!acc) return null;
  const meta = await fetch(`https://graph.facebook.com/${WA_GRAPH}/${encodeURIComponent(src.mediaId)}`, {
    headers: { Authorization: `Bearer ${acc.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.ok || !info.url || (info.file_size ?? 0) > STT_MAX_BYTES || !metaMediaUrl(info.url)) return null;
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${acc.token}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const audio = await readCapped(res);
  return audio ? { audio, mime: (info.mime_type ?? "audio/ogg").split(";")[0] } : null;
}

/** "[audio] <words>", kept short enough for the inbox and the AI. */
export function voiceContent(transcript: string): string {
  return `[audio] ${transcript.trim()}`.slice(0, 2000);
}

/**
 * Transcribe the voice note of a stored message and write its words into the message. Returns the
 * words, or null when the audio could not be fetched or heard (the message then stays "[audio]").
 * Never throws: a failure here must not stop the shop answering.
 */
export async function transcribeVoiceNote(messageId: string, storeId: string, src: VoiceSource): Promise<string | null> {
  try {
    const got = await download(storeId, src);
    if (!got) return null;
    const t = await transcribe(got.audio, got.mime);
    if (!t) return null;
    await db.conversationMessage.update({ where: { id: messageId }, data: { content: voiceContent(t.text) } });
    return t.text;
  } catch (e) {
    console.error("[voice-note]", e instanceof Error ? e.message : "failed");
    return null;
  }
}
