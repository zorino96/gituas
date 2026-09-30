"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { useT } from "@/lib/i18n/client";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom, mediaSrc } from "@/lib/cards/brand";
import { ReferencePicker } from "./color-picker";
import { GROUPS, LANG_LABEL, type SourceGroup, type SourceLang } from "@/lib/news/catalog";
import { TAXONOMY } from "@/lib/news/taxonomy";
import {
  addRssSourceAction,
  removeSourceAction,
  saveBrandKitAction,
  saveCategoriesAction,
  saveKeywordsAction,
  setKeywordFilterAction,
  toggleCatalogSourceAction,
} from "@/app/newsroom/(desk)/news/actions";

export interface NewsSettingsProps {
  workspaceId: string;
  pageName: string;
  keywords: string[];
  catalog: Array<{ id: string; name: string; group: SourceGroup; lang: SourceLang | null; description: string | null; enabled: boolean; lastError: string | null }>;
  categories: string[];
  keywordFilter: boolean;
  feeds: Array<{ id: string; name: string; url: string; lastError: string | null }>;
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: "kufi" | "sans" };
}

const PREVIEW_W = 180;

export function NewsSettings(p: NewsSettingsProps) {
  const router = useRouter();
  const t = useT();
  const tn = t.settings.news;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywords, setKeywords] = useState(p.keywords.join("، "));
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const [kit, setKit] = useState(p.kit);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [cats, setCats] = useState<string[]>(p.categories);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? t.common.error });
      if (r.ok) router.refresh();
    });

  async function pickLogo(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setMsg({ ok: false, text: tn.onlyImages });
    setMsg(null);
    setUploadingLogo(true);
    try {
      const blob = await upload(`merchant/${p.workspaceId}/logo-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setKit((k) => ({ ...k, logoPath: blob.pathname }));
      setMsg({ ok: true, text: tn.logoUploaded });
    } catch (e) {
      setMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <>
      <p className="gm-sec">{tn.keywordsSec}</p>
      <div className="gm-card gm-stack">
        <textarea className="gm-textarea" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={tn.keywordsPlaceholder} />
        <p className="gm-hint" style={{ margin: 0 }}>{tn.keywordsHint}</p>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveKeywordsAction(keywords), tn.saved)}>{tn.save}</button>
        <div className="gm-between" style={{ marginTop: 4 }}>
          <small className="gm-sub" style={{ margin: 0 }}>{tn.keywordFilterLabel}</small>
          <button
            type="button"
            role="switch"
            aria-checked={p.keywordFilter}
            aria-label={tn.keywordFilterAria}
            className="gm-knob"
            disabled={pending}
            onClick={() => run(() => setKeywordFilterAction(!p.keywordFilter), tn.changed)}
          >
            <i />
          </button>
        </div>
      </div>

      <p className="gm-sec">{tn.sourcesSec}</p>
      <div className="gm-card">
        {GROUPS.map((g) => {
          const entries = p.catalog.filter((c) => c.group === g.id);
          if (!entries.length) return null;
          return (
            <div key={g.id}>
              <p className="gm-hint" style={{ fontWeight: 700, margin: "10px 0 2px" }}>{g.label}</p>
              {entries.map((c) => (
                <div key={c.id} className="gm-target">
                  <div>
                    <p>
                      {c.name} {c.lang && <span className="gm-badge ghost">{LANG_LABEL[c.lang]}</span>}
                    </p>
                    <small>{c.lastError ? tn.sourceError(c.lastError) : c.description ?? ""}</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={c.enabled}
                    aria-label={c.name}
                    className="gm-knob"
                    disabled={pending}
                    onClick={() => run(() => toggleCatalogSourceAction(c.id, !c.enabled), tn.changed)}
                  >
                    <i />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
        {p.feeds.map((f) => (
          <div key={f.id} className="gm-target">
            <div>
              <p>{f.name}</p>
              <small className="gm-ltr" dir="ltr">{f.lastError ? `error: ${f.lastError}` : f.url}</small>
            </div>
            <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => removeSourceAction(f.id), tn.removed)}>{tn.remove}</button>
          </div>
        ))}
      </div>
      <div className="gm-card gm-stack">
        <input className="gm-input" value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder={tn.sourceName} />
        <input className="gm-input gm-ltr" dir="ltr" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://…/rss.xml" />
        <p className="gm-hint" style={{ margin: 0 }}>{tn.rssRights}</p>
        <button
          type="button"
          className="gm-btn quiet"
          disabled={pending || !feedUrl.trim() || !feedName.trim()}
          onClick={() => run(async () => {
            const r = await addRssSourceAction(feedUrl, feedName);
            if (r.ok) { setFeedUrl(""); setFeedName(""); }
            return r;
          }, tn.added)}
        >
          {tn.addRss}
        </button>
      </div>

      <p className="gm-sec">{tn.topicsSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>
          {tn.topicsHint}
        </p>
        {TAXONOMY.map((c) => {
          const whole = cats.includes(c.id);
          return (
            <div key={c.id} className="gm-stack" style={{ gap: 6 }}>
              <div className="gm-chips">
                <button
                  type="button"
                  className="gm-chip"
                  aria-pressed={whole}
                  onClick={() => setCats((x) => (whole ? x.filter((v) => v !== c.id) : [...x.filter((v) => !v.startsWith(`${c.id}/`)), c.id]))}
                >
                  {c.label}
                </button>
                {!whole &&
                  c.subs.map((s) => {
                    const code = `${c.id}/${s.id}`;
                    const on = cats.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        className="gm-chip"
                        style={{ fontSize: 12 }}
                        aria-pressed={on}
                        onClick={() => setCats((x) => (on ? x.filter((v) => v !== code) : [...x, code]))}
                      >
                        {s.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveCategoriesAction(cats), tn.saved)}>
          {tn.saveTopics}
        </button>
      </div>

      <p className="gm-sec">{tn.brandSec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-row" style={{ gap: 12, flexWrap: "wrap" }}>
          {(["primary", "accent", "text"] as const).map((key) => (
            <label key={key} className="gm-row" style={{ gap: 6 }}>
              <input type="color" value={kit[key]} onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value }))} />
              <small>{t.settings.colors[key]}</small>
            </label>
          ))}
        </div>
        <ReferencePicker
          logoSrc={mediaSrc(kit.logoPath)}
          values={kit}
          onPick={(slot, hex) => setKit((k) => ({ ...k, [slot]: hex }))}
        />
        <div className="gm-chips">
          {(["kufi", "sans"] as const).map((f) => (
            <button key={f} type="button" className="gm-chip" aria-pressed={kit.headingFont === f} onClick={() => setKit((k) => ({ ...k, headingFont: f }))}>
              {f === "kufi" ? tn.fontKufi : tn.fontSans}
            </button>
          ))}
        </div>
        <label className="gm-btn quiet small" style={{ alignSelf: "flex-start", opacity: uploadingLogo ? 0.6 : 1, pointerEvents: uploadingLogo ? "none" : "auto" }}>
          {uploadingLogo ? tn.uploading : kit.logoPath ? tn.changeLogo : tn.logo}
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
              content={{ headline: tn.cardSample, stat: null, quote: null, speaker: null, stamp: "١٠:٤٢", photoSrc: null }}
            />
          </div>
        </div>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveBrandKitAction(kit), tn.brandSaved)}>{tn.saveBrand}</button>
      </div>
      {msg && <p className={msg.ok ? "gm-ok" : "gm-err"}>{msg.text}</p>}
    </>
  );
}
