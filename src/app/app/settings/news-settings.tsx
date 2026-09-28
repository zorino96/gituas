"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom } from "@/lib/cards/brand";
import {
  addRssSourceAction,
  removeSourceAction,
  saveBrandKitAction,
  saveKeywordsAction,
  toggleCatalogSourceAction,
} from "@/app/newsroom/(desk)/news/actions";

export interface NewsSettingsProps {
  workspaceId: string;
  pageName: string;
  keywords: string[];
  catalog: Array<{ id: string; name: string; description: string; enabled: boolean; lastError: string | null }>;
  feeds: Array<{ id: string; name: string; url: string; lastError: string | null }>;
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: "kufi" | "sans" };
}

const PREVIEW_W = 180;

export function NewsSettings(p: NewsSettingsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywords, setKeywords] = useState(p.keywords.join("، "));
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const [kit, setKit] = useState(p.kit);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "هەڵە" });
      if (r.ok) router.refresh();
    });

  async function pickLogo(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setMsg({ ok: false, text: "تەنها PNG/JPG/WEBP." });
    setMsg(null);
    setUploadingLogo(true);
    try {
      const blob = await upload(`merchant/${p.workspaceId}/logo-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setKit((k) => ({ ...k, logoPath: blob.pathname }));
      setMsg({ ok: true, text: "لۆگۆ بارکرا. پاشەکەوتی براند بکە تا پاشەکەوت بێت." });
    } catch (e) {
      setMsg({ ok: false, text: `بارکردنی لۆگۆ سەرکەوتوو نەبوو: ${e instanceof Error ? e.message : "هەڵە"}` });
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <>
      <p className="gm-sec">وشە سەرەکییەکان</p>
      <div className="gm-card gm-stack">
        <textarea className="gm-textarea" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="هەولێر، Erbil، أربيل، ئابووری" />
        <p className="gm-hint" style={{ margin: 0 }}>بە کۆما جیایان بکەرەوە. بە چەند زمانێک بنووسە تا هەواڵی زیاتر بدۆزرێتەوە.</p>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveKeywordsAction(keywords), "پاشەکەوت کرا.")}>پاشەکەوت</button>
      </div>

      <p className="gm-sec">سەرچاوەکان</p>
      <div className="gm-card">
        {p.catalog.map((c) => (
          <div key={c.id} className="gm-target">
            <div>
              <p>{c.name}</p>
              <small>{c.lastError ? `هەڵە: ${c.lastError}` : c.description}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={c.enabled}
              aria-label={c.name}
              className="gm-knob"
              disabled={pending}
              onClick={() => run(() => toggleCatalogSourceAction(c.id, !c.enabled), "گۆڕدرا.")}
            >
              <i />
            </button>
          </div>
        ))}
        {p.feeds.map((f) => (
          <div key={f.id} className="gm-target">
            <div>
              <p>{f.name}</p>
              <small className="gm-ltr" dir="ltr">{f.lastError ? `error: ${f.lastError}` : f.url}</small>
            </div>
            <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => removeSourceAction(f.id), "لابرا.")}>لابردن</button>
          </div>
        ))}
      </div>
      <div className="gm-card gm-stack">
        <input className="gm-input" value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="ناوی سەرچاوە" />
        <input className="gm-input gm-ltr" dir="ltr" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://…/rss.xml" />
        <p className="gm-hint" style={{ margin: 0 }}>تەنها ئەو RSSـانە زیاد بکە کە مافی بەکارهێنانیانت هەیە. گیتواس هەرگیز دەق یان وێنەی سەرچاوەکە بڵاو ناکاتەوە.</p>
        <button
          type="button"
          className="gm-btn quiet"
          disabled={pending || !feedUrl.trim() || !feedName.trim()}
          onClick={() => run(async () => {
            const r = await addRssSourceAction(feedUrl, feedName);
            if (r.ok) { setFeedUrl(""); setFeedName(""); }
            return r;
          }, "زیاد کرا.")}
        >
          زیادکردنی RSS
        </button>
      </div>

      <p className="gm-sec">براند</p>
      <div className="gm-card gm-stack">
        <div className="gm-row" style={{ gap: 12, flexWrap: "wrap" }}>
          {(["primary", "accent", "text"] as const).map((key) => (
            <label key={key} className="gm-row" style={{ gap: 6 }}>
              <input type="color" value={kit[key]} onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value }))} />
              <small>{key === "primary" ? "ڕەنگی سەرەکی" : key === "accent" ? "ڕەنگی دووەم" : "ڕەنگی نووسین"}</small>
            </label>
          ))}
        </div>
        <div className="gm-chips">
          {(["kufi", "sans"] as const).map((f) => (
            <button key={f} type="button" className="gm-chip" aria-pressed={kit.headingFont === f} onClick={() => setKit((k) => ({ ...k, headingFont: f }))}>
              {f === "kufi" ? "کوفی" : "ئاسایی"}
            </button>
          ))}
        </div>
        <label className="gm-btn quiet small" style={{ alignSelf: "flex-start", opacity: uploadingLogo ? 0.6 : 1, pointerEvents: uploadingLogo ? "none" : "auto" }}>
          {uploadingLogo ? "بارکردن…" : kit.logoPath ? "گۆڕینی لۆگۆ" : "لۆگۆ"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={uploadingLogo}
            onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])}
          />
        </label>
        <div dir="ltr" style={{ width: PREVIEW_W, height: (CARD_H * PREVIEW_W) / CARD_W, overflow: "hidden", borderRadius: 10 }}>
          <div style={{ transform: `scale(${PREVIEW_W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
            <NewsCard
              kind="BREAKING"
              brand={brandFrom(kit, p.pageName)}
              content={{ headline: "نموونەی سەردێڕێکی هەواڵ لەسەر کارتەکەت", stat: null, quote: null, speaker: null, stamp: "١٠:٤٢", photoSrc: null }}
            />
          </div>
        </div>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveBrandKitAction(kit), "براند پاشەکەوت کرا.")}>پاشەکەوتی براند</button>
      </div>
      {msg && <p className={msg.ok ? "gm-ok" : "gm-err"}>{msg.text}</p>}
    </>
  );
}
