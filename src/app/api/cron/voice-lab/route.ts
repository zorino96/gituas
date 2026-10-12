import { NextResponse } from "next/server";

import { kurdggConfigured, kurdggJson } from "@/lib/ai/kurdgg";
import { engineReady, transcribeWith, type SttEngine } from "@/lib/voice/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The owner's voice lab (CRON_SECRET only), to compare engines with the server's own keys:
 *   {op:"stt", audio: base64, mime, engines?: SttEngine[]}  → each engine's transcript and time
 *   {op:"tts", provider: "pawan"|"kurdgg", body: {...}}     → the audio a TTS request returns (base64)
 *   {op:"llm-json", system, user, strength?}                → one JSON completion through kurd.gg (Claude Haiku), to try prompts
 * Keys never leave the server; provider errors are reduced to a status and an error type.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const input = (await req.json().catch(() => null)) as
    | { op: "stt"; audio: string; mime: string; engines?: SttEngine[] }
    | { op: "tts"; provider: "pawan" | "kurdgg"; body: Record<string, unknown> }
    | null;
  if (!input) return NextResponse.json({ error: "bad body" }, { status: 400 });

  if (input.op === "stt") {
    const audio = Buffer.from(String(input.audio ?? ""), "base64");
    const engines = (input.engines?.length ? input.engines : (["pawan-asr", "whisper", "gemini", "gemini3"] as SttEngine[])).filter((e) => engineReady(e));
    const results = await Promise.all(
      engines.map(async (e) => {
        try {
          return await transcribeWith(e, audio, String(input.mime || "audio/ogg"));
        } catch (err) {
          return { engine: e, error: err instanceof Error ? err.message : "failed" };
        }
      }),
    );
    return NextResponse.json({ results });
  }

  if ((input as { op: string }).op === "stt-raw") {
    // One raw transcription request, to find the form a gateway accepts (model id, file type, fields).
    const r = input as unknown as { base: "kurdgg" | "pawan"; keyFrom?: "kurdgg" | "pawan"; model: string; audio: string; mime: string; filename: string; fields?: Record<string, string> };
    const kurdgg = r.base === "kurdgg";
    const key = ((r.keyFrom ?? r.base) === "kurdgg" ? process.env.KURDGG_API_KEY : process.env.PAWAN_API_KEY)?.trim();
    if (!key) return NextResponse.json({ error: "no key" }, { status: 400 });
    const base = kurdgg ? (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "") : "https://api.pawan.krd/v1";
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(Buffer.from(r.audio, "base64"))], { type: r.mime }), r.filename);
    fd.append("model", r.model);
    for (const [k, v] of Object.entries(r.fields ?? {})) fd.append(k, v);
    const t0 = Date.now();
    const res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(55_000) });
    const text = (await res.text()).replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "…").slice(0, 600);
    return NextResponse.json({ status: res.status, ms: Date.now() - t0, body: text });
  }

  if ((input as { op: string }).op === "llm-json") {
    // One JSON completion with the server's kurd.gg key (the model the desks use), e.g. an ad script for a brand.
    const r = input as unknown as { system: string; user: string; strength?: "fast" | "strong"; model?: string; images?: string[] };
    if (!kurdggConfigured()) return NextResponse.json({ error: "kurd.gg is not configured" }, { status: 400 });
    const t0 = Date.now();
    try {
      const out = await kurdggJson(
        { system: String(r.system ?? ""), user: String(r.user ?? ""), strength: r.strength === "strong" ? "strong" : "fast", model: typeof r.model === "string" ? r.model : undefined, images: Array.isArray(r.images) ? r.images.filter((x) => typeof x === "string").slice(0, 6) : undefined },
        55_000,
      );
      return NextResponse.json({ ok: true, model: out.model, ms: Date.now() - t0, data: out.data });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.replace(/[A-Za-z0-9_-]{30,}/g, "…").slice(0, 300) : "failed" });
    }
  }

  if ((input as { op: string }).op === "kurdgg-models") {
    // The model ids kurd.gg offers this key (names only), to choose the video models.
    const key = process.env.KURDGG_API_KEY?.trim();
    if (!key) return NextResponse.json({ error: "no key" }, { status: 400 });
    const base = (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
    return NextResponse.json({
      status: res.status,
      current: { fast: process.env.KURDGG_MODEL?.trim() ?? null, strong: process.env.KURDGG_MODEL_STRONG?.trim() ?? null },
      models: (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string"),
    });
  }

  if ((input as { op: string }).op === "tts-speak") {
    // The product's own speak(): which provider answered (or why none did), with the server's keys.
    const r = input as unknown as { text: string; lang: "ckb" | "ar" | "en"; voice?: string; env?: { TTS_SORANI?: string } };
    const { speak } = await import("@/lib/voice/tts");
    // The routing switch is passed in, never written into the process environment.
    const env = r.env?.TTS_SORANI !== undefined ? { ...process.env, TTS_SORANI: r.env.TTS_SORANI } : undefined;
    try {
      const t0 = Date.now();
      const s = await speak({ text: String(r.text ?? ""), lang: r.lang ?? "ckb", voice: r.voice, env });
      return NextResponse.json({ ok: true, provider: s.provider, mime: s.mime, bytes: s.audio.length, ms: Date.now() - t0, audio: s.audio.toString("base64") });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.replace(/[A-Za-z0-9_-]{30,}/g, "…").slice(0, 300) : "failed" });
    }
  }

  if (input.op === "tts") {
    const kurdgg = input.provider === "kurdgg";
    const key = (kurdgg ? process.env.KURDGG_API_KEY : process.env.PAWAN_API_KEY)?.trim();
    if (!key) return NextResponse.json({ error: "no key for provider" }, { status: 400 });
    const base = kurdgg ? (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "") : "https://api.pawan.krd/v1";
    const t0 = Date.now();
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input.body ?? {}),
      signal: AbortSignal.timeout(55_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || /json|text/i.test(type)) {
      let code = "";
      try {
        const b = JSON.parse(buf.toString("utf8"));
        code = typeof b?.error === "object" ? String(b.error.type ?? b.error.code ?? "") : "";
        if (!code && typeof b?.message === "string" && /credit|quota|discord|access|permission|model/i.test(b.message)) {
          code = b.message.replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 120);
        }
      } catch {}
      return NextResponse.json({ ok: false, status: res.status, code, ms: Date.now() - t0 });
    }
    return NextResponse.json({ ok: true, status: res.status, type, bytes: buf.length, ms: Date.now() - t0, audio: buf.toString("base64") });
  }

  return NextResponse.json({ error: "unknown op" }, { status: 400 });
}
