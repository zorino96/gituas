import { modelFor } from "@/lib/ai/models";
import { NextResponse } from "next/server";

import { altConfigured, altJson, altModels } from "@/lib/ai/alt";
import { proofreadSorani } from "@/lib/ai/proofread";
import { completeJson, videoOrder } from "@/lib/ai/provider";
import { deepseekConfigured, deepseekJson } from "@/lib/ai/deepseek";
import { isAnthropicHost, kurdggConfigured, kurdggHeaders, kurdggJson } from "@/lib/ai/kurdgg";
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
        headers: kurdggHeaders(),
        body: JSON.stringify({
          model: modelFor("haiku"),
          // Anthropic's own endpoint refuses response_format json_object: for it both halves are the plain request.
          ...(jsonMode && !isAnthropicHost(base) ? { response_format: { type: "json_object" } } : {}),
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
  // ?test=anthropic: what the key in use says to a few plain requests (status and Anthropic's own error message, never the key).
  if (new URL(req.url).searchParams.get("test") === "anthropic") {
    const key = process.env.KURDGG_API_KEY?.trim();
    const base = (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "");
    const model = process.env.KURDGG_MODEL?.trim() || "";
    if (!key) return NextResponse.json({ ok: false, error: "no key" });
    const look = async (name: string, url: string, init: RequestInit) => {
      try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
        const raw = await res.text();
        let msg = raw.slice(0, 220);
        try {
          const j = JSON.parse(raw);
          msg = j?.error?.message ?? (Array.isArray(j?.data) ? `models: ${j.data.map((m: { id?: string }) => m.id).join(", ")}` : msg);
        } catch {}
        return { name, status: res.status, message: String(msg).slice(0, 400) };
      } catch (e) {
        return { name, status: 0, message: e instanceof Error ? e.name : "failed" };
      }
    };
    const root = base.replace(/\/v1$/, "");
    const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const wsHeader: Record<string, string> = ws ? { "anthropic-workspace-id": ws } : {};
    const msgs = [{ role: "user", content: "Say ok" }];
    const out = [
      await look("native models", `${root}/v1/models`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", ...wsHeader } }),
      await look("native messages", `${root}/v1/messages`, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 20, messages: msgs }) }),
      await look("compat plain", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 20, messages: msgs }) }),
      await look("compat + temperature", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 20, temperature: 0.3, messages: msgs }) }),
      await look("compat + stream false", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 20, stream: false, messages: msgs }) }),
      await look("compat + big max_tokens", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 3000, messages: msgs }) }),
      await look("compat + system message", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "system", content: "Reply with one JSON object only." }, ...msgs] }) }),
      await look("compat as the app sends", `${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...wsHeader }, body: JSON.stringify({ model, stream: false, temperature: 0.3, max_tokens: 3000, messages: [{ role: "system", content: "Reply with JSON only.\n\nReply with one JSON object only." }, { role: "user", content: "Say ok" }] }) }),
    ];
    return NextResponse.json({ model, base, out });
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
  // Anthropic's own listing is the native one (x-api-key + version); a gateway takes the Bearer key.
  const listHeaders: Record<string, string> = isAnthropicHost(base)
    ? { "x-api-key": key, "anthropic-version": "2023-06-01", ...(process.env.ANTHROPIC_WORKSPACE_ID?.trim() ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}) }
    : kurdggHeaders();
  const res = await fetch(`${base}/models`, { headers: listHeaders, signal: AbortSignal.timeout(15_000) });
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
  const body = (await req.json().catch(() => null)) as { model?: string; system?: string; user?: string; list?: boolean; claude?: boolean; alt?: boolean; altDebug?: boolean; video?: boolean; proofread?: boolean; maxTokens?: number; imageUrl?: string } | null;
  // {proofread: true, user}: the Sorani proofreader from this runtime (the text in "user" is corrected, or comes back as it was).
  if (body?.proofread) {
    const started = Date.now();
    const text = (body.user ?? "").slice(0, 600);
    const r = await proofreadSorani(text, { timeoutMs: 15_000 });
    return NextResponse.json({ ok: true, ms: Date.now() - started, changed: r.changed, text: r.text });
  }
  // {video: true, system, user}: the real chain for a video script (completeJson with prefer "video"), and which model answered.
  if (body?.video) {
    const started = Date.now();
    try {
      const r = await completeJson<unknown>({ system: body.system ?? "Reply with JSON only.", user: body.user ?? "Say ok", strength: "fast", thinking: false, prefer: "video", maxTokens: 1500 });
      return NextResponse.json({ ok: true, order: videoOrder(), model: r.model, ms: Date.now() - started, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, order: videoOrder(), ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "failed" });
    }
  }
  // {altDebug: true, model}: what one alternative model says to a few plain requests (status and its own error message).
  if (body?.altDebug) {
    if (!altConfigured()) return NextResponse.json({ ok: false, error: "the alternative models are not configured" });
    const model = body.model && /^[\w.:/@+-]{1,80}$/.test(body.model) ? body.model : altModels()[0];
    const base = process.env.ALT_AI_BASE_URL!.trim().replace(/\/$/, "");
    const msgs = [{ role: "user", content: "Say ok" }];
    const variants: [string, Record<string, unknown>][] = [
      ["plain", { model, messages: msgs }],
      ["max_tokens 20", { model, max_tokens: 20, messages: msgs }],
      ["max_tokens 3000", { model, max_tokens: 3000, messages: msgs }],
      ["stream false + 3000", { model, stream: false, max_tokens: 3000, messages: msgs }],
      ["as the app sends", { model, stream: false, max_tokens: 3000, messages: [{ role: "system", content: "Reply with JSON only.\n\nReply with one JSON object only." }, { role: "user", content: "Say ok" }] }],
    ];
    const out = [];
    for (const [name, payload] of variants) {
      try {
        const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.ALT_AI_API_KEY!.trim()}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000) });
        const raw = await res.text();
        let msg = raw.slice(0, 160);
        try {
          const j = JSON.parse(raw);
          msg = j?.error?.message ?? j?.error ?? (res.ok ? "ok" : msg);
        } catch {}
        out.push({ name, status: res.status, message: String(msg).slice(0, 220) });
      } catch (e) {
        out.push({ name, status: 0, message: e instanceof Error ? e.name : "failed" });
      }
    }
    return NextResponse.json({ model, out });
  }
  // {alt: true, model?, system, user}: one JSON answer from one of the alternative models alone (the first one when no model is named).
  if (body?.alt) {
    if (!altConfigured()) return NextResponse.json({ ok: false, error: "the alternative models are not configured", models: altModels() });
    const model = body.model && /^[\w.:/@+-]{1,80}$/.test(body.model) ? body.model : altModels()[0];
    const started = Date.now();
    try {
      const r = await altJson({ system: body.system ?? "Reply with JSON only.", user: body.user ?? "Say ok", strength: "fast", maxTokens: 1500 }, 60_000, model);
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, usage: r.usage, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, model, ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
    }
  }
  // {claude: true, system, user}: one JSON answer from the main provider alone (the Haiku key), with the model that answered.
  if (body?.claude) {
    if (!body.user) return NextResponse.json({ ok: false, error: "user is needed" });
    const started = Date.now();
    try {
      // imageUrl: a picture the model should look at (fetched here and sent as a data URL, like the app's own callers do).
      let images: string[] | undefined;
      if (body.imageUrl) {
        const img = await fetch(body.imageUrl, { signal: AbortSignal.timeout(15_000) });
        const type = img.headers.get("content-type")?.split(";")[0] ?? "image/png";
        if (!img.ok || !type.startsWith("image/")) return NextResponse.json({ ok: false, error: "the picture could not be fetched" });
        images = [`data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`];
      }
      const r = await kurdggJson({ system: body.system ?? "Reply with JSON only.", user: body.user, strength: "strong", maxTokens: Math.min(8000, Math.max(500, body.maxTokens ?? 6000)), ...(images ? { images } : {}) }, 85_000, "haiku");
      return NextResponse.json({ ok: true, model: r.model, ms: Date.now() - started, usage: r.usage, data: r.data });
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}` : "failed" });
    }
  }
  const key = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!key) return NextResponse.json({ ok: false, error: "GOOGLE_AI_API_KEY is not set" });
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
