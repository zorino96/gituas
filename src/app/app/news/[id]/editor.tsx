"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { ExternalLink, ImagePlus, Sparkles, Trash2 } from "lucide-react";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { renderCardJpeg } from "@/lib/cards/render";
import { mediaSrc, type Brand } from "@/lib/cards/brand";
import { checkDraft } from "@/lib/news/rules";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { attachCardAction, dismissNewsAction, draftNewsAction, saveNewsDraftAction, type DraftView } from "../actions";
import { ago } from "../../format";

const KIND_LABEL: Record<CardKind, string> = { STANDARD: "ئاسایی", BREAKING: "بەپەلە", STAT: "ژمارە", QUOTE: "وتە" };
const PREVIEW_W = 320;
const SCALE = PREVIEW_W / CARD_W;

interface Source {
  itemId: string;
  sourceName: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
}

const stampOf = (iso: string) =>
  new Intl.DateTimeFormat("ar-IQ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(iso));

const blank = (): DraftView => ({
  draftId: "",
  headline: "",
  body: "",
  category: "گشتی",
  cardKind: "STANDARD",
  stat: null,
  quote: null,
  speaker: null,
  photoPath: null,
  model: "manual",
});

export function NewsEditor({ workspaceId, source, initial, brand }: { workspaceId: string; source: Source; initial: DraftView | null; brand: Brand }) {
  const router = useRouter();
  const [d, setD] = useState<DraftView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [overflow, setOverflow] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function redraft(strength: "fast" | "strong") {
    setError(null);
    start(async () => {
      setStage(strength === "strong" ? "باشتر دەنووسرێتەوە… (تا ١٠ چرکە)" : "ئامادە دەکرێت…");
      const r = await draftNewsAction(source.itemId, strength);
      setStage(null);
      if (r.ok) setD(r.draft);
      else {
        setError(r.error);
        setD((cur) => cur ?? blank());
      }
    });
  }

  // First visit: draft straight away.
  useEffect(() => {
    if (!initial) redraft("fast");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problems = useMemo(() => (d ? checkDraft(d, source) : []), [d, source]);

  useEffect(() => {
    const t = setTimeout(() => setOverflow(!!cardRef.current?.querySelector('[data-overflow="1"]')), 60);
    return () => clearTimeout(t);
  }, [d]);

  const patch = (p: Partial<DraftView>) => setD((cur) => ({ ...(cur ?? blank()), ...p }));

  async function pickPhoto(file: File) {
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("تەنها وێنەی JPG/PNG/WEBP.");
      return;
    }
    setPhotoProgress(0);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const blob = await upload(`merchant/${workspaceId}/news-photo-${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setPhotoProgress(Math.round(percentage)),
      });
      patch({ photoPath: blob.pathname });
    } catch (e) {
      setError(`بارکردن سەرکەوتوو نەبوو: ${e instanceof Error ? e.message : "هەڵە"}`);
    } finally {
      setPhotoProgress(null);
    }
  }

  function prepare() {
    if (!d || problems.length || overflow) return;
    setError(null);
    start(async () => {
      try {
        setStage("پاشەکەوت دەکرێت…");
        const saved = await saveNewsDraftAction(source.itemId, {
          headline: d.headline,
          body: d.body,
          cardKind: d.cardKind,
          stat: d.stat,
          quote: d.quote,
          speaker: d.speaker,
          photoPath: d.photoPath,
        });
        if (!saved.ok) throw new Error(saved.error);
        await document.fonts.ready;
        if (cardRef.current?.querySelector('[data-overflow="1"]')) {
          throw new Error("دەقەکە بۆ کارتەکە درێژە. کورتی بکەرەوە.");
        }
        setStage("کارت دروست دەکرێت…");
        const jpeg = await renderCardJpeg(cardRef.current!);
        setStage("کارت بار دەکرێت…");
        const blob = await upload(`merchant/${workspaceId}/news-card-${Date.now()}.jpg`, jpeg, {
          access: "public",
          handleUploadUrl: "/api/app/upload",
          contentType: "image/jpeg",
        });
        const r = await attachCardAction(source.itemId, { url: blob.url, pathname: blob.pathname });
        if (!r.ok) throw new Error(r.error);
        router.push(`/app/publish?draft=${r.draftId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "هەڵە");
        setStage(null);
      }
    });
  }

  function dismiss() {
    start(async () => {
      await dismissNewsAction(source.itemId);
      router.push("/app/news");
    });
  }

  return (
    <div className="gm-stack">
      <p className="gm-sec">سەرچاوە</p>
      <div className="gm-card">
        <b dir="auto" style={{ display: "block", lineHeight: 1.7 }}>{source.title}</b>
        {source.snippet && <p dir="auto" className="gm-sub" style={{ margin: "6px 0 0" }}>{source.snippet}</p>}
        <small className="gm-sub">
          {source.sourceName} · {ago(source.publishedAt)} ·{" "}
          <a href={source.url} target="_blank" rel="noreferrer" className="gm-link">
            کردنەوە <ExternalLink size={12} aria-hidden="true" />
          </a>
        </small>
      </div>

      <div className="gm-between">
        <p className="gm-sec" style={{ margin: 0 }}>کورتەی کوردی</p>
        <div className="gm-row" style={{ gap: 6 }}>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => redraft("strong")}>
            <Sparkles size={14} aria-hidden="true" /> باشترکردن
          </button>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={dismiss}>
            <Trash2 size={14} aria-hidden="true" /> لابردن
          </button>
        </div>
      </div>

      {!d ? (
        <p className="gm-hint">{stage ?? "ئامادە دەکرێت…"}</p>
      ) : (
        <>
          <div className="gm-card gm-stack">
            <div className="gm-field">
              <label htmlFor="nd-head">سەردێڕ</label>
              <input id="nd-head" className="gm-input" value={d.headline} onChange={(e) => patch({ headline: e.target.value })} />
            </div>
            <div className="gm-field">
              <label htmlFor="nd-body">دەق</label>
              <textarea id="nd-body" className="gm-textarea" value={d.body} onChange={(e) => patch({ body: e.target.value })} />
            </div>
            <div className="gm-chips" role="group" aria-label="جۆری کارت">
              {CARD_KINDS.map((k) => (
                <button key={k} type="button" className="gm-chip" aria-pressed={d.cardKind === k} onClick={() => patch({ cardKind: k })}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {d.cardKind === "STAT" && (
              <div className="gm-field">
                <label htmlFor="nd-stat">ژمارە</label>
                <input id="nd-stat" className="gm-input" value={d.stat ?? ""} onChange={(e) => patch({ stat: e.target.value })} />
              </div>
            )}
            {d.cardKind === "QUOTE" && (
              <>
                <div className="gm-field">
                  <label htmlFor="nd-quote">وتە</label>
                  <textarea id="nd-quote" className="gm-textarea" value={d.quote ?? ""} onChange={(e) => patch({ quote: e.target.value })} />
                </div>
                <div className="gm-field">
                  <label htmlFor="nd-speaker">خاوەنی وتە</label>
                  <input id="nd-speaker" className="gm-input" value={d.speaker ?? ""} onChange={(e) => patch({ speaker: e.target.value })} />
                </div>
              </>
            )}
            {d.cardKind === "STANDARD" && (
              <div className="gm-row">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} />
                <button type="button" className="gm-btn quiet small" onClick={() => fileInput.current?.click()} disabled={busy || photoProgress !== null}>
                  <ImagePlus size={14} aria-hidden="true" /> {d.photoPath ? "گۆڕینی وێنە" : "وێنەی خۆت"}
                </button>
                {photoProgress !== null && <small className="gm-hint">{photoProgress}٪</small>}
                <small className="gm-hint">تەنها وێنەی خۆتان — هیچ وێنەیەک لە سەرچاوەکان وەرناگیرێت.</small>
              </div>
            )}
          </div>

          {problems.map((p) => (
            <p key={p.code} className="gm-err" role="alert" style={{ margin: 0 }}>{p.message}</p>
          ))}
          {overflow && <p className="gm-err" style={{ margin: 0 }}>دەقەکە بۆ کارتەکە درێژە. کورتی بکەرەوە.</p>}

          <p className="gm-sec">کارت</p>
          <div dir="ltr" style={{ width: PREVIEW_W, height: CARD_H * SCALE, overflow: "hidden", borderRadius: 12, margin: "0 auto" }}>
            <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
              <NewsCard
                ref={cardRef}
                kind={d.cardKind}
                brand={brand}
                content={{
                  headline: d.headline,
                  stat: d.stat,
                  quote: d.quote,
                  speaker: d.speaker,
                  sourceName: source.sourceName,
                  stamp: stampOf(source.publishedAt),
                  photoSrc: mediaSrc(d.photoPath),
                }}
              />
            </div>
          </div>

          {error && <p className="gm-err" role="alert">{error}</p>}
          <button type="button" className="gm-btn block" disabled={busy || !!problems.length || overflow || photoProgress !== null} onClick={prepare}>
            {stage ?? "ئامادەکردن بۆ بڵاوکردنەوە"}
          </button>
          <p className="gm-hint">دوای ئەمە پەڕەی بڵاوکردنەوە دەکرێتەوە: شوێنەکان هەڵدەبژێریت و پەسەندی دەکەیت. هیچ شتێک بێ کلیکی تۆ بڵاو نابێتەوە.</p>
        </>
      )}
    </div>
  );
}
