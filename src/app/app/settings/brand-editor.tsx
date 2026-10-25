"use client";

// The Brand tab: four steps, top to bottom. Everything saves by itself a moment after it changes (one save model, one
// status line), uploads are checked before they are kept, and the result is shown as a Facebook / Instagram post.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { upload } from "@/lib/upload-client";

import { useT } from "@/lib/i18n/client";
import { FRAME_TEXT, HEADING_FONT, LOGO_CORNERS, mediaSrc, type FrameText, type LogoCorner } from "@/lib/cards/brand";
import {
  addNewsPhotoAction,
  deleteNewsPhotoAction,
  designSectionFrameAction,
  saveBrandKitAction,
  setPhotoCardsOnlyAction,
  type LibraryPhoto,
} from "@/app/newsroom/(desk)/news/actions";

import { ReferencePicker } from "./color-picker";
import { ChannelPreview } from "./output-preview";
import { SectionFrames, type SectionFrame } from "./section-frames";

export interface BrandKitState {
  logoPath: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
  framePath: string | null;
  frameText: FrameText;
  logoCorner: LogoCorner;
}

export interface BrandEditorProps {
  workspaceId: string;
  pageName: string;
  kit: BrandKitState;
  photos: LibraryPhoto[];
  sectionFrames: SectionFrame[];
  designPrompt: string;
  aiFrames: boolean;
  photoCardsOnly: boolean;
  sourceImages: boolean;
  aiPictures: boolean;
  /** The first connected Instagram account and Page of the desk (their names appear on the sample posts). */
  accountNames: { FB: string | null; IG: string | null };
}

type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; text: string };

/** A frame PNG must be 4:5 and have a see-through photo window; read in the browser before it is uploaded. */
async function checkFrame(file: File): Promise<"ok" | "format" | "size" | "window"> {
  if (file.type !== "image/png") return "format";
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = url;
    });
    if (!img) return "format";
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 540 || Math.abs(w / h - 0.8) > 0.02) return "size";
    const canvas = document.createElement("canvas");
    canvas.width = 108;
    canvas.height = 135;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "ok";
    ctx.drawImage(img, 0, 0, 108, 135);
    const data = ctx.getImageData(0, 0, 108, 135).data;
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
    const share = clear / (108 * 135);
    return share < 0.12 || share > 0.85 ? "window" : "ok";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandEditor(p: BrandEditorProps) {
  const t = useT();
  const tn = t.settings.news;
  const [kit, setKit] = useState<BrandKitState>(p.kit);
  const [photos, setPhotos] = useState(p.photos);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [logoMsg, setLogoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [frameMsg, setFrameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<null | "logo" | "frame" | "ref" | "design">(null);
  const [designing, setDesigning] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [only, setOnly] = useState(p.photoCardsOnly);
  const [onlyMsg, setOnlyMsg] = useState<string | null>(null);

  // One save model: every change to the kit is written a moment later; the last write wins and a refused one is undone.
  const lastSaved = useRef(JSON.stringify(p.kit));
  const seq = useRef(0);
  useEffect(() => {
    const json = JSON.stringify(kit);
    if (json === lastSaved.current) return;
    setSave({ state: "saving" });
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await saveBrandKitAction(kit);
        if (mine !== seq.current) return;
        if (r.ok) {
          lastSaved.current = json;
          setSave({ state: "saved" });
        } else {
          setKit(JSON.parse(lastSaved.current) as BrandKitState);
          setSave({ state: "error", text: r.error });
        }
      } catch {
        if (mine !== seq.current) return;
        setKit(JSON.parse(lastSaved.current) as BrandKitState);
        setSave({ state: "error", text: t.common.error });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [kit, t.common.error]);

  /** The AI reads the saved brand: whatever is on the screen is written first. Returns an error text or null. */
  async function ensureSaved(): Promise<string | null> {
    if (JSON.stringify(kit) === lastSaved.current) return null;
    try {
      const r = await saveBrandKitAction(kit);
      if (!r.ok) return r.error;
      lastSaved.current = JSON.stringify(kit);
      setSave({ state: "saved" });
      return null;
    } catch {
      return t.common.error;
    }
  }

  async function pickLogo(file: File) {
    setLogoMsg(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setLogoMsg({ ok: false, text: tn.onlyImages });
    setBusy("logo");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/logo-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setKit((k) => ({ ...k, logoPath: blob.pathname }));
      setLogoMsg({ ok: true, text: tn.bdLogoSaved });
    } catch (e) {
      setLogoMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setBusy(null);
    }
  }

  async function pickFrame(file: File) {
    setFrameMsg(null);
    const verdict = await checkFrame(file);
    if (verdict === "format" || verdict === "size") return setFrameMsg({ ok: false, text: tn.frameBadSize });
    if (verdict === "window") return setFrameMsg({ ok: false, text: tn.frameNoWindow });
    setBusy("frame");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/frame-${Date.now()}.png`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: "image/png",
      });
      setKit((k) => ({ ...k, framePath: blob.pathname }));
      setFrameMsg({ ok: true, text: tn.bdFrameSaved });
    } catch (e) {
      setFrameMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setBusy(null);
    }
  }

  async function pickReference(file: File) {
    setFrameMsg(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setFrameMsg({ ok: false, text: tn.onlyImages });
    setBusy("ref");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/frameref-main-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setReference(blob.pathname);
    } catch (e) {
      setFrameMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setBusy(null);
    }
  }

  async function designMain() {
    setFrameMsg(null);
    setBusy("design");
    try {
      const early = await ensureSaved();
      if (early) return setFrameMsg({ ok: false, text: early });
      const r = await designSectionFrameAction({ section: "main", referencePath: reference, note, frameText: kit.frameText });
      if (!r.ok) return setFrameMsg({ ok: false, text: r.error });
      // The server has already written the new frame; the screen only has to show it.
      const next = { ...kit, framePath: r.framePath };
      lastSaved.current = JSON.stringify(next);
      setKit(next);
      setDesigning(false);
      setFrameMsg({ ok: true, text: tn.bdFrameDesignDone });
    } catch (e) {
      setFrameMsg({ ok: false, text: e instanceof Error ? e.message : t.common.error });
    } finally {
      setBusy(null);
    }
  }

  function removeFrame() {
    if (!window.confirm(tn.bdFrameRemoveConfirm)) return;
    setKit((k) => ({ ...k, framePath: null }));
  }

  async function togglePhotoOnly() {
    const next = !only;
    setOnly(next);
    setOnlyMsg(null);
    try {
      const r = await setPhotoCardsOnlyAction(next);
      if (!r.ok) {
        setOnly(!next);
        setOnlyMsg(r.error);
      }
    } catch {
      setOnly(!next);
      setOnlyMsg(t.common.error);
    }
  }

  const framed = !!kit.framePath;
  const needsPhotos = framed && photos.length === 0 && !p.sourceImages && !p.aiPictures;
  const status =
    save.state === "saving" ? tn.bdSaving : save.state === "saved" ? tn.bdSaved : save.state === "error" ? tn.bdSaveFailed(save.text) : null;

  return (
    <>
      <p className="gm-sec">{tn.brandSec}</p>
      <p className="gm-hint" style={{ margin: 0 }}>{tn.bdIntro}</p>
      {status && (
        <p
          role="status"
          className={save.state === "error" ? "gm-err" : save.state === "saved" ? "gm-ok" : "gm-hint"}
          style={{ margin: 0, position: "sticky", top: 8, zIndex: 5 }}
        >
          {status}
        </p>
      )}

      {/* ── Step 1: logo and colours ─────────────────────────────────────────────── */}
      <div className="gm-card gm-stack">
        <p className="gm-sec" style={{ margin: 0 }}>{tn.bdStep1}</p>
        <p className="gm-hint" style={{ margin: 0 }}>{tn.bdStep1Help}</p>
        <div className="gm-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span
            style={{ width: 96, height: 96, borderRadius: 18, background: "#fff", display: "grid", placeItems: "center", overflow: "hidden", border: kit.logoPath ? "none" : "2px dashed var(--line, #888)", flex: "none" }}
          >
            {kit.logoPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaSrc(kit.logoPath) ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }} />
            ) : (
              <small style={{ color: "#666", padding: 6, textAlign: "center" }}>{tn.bdLogoEmpty}</small>
            )}
          </span>
          <div className="gm-stack" style={{ gap: 6 }}>
            <label className="gm-btn small" style={{ opacity: busy === "logo" ? 0.6 : 1, pointerEvents: busy === "logo" ? "none" : "auto" }}>
              {busy === "logo" ? tn.uploading : kit.logoPath ? tn.bdLogoChange : tn.bdLogoUpload}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={busy === "logo"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void pickLogo(f);
                }}
              />
            </label>
            <small className="gm-hint">{tn.bdLogoHint}</small>
          </div>
        </div>
        {logoMsg && <p role="status" className={logoMsg.ok ? "gm-ok" : "gm-err"} style={{ margin: 0 }}>{logoMsg.text}</p>}

        <div className="gm-row" style={{ gap: 18, flexWrap: "wrap" }}>
          {(
            [
              ["primary", tn.bdPrimaryHelp],
              ["accent", tn.bdAccentHelp],
              ["text", tn.bdTextHelp],
            ] as const
          ).map(([key, help]) => (
            <label key={key} className="gm-stack" style={{ gap: 4, alignItems: "flex-start" }}>
              <span className="gm-row" style={{ gap: 8 }}>
                <input type="color" value={kit[key]} onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value }))} />
                <strong>{t.settings.colors[key]}</strong>
              </span>
              <small className="gm-hint">{help}</small>
            </label>
          ))}
        </div>
        <details>
          <summary className="gm-hint" style={{ cursor: "pointer" }}>{tn.bdPickFromLogo}</summary>
          <div style={{ marginTop: 8 }}>
            <ReferencePicker logoSrc={mediaSrc(kit.logoPath)} values={kit} onPick={(slot, hex) => setKit((k) => ({ ...k, [slot]: hex }))} />
          </div>
        </details>
        <div className="gm-stack" style={{ gap: 6 }}>
          <small className="gm-hint">{tn.bdFont}</small>
          <div className="gm-chips">
            {(["kufi", "sans"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="gm-chip"
                aria-pressed={kit.headingFont === f}
                style={{ fontFamily: HEADING_FONT[f] }}
                onClick={() => setKit((k) => ({ ...k, headingFont: f }))}
              >
                {f === "kufi" ? tn.fontKufi : tn.fontSans}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Step 2: the frame ────────────────────────────────────────────────────── */}
      <div className="gm-card gm-stack">
        <p className="gm-sec" style={{ margin: 0 }}>{tn.bdStep2}</p>
        <p className="gm-hint" style={{ margin: 0 }}>{tn.bdFrameWhat}</p>
        {framed ? (
          <div
            dir="ltr"
            style={{
              width: 144,
              height: 180,
              borderRadius: 10,
              overflow: "hidden",
              backgroundColor: "#bbb",
              backgroundImage: "linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%),linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 8px 8px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaSrc(kit.framePath) ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "fill" }} />
          </div>
        ) : (
          <small className="gm-sub">{tn.bdFrameNone}</small>
        )}
        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="gm-btn small" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
            {busy === "frame" ? tn.uploading : framed ? tn.bdFrameChange : tn.bdFrameUpload}
            <input
              type="file"
              accept="image/png"
              hidden
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickFrame(f);
              }}
            />
          </label>
          {p.aiFrames && (
            <button type="button" className="gm-btn quiet small" disabled={!!busy} aria-expanded={designing} onClick={() => setDesigning((v) => !v)}>
              {tn.bdFrameDesign}
            </button>
          )}
          <a className="gm-btn quiet small" href="/brand/frame-template-1080x1350.png" download>
            {tn.bdFrameTemplate}
          </a>
          {framed && (
            <button type="button" className="gm-btn quiet small" disabled={!!busy} onClick={removeFrame}>
              {tn.bdFrameRemove}
            </button>
          )}
        </div>

        {designing && p.aiFrames && (
          <div className="gm-stack" style={{ gap: 8 }}>
            <small className="gm-hint">{tn.bdFrameDesignHelp}</small>
            <div className="gm-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label className="gm-btn quiet small" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
                {busy === "ref" ? tn.uploading : tn.bdFrameRef}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  disabled={!!busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pickReference(f);
                  }}
                />
              </label>
              {reference && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaSrc(reference) ?? ""} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 8 }} />
              )}
            </div>
            <input className="gm-input" value={note} maxLength={400} placeholder={tn.bdFrameNotePh} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="gm-btn" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => void designMain()}>
              {busy === "design" ? tn.bdFrameDesigning : tn.bdFrameDesignGo}
            </button>
          </div>
        )}
        {frameMsg && <p role="status" className={frameMsg.ok ? "gm-ok" : "gm-err"} style={{ margin: 0 }}>{frameMsg.text}</p>}

        {framed && (
          <>
            <div className="gm-stack" style={{ gap: 6 }}>
              <small className="gm-hint">{tn.bdFramePlace}</small>
              <div className="gm-chips">
                {FRAME_TEXT.map((pos) => (
                  <button key={pos} type="button" className="gm-chip" aria-pressed={kit.frameText === pos} onClick={() => setKit((k) => ({ ...k, frameText: pos }))}>
                    {tn.frameText[pos]}
                  </button>
                ))}
              </div>
              <small className="gm-hint">{tn.bdFramePlaceAi}</small>
            </div>
            <div className="gm-stack" style={{ gap: 6 }}>
              <small className="gm-hint">{tn.bdFrameLogo}</small>
              <div className="gm-chips">
                {LOGO_CORNERS.map((c) => (
                  <button key={c} type="button" className="gm-chip" aria-pressed={kit.logoCorner === c} onClick={() => setKit((k) => ({ ...k, logoCorner: c }))}>
                    {c === "off" ? tn.bdLogoOff : c === "right" ? tn.bdLogoRight : tn.bdLogoLeft}
                  </button>
                ))}
              </div>
              {kit.logoCorner !== "off" && !kit.logoPath && <small className="gm-err">{tn.bdLogoNeeded}</small>}
            </div>
          </>
        )}
      </div>

      {/* ── Step 3: photos ───────────────────────────────────────────────────────── */}
      <div className="gm-card gm-stack">
        <p className="gm-sec" style={{ margin: 0 }}>{tn.bdStep3}</p>
        <p className="gm-hint" style={{ margin: 0 }}>{tn.bdPhotosHelp}</p>
        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="gm-badge ghost">{tn.bdSourceImg}: {p.sourceImages ? tn.bdOn : tn.bdOff}</span>
          <span className="gm-badge ghost">{tn.bdAiPic}: {p.aiPictures ? tn.bdOn : tn.bdOff}</span>
          <Link href="/newsroom/sources" className="gm-link">{tn.bdSourcesLink}</Link>
        </div>
        {needsPhotos && <p className="gm-err" style={{ margin: 0 }}>{tn.bdNoPhotoWarn}</p>}
        <PhotoLibrary workspaceId={p.workspaceId} photos={photos} onChange={setPhotos} />
      </div>

      {/* ── Step 4: how it looks ─────────────────────────────────────────────────── */}
      <p className="gm-sec" style={{ margin: 0 }}>{tn.bdStep4}</p>
      <ChannelPreview
        kit={kit}
        libraryPhoto={photos[0]?.pathname ?? null}
        photoCardsOnly={only}
        pageName={p.accountNames.IG ?? p.accountNames.FB ?? ""}
        hasInstagram={!!p.accountNames.IG}
      />

      {/* ── More (optional) ──────────────────────────────────────────────────────── */}
      <details className="gm-stack" style={{ gap: 10 }}>
        <summary className="gm-sec" style={{ cursor: "pointer" }}>{tn.bdMore}</summary>
        <div className="gm-stack" style={{ marginTop: 10 }}>
          <p className="gm-hint" style={{ margin: 0 }}>{tn.bdMoreHelp}</p>
          <div className="gm-card gm-stack">
            <div className="gm-between">
              <small className="gm-sub" style={{ margin: 0 }}>{tn.photoOnlyLabel}</small>
              <button type="button" role="switch" aria-checked={only} aria-label={tn.photoOnlyLabel} className="gm-knob" onClick={() => void togglePhotoOnly()}>
                <i />
              </button>
            </div>
            <p className="gm-hint" style={{ margin: 0 }}>{tn.photoOnlyHint}</p>
            {onlyMsg && <p className="gm-err" style={{ margin: 0 }}>{onlyMsg}</p>}
          </div>
          <SectionFrames
            workspaceId={p.workspaceId}
            pageName={p.pageName}
            kit={kit}
            samplePhoto={photos[0]?.pathname ?? null}
            frames={p.sectionFrames}
            designPrompt={p.designPrompt}
            aiEnabled={p.aiFrames}
            photoCardsOnly={only}
            beforeDesign={ensureSaved}
          />
        </div>
      </details>
    </>
  );
}

/** The desk's own photos: pick the file, say what it shows (or mark it general), add. */
function PhotoLibrary({ workspaceId, photos, onChange }: { workspaceId: string; photos: LibraryPhoto[]; onChange: (photos: LibraryPhoto[]) => void }) {
  const t = useT();
  const tn = t.settings.news;
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [general, setGeneral] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function choose(f: File | undefined) {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setNote({ ok: false, text: tn.onlyImages });
    setNote(null);
    setFile(f);
  }

  async function add() {
    if (!file) return;
    if (!general && !label.trim()) return setNote({ ok: false, text: tn.bdPhotoNeedLabel });
    setBusy(true);
    setNote(null);
    try {
      const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const blob = await upload(`merchant/${workspaceId}/photos/${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      const r = await addNewsPhotoAction({ pathname: blob.pathname, url: blob.url, label: label.trim() || tn.bdGeneralLabel, general });
      if (!r.ok) return setNote({ ok: false, text: r.error });
      onChange([r.photo, ...photos]);
      setFile(null);
      setLabel("");
      setGeneral(false);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : t.common.error });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const r = await deleteNewsPhotoAction(id);
      if (r.ok) onChange(photos.filter((x) => x.id !== id));
      else setNote({ ok: false, text: r.error });
    } catch {
      setNote({ ok: false, text: t.common.error });
    }
  }

  return (
    <div className="gm-stack" style={{ gap: 10 }}>
      <label className="gm-btn quiet small" style={{ alignSelf: "flex-start", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
        {file ? file.name.slice(0, 28) : tn.bdPhotoPick}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          disabled={busy}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {file && (
        <div className="gm-stack" style={{ gap: 8 }}>
          <div className="gm-field">
            <label htmlFor="photo-label">{tn.bdPhotoLabel}</label>
            <input id="photo-label" className="gm-input" dir="auto" maxLength={120} value={label} disabled={general} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <label className="gm-radio">
            <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
            <span>{tn.bdPhotoGeneral}</span>
          </label>
          <button type="button" className="gm-btn small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void add()}>
            {busy ? tn.uploading : tn.bdPhotoAdd}
          </button>
        </div>
      )}
      {note && <p className={note.ok ? "gm-ok" : "gm-err"} style={{ margin: 0 }}>{note.text}</p>}
      {photos.length === 0 ? (
        <p className="gm-sub" style={{ margin: 0 }}>{tn.bdPhotosEmpty}</p>
      ) : (
        photos.map((ph) => (
          <div key={ph.id} className="gm-target">
            <div className="gm-row" style={{ gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaSrc(ph.pathname) ?? ""} alt="" style={{ width: 64, height: 80, objectFit: "cover", borderRadius: 8 }} />
              <div>
                <p dir="auto" style={{ margin: 0 }}>{ph.label}</p>
                {ph.general && <span className="gm-badge ghost">{tn.clipGeneralBadge}</span>}
              </div>
            </div>
            <button type="button" className="gm-btn small quiet" onClick={() => void remove(ph.id)}>
              {tn.clipDelete}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
