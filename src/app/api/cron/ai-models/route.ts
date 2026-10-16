import { modelFor } from "@/lib/ai/models";
import { NextResponse } from "next/server";

import { completeJson } from "@/lib/ai/provider";
import { deepseekConfigured, deepseekJson } from "@/lib/ai/deepseek";
import { kurdggConfigured, kurdggJson } from "@/lib/ai/kurdgg";
import { routerConfigured, routerJson, routerScope } from "@/lib/ai/router";

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
          model: modelFor("haiku"),
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
  // ?test=kurdgg-opus: the same, with the Opus model (to tell which of the two models is down).
  if (["kurdgg", "kurdgg-opus"].includes(new URL(req.url).searchParams.get("test") ?? "")) {
    const started = Date.now();
    if (!kurdggConfigured()) return NextResponse.json({ ok: false, error: "KURDGG_API_KEY or KURDGG_MODEL is not set" });
    try {
      const r = await kurdggJson(
        { system: 'Reply with JSON only: {"text": "<one sentence>"}', user: "بە کوردیی سۆرانی ڕستەیەکی کورت بنووسە دەربارەی کەشی هەولێر لە پاییزدا.", strength: "fast" },
        25_000,
        new URL(req.url).searchParams.get("test") === "kurdgg-opus" ? "opus" : "haiku",
      );
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
    }
  }
  // ?test=deepseek (or deepseek-pro): the same request to the DeepSeek stand-by alone, with its status when it fails.
  const standbyTest = new URL(req.url).searchParams.get("test");
  if (standbyTest === "deepseek" || standbyTest === "deepseek-pro") {
    const started = Date.now();
    if (!deepseekConfigured()) return NextResponse.json({ ok: false, error: "DEEPSEEK_API_KEY is not set (or AI_FALLBACK_ENABLED=0)" });
    try {
      const r = await deepseekJson(
        { system: 'Reply with JSON only: {"text": "<one sentence>"}', user: "Write one short sentence in Central Kurdish (Sorani, Arabic script) about autumn weather in Erbil.", strength: "fast" },
        40_000,
        standbyTest === "deepseek-pro",
      );
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, usage: r.usage, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
    }
  }
  // ?test=router: the same Sorani request to the free router alone, with its status when it fails.
  if (new URL(req.url).searchParams.get("test") === "router") {
    const started = Date.now();
    if (!routerConfigured()) return NextResponse.json({ ok: false, error: "ROUTER_BASE_URL, ROUTER_API_KEY or ROUTER_MODEL is not set (or ROUTER_ENABLED=0)", scope: routerScope() });
    try {
      const r = await routerJson(
        { system: 'Reply with JSON only: {"text": "<one sentence>"}', user: "بە کوردیی سۆرانی ڕستەیەکی کورت بنووسە دەربارەی کەشی هەولێر لە پاییزدا.", strength: "fast" },
        25_000,
      );
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, scope: routerScope(), data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, scope: routerScope(), error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
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

/**
 * A probe for Google's Gemini through the key the app already holds (GOOGLE_AI_API_KEY), to compare Sorani quality: the same
 * Bearer secret as above. GET ?models=1 lists the Gemini models the key offers; POST {model, system, user} returns the text of one
 * answer. It never returns the key, and it is not used by any feature.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!key) return NextResponse.json({ ok: false, error: "GOOGLE_AI_API_KEY is not set" });
  const body = (await req.json().catch(() => null)) as { model?: string; system?: string; user?: string; list?: boolean } | null;
  const base = "https://generativelanguage.googleapis.com/v1beta";
  if (body?.list) {
    const res = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20_000) });
    const b = (await res.json().catch(() => null)) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null;
    const names = (b?.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name?.replace(/^models\//, "")).filter((n): n is string => !!n && /gemini|gemma/i.test(n));
    return NextResponse.json({ ok: res.ok, status: res.status, models: names });
  }
  if (!body?.model || !body.user) return NextResponse.json({ ok: false, error: "model and user are needed" });
  const started = Date.now();
  try {
    const res = await fetch(`${base}/models/${encodeURIComponent(body.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(body.system ? { systemInstruction: { parts: [{ text: body.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: body.user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const b = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
    const text = (b?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    return NextResponse.json({ ok: res.ok && !!text, status: res.status, ms: Date.now() - started, text });
  } catch (e) {
    return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? e.name : "failed" });
  }
}
