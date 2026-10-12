// A buyer's voice note → its words, so the shop's AI (and the owner, in the inbox) can read it.
// The message is stored as "[audio] <transcript>" — the same media token WhatsApp media already use —
// before the pipeline runs; when nothing could be heard it stays "[audio]" and the owner listens.
import { db } from "@/lib/db";
import { metaMediaUrl } from "@/lib/meta-cdn";
import { WA_GRAPH } from "@/lib/whatsapp/cloud";
import { STT_MAX_BYTES, transcribe } from "@/lib/voice/stt";
import { accountFor } from "./meta-client";
import { startOfShopDay } from "./pipeline";
import { SHOP_LIMITS, type StorePlan } from "./plans";

export type VoiceSource =
  /** Instagram / Messenger: the attachment's CDN url (no token needed). */
  | { kind: "url"; url: string }
  /** WhatsApp: a media id the store's token can fetch. */
  | { kind: "wa"; mediaId: string };

export { metaMediaUrl };

async function readCapped(res: Response): Promise<Buffer | null> {
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > STT_MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length && buf.length <= STT_MAX_BYTES ? buf : null;
}

type StoreRow = { tenantId: string; fbPageId: string | null; igUserId: string | null; waPhoneNumberId: string | null };

async function download(store: StoreRow, src: VoiceSource): Promise<{ audio: Buffer; mime: string } | null> {
  if (src.kind === "url") {
    if (!metaMediaUrl(src.url)) return null;
    const res = await fetch(src.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const audio = await readCapped(res);
    return audio ? { audio, mime: (res.headers.get("content-type") ?? "audio/mp4").split(";")[0] } : null;
  }
  const acc = await accountFor(store, "WHATSAPP");
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
 * Whether a voice note is read at all. Reading costs speech-to-text credits and anyone can send a
 * voice note to a shop's page, so: only while the shop's automation is on and not paused, and only
 * up to the plan's daily number (`todayCount` already includes this note: it is stored first).
 */
export function voiceNoteAllowed(i: { automationEnabled: boolean; pausedReason: string | null; plan: string; todayCount: number }): boolean {
  if (!i.automationEnabled || i.pausedReason) return false;
  const limits = SHOP_LIMITS[i.plan as StorePlan] ?? SHOP_LIMITS.FREE;
  return i.todayCount <= limits.voiceNotesPerDay;
}

/** Download + transcription together may take this long: the buyer's reply waits for it. */
export const VOICE_NOTE_BUDGET_MS = 30_000;

function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Transcribe the voice note of a stored message and write its words into the message. Returns the
 * words, or null when the audio could not be fetched or heard, or the shop may not have it read (the
 * message then stays "[audio]"). Never throws and never takes longer than VOICE_NOTE_BUDGET_MS: a
 * failure here must not stop the shop answering.
 */
export async function transcribeVoiceNote(messageId: string, storeId: string, src: VoiceSource): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true, automationEnabled: true, pausedReason: true, plan: true },
    });
    if (!store) return null;
    const todayCount = await db.conversationMessage.count({
      where: { storeId, direction: "INBOUND", content: { startsWith: "[audio]" }, createdAt: { gte: startOfShopDay(new Date()) } },
    });
    if (!voiceNoteAllowed({ automationEnabled: store.automationEnabled, pausedReason: store.pausedReason, plan: store.plan, todayCount })) return null;
    const got = await download(store, src);
    if (!got) return null;
    const t = await transcribe(got.audio, got.mime);
    if (!t) return null;
    await db.conversationMessage.update({ where: { id: messageId }, data: { content: voiceContent(t.text) } });
    return t.text;
  };
  try {
    return await within(
      run().catch((e) => {
        console.error("[voice-note]", e instanceof Error ? e.message : "failed");
        return null;
      }),
      VOICE_NOTE_BUDGET_MS,
      null,
    );
  } catch {
    return null;
  }
}
