import { NextResponse } from "next/server";

import { completeJson } from "@/lib/ai/provider";
import { kurdggConfigured, kurdggJson } from "@/lib/ai/kurdgg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The model ids kurd.gg offers this key, to choose KURDGG_MODEL. Ids only: the key never leaves the server. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // ?test=raw: the shape of kurd.gg's reply, with and without JSON mode (no key, no request echoed).
  if (new URL(req.url).searchParams.get("test") === "raw") {
    const key = process.env.KURDGG_API_KEY?.trim();
    const base = (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "");
    const shape = async (jsonMode: boolean) => {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.KURDGG_MODEL?.trim(),
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: 'Reply with JSON only: {"text": "<one sentence>"}' },
            { role: "user", content: "بە کوردیی سۆرانی ڕستەیەکی کورت بنووسە دەربارەی هەولێر." },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const raw = await res.text();
      let b: Record<string, unknown> | null = null;
      try {
        b = JSON.parse(raw);
      } catch {}
      const choice = (b?.choices as Record<string, unknown>[] | undefined)?.[0];
      const msg = choice?.message as Record<string, unknown> | undefined;
      return {
        status: res.status,
        topKeys: b ? Object.keys(b) : null,
        finish: choice?.finish_reason ?? null,
        messageKeys: msg ? Object.keys(msg) : null,
        contentType: Array.isArray(msg?.content) ? "array" : typeof msg?.content,
        content: typeof msg?.content === "string" ? (msg.content as string).slice(0, 300) : JSON.stringify(msg?.content ?? null).slice(0, 300),
        notJson: b ? null : raw.slice(0, 200),
      };
    };
    return NextResponse.json({ json: await shape(true).catch((e) => String(e)), plain: await shape(false).catch((e) => String(e)) });
  }
  // ?test=kurdgg: the same request to kurd.gg alone, with its error (status/code only) when it fails.
  if (new URL(req.url).searchParams.get("test") === "kurdgg") {
    const started = Date.now();
    if (!kurdggConfigured()) return NextResponse.json({ ok: false, error: "KURDGG_API_KEY or KURDGG_MODEL is not set" });
    try {
      const r = await kurdggJson(
        { system: 'Reply with JSON only: {"text": "<one sentence>"}', user: "بە کوردیی سۆرانی ڕستەیەکی کورت بنووسە دەربارەی کەشی هەولێر لە پاییزدا.", strength: "fast" },
        25_000,
      );
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
    }
  }
  // ?test=1: one short Sorani request through the whole chain, to see which model answers.
  if (new URL(req.url).searchParams.get("test") === "1") {
    const started = Date.now();
    try {
      const { data, model } = await completeJson<{ text: string }>(
        {
          system: 'Reply with JSON only: {"text": "<one sentence>"}',
          user: "بە کوردیی سۆرانی ڕستەیەکی کورت بنووسە دەربارەی کەشی هەولێر لە پاییزدا.",
          strength: "fast",
          thinking: false,
        },
        (d) => (typeof (d as { text?: unknown })?.text === "string" ? (d as { text: string }) : null),
      );
      return NextResponse.json({ ok: true, model, ms: Date.now() - started, text: data.text });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : "failed" });
    }
  }
  const key = process.env.KURDGG_API_KEY?.trim();
  if (!key) return NextResponse.json({ keySet: false, model: process.env.KURDGG_MODEL ?? null, models: [] });
  const base = (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  return NextResponse.json({
    keySet: true,
    status: res.status,
    model: process.env.KURDGG_MODEL ?? null,
    models: (body?.data ?? []).map((m) => m.id).filter(Boolean),
  });
}
