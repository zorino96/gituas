import { NextResponse } from "next/server";

import { engineReady, transcribeWith, type SttEngine } from "@/lib/voice/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The owner's voice lab (CRON_SECRET only), to compare engines with the server's own keys:
 *   {op:"stt", audio: base64, mime, engines?: SttEngine[]}  → each engine's transcript and time
 *   {op:"tts", provider: "pawan"|"kurdgg", body: {...}}     → the audio a TTS request returns (base64)
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
