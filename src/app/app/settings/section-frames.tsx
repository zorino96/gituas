"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";

import { useT } from "@/lib/i18n/client";
import { brandFrom, FRAME_TEXT, mediaSrc, type FrameText } from "@/lib/cards/brand";
import { CARD_H, CARD_W, NewsCard } from "@/lib/cards/templates";
import { FRAME_SECTIONS } from "@/lib/news/frames-shared";
import {
  designSectionFrameAction,
  removeSectionFrameAction,
  saveDesignPromptAction,
  saveSectionFrameAction,
  saveSectionFrameTextAction,
} from "@/app/newsroom/(desk)/news/actions";

export interface SectionFrame {
  section: string;
  framePath: string;
  frameText: FrameText;
  referencePath: string | null;
  note: string;
}

export interface SectionFramesProps {
  workspaceId: string;
  pageName: string;
  /** The desk's brand as it is now on the screen (main frame included). */
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: "kufi" | "sans"; framePath: string | null; frameText: FrameText };
  /** A photo of the library to show behind the frames. */
  samplePhoto: string | null;
  frames: SectionFrame[];
  designPrompt: string;
  /** The AI image service is configured. */
  aiEnabled: boolean;
  /** Every card is the photo card: a breaking frame is never used. */
  photoCardsOnly?: boolean;
  /** Called before any design: writes what is on the screen. Returns an error text, or null when ready. */
  beforeDesign?: () => Promise<string | null>;
}

const PREVIEW_W = 150;
const PROMPT_MAX = 1_200;
const NOTE_MAX = 400;

/** A picture of 4:5 shape, as a finished card frame must be. */
async function frameShapeOk(file: File): Promise<boolean> {
  const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
  return !!size && size.w >= 540 && Math.abs(size.w / size.h - CARD_W / CARD_H) <= 0.02;
}

export function SectionFrames(p: SectionFramesProps) {
  const t = useT();
  const tn = t.settings.news;
  const fr = tn.frames;
  const topics: Record<string, string> = t.nr.news.topics;
  const [frames, setFrames] = useState<SectionFrame[]>(p.frames);
  const [opened, setOpened] = useState<string[]>(p.frames.map((f) => f.section));
  const [prompt, setPrompt] = useState(p.designPrompt);
  const [savedPrompt, setSavedPrompt] = useState(p.designPrompt);
  const [promptMsg, setPromptMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [allRef, setAllRef] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState<null | "upload" | "run">(null);
  const [allMsg, setAllMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const nameOf = (s: string) => (s === "breaking" ? fr.breaking : (topics[s] ?? s));
  // With photo cards only, a breaking card never exists, so its frame would never be used.
  const usable = FRAME_SECTIONS.filter((s) => !(p.photoCardsOnly && s === "breaking"));
  const free = usable.filter((s) => !opened.includes(s));

  /** What the AI reads (brand, main frame, the desk's words) is saved first. Returns an error text or null. */
  async function ensureReady(): Promise<string | null> {
    const early = await p.beforeDesign?.();
    if (early) return early;
    if (prompt !== savedPrompt) {
      try {
        const r = await saveDesignPromptAction(prompt);
        if (!r.ok) return r.error;
        setSavedPrompt(r.designPrompt);
      } catch {
        return t.common.error;
      }
    }
    return null;
  }

  function put(next: SectionFrame) {
    setFrames((all) => [...all.filter((f) => f.section !== next.section), next]);
  }
  function drop(section: string) {
    setFrames((all) => all.filter((f) => f.section !== section));
  }

  async function pickAllReference(file: File) {
    setAllMsg(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setAllMsg({ ok: false, text: tn.onlyImages });
    setAllBusy("upload");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/frameref-all-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setAllRef(blob.pathname);
    } catch (e) {
      setAllMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setAllBusy(null);
    }
  }

  // One section after another (each is a minute of AI work and its own paid slot); the daily cap ends the run.
  async function designMissing() {
    const todo = usable.filter((s) => !frames.some((f) => f.section === s)).slice(0, 6);
    if (!todo.length) return;
    setAllBusy("run");
    setAllMsg(null);
    let done = 0;
    try {
      const early = await ensureReady();
      if (early) return setAllMsg({ ok: false, text: early });
      for (const section of todo) {
        setAllMsg({ ok: true, text: fr.allProgress(nameOf(section), done + 1, todo.length) });
        const r = await designSectionFrameAction({ section, referencePath: allRef, note: "", frameText: p.kit.frameText });
        if (!r.ok) return setAllMsg({ ok: false, text: fr.allStopped(done, r.error) });
        done++;
        put({ section, framePath: r.framePath, frameText: p.kit.frameText, referencePath: allRef, note: "" });
        setOpened((o) => (o.includes(section) ? o : [...o, section]));
      }
      setAllMsg({ ok: true, text: fr.allDone(done) });
    } catch (e) {
      setAllMsg({ ok: false, text: fr.allStopped(done, e instanceof Error ? e.message : t.common.error) });
    } finally {
      setAllBusy(null);
    }
  }

  async function savePrompt() {
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const r = await saveDesignPromptAction(prompt);
      if (r.ok) {
        setPrompt(r.designPrompt);
        setSavedPrompt(r.designPrompt);
        setPromptMsg({ ok: true, text: fr.promptSaved });
      } else setPromptMsg({ ok: false, text: r.error });
    } catch {
      setPromptMsg({ ok: false, text: t.common.error });
    } finally {
      setPromptBusy(false);
    }
  }

  return (
    <>
      <div className="gm-card gm-stack">
        <p className="gm-sec" style={{ margin: 0 }}>{fr.sec}</p>
        <p className="gm-hint" style={{ margin: 0 }}>{fr.hint}</p>
        {!p.kit.framePath && <p className="gm-hint" style={{ margin: 0 }}>{fr.needMain}</p>}
        <label className="gm-stack" style={{ gap: 6 }}>
          <span>{fr.promptLabel}</span>
          <textarea
            className="gm-input"
            rows={3}
            maxLength={PROMPT_MAX}
            value={prompt}
            placeholder={fr.promptPlaceholder}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <small className="gm-hint">{fr.promptHelp}</small>
        </label>
        <button type="button" className="gm-btn quiet small" style={{ alignSelf: "flex-start" }} disabled={promptBusy} onClick={() => void savePrompt()}>
          {fr.promptSave}
        </button>
        {promptMsg && <p className={promptMsg.ok ? "gm-ok" : "gm-err"}>{promptMsg.text}</p>}
      </div>

      {p.aiEnabled && (
        <div className="gm-card gm-stack">
          <p className="gm-sec" style={{ margin: 0 }}>{fr.allTitle}</p>
          <p className="gm-hint" style={{ margin: 0 }}>{fr.allHelp}</p>
          <div className="gm-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label className="gm-btn quiet small" style={{ opacity: allBusy ? 0.6 : 1, pointerEvents: allBusy ? "none" : "auto" }}>
              {allBusy === "upload" ? tn.uploading : fr.allPick}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!allBusy} onChange={(e) => { if (e.target.files?.[0]) void pickAllReference(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {allRef && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaSrc(allRef) ?? ""} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 8 }} />
            )}
          </div>
          <button type="button" className="gm-btn" style={{ alignSelf: "flex-start" }} disabled={!!allBusy || !usable.some((s) => !frames.some((f) => f.section === s))} onClick={() => void designMissing()}>
            {fr.allStart}
          </button>
          {allMsg && <p className={allMsg.ok ? "gm-ok" : "gm-err"}>{allMsg.text}</p>}
        </div>
      )}

      <div className="gm-stack">
        {opened.map((section) => (
          <SectionCard
            key={section}
            section={section}
            name={nameOf(section)}
            frame={frames.find((f) => f.section === section) ?? null}
            p={p}
            locked={!!allBusy}
            ensure={ensureReady}
            onSaved={put}
            onRemoved={(s) => {
              drop(s);
              setOpened((o) => o.filter((x) => x !== s));
            }}
          />
        ))}
        {free.length > 0 && (
          <div className="gm-card gm-stack">
            <p className="gm-hint" style={{ margin: 0 }}>{fr.addSection}</p>
            <div className="gm-chips">
              {free.map((s) => (
                <button key={s} type="button" className="gm-chip" onClick={() => setOpened((o) => [...o, s])}>
                  + {nameOf(s)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SectionCard({
  section,
  name,
  frame,
  p,
  locked,
  ensure,
  onSaved,
  onRemoved,
}: {
  section: string;
  name: string;
  frame: SectionFrame | null;
  p: SectionFramesProps;
  /** A run of "design all" is going: the card's own buttons wait. */
  locked: boolean;
  ensure: () => Promise<string | null>;
  onSaved: (f: SectionFrame) => void;
  onRemoved: (section: string) => void;
}) {
  const t = useT();
  const tn = t.settings.news;
  const fr = tn.frames;
  const [designing, setDesigning] = useState(false);
  const [reference, setReference] = useState<string | null>(frame?.referencePath ?? null);
  const [note, setNote] = useState(frame?.note ?? "");
  const [busy, setBusy] = useState<null | "upload" | "reference" | "design" | "remove">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const text: FrameText = frame?.frameText ?? p.kit.frameText;
  const shownFrame = frame?.framePath ?? p.kit.framePath;
  const brand = brandFrom({ ...p.kit, framePath: shownFrame, frameText: text }, p.pageName);

  async function pickReady(file: File) {
    setMsg(null);
    if (file.type !== "image/png" || !(await frameShapeOk(file))) return setMsg({ ok: false, text: tn.frameBadSize });
    setBusy("upload");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/frame-${section}-${Date.now()}.png`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: "image/png",
      });
      const r = await saveSectionFrameAction({ section, framePath: blob.pathname, frameText: text });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      onSaved({ section, framePath: blob.pathname, frameText: text, referencePath: reference, note });
      setMsg({ ok: true, text: fr.saved });
    } catch (e) {
      setMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setBusy(null);
    }
  }

  async function pickReference(file: File) {
    setMsg(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setMsg({ ok: false, text: tn.onlyImages });
    setBusy("reference");
    try {
      const blob = await upload(`merchant/${p.workspaceId}/frameref-${section}-${Date.now()}.${file.type.split("/")[1]}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
      });
      setReference(blob.pathname);
    } catch (e) {
      setMsg({ ok: false, text: tn.logoFailed(e instanceof Error ? e.message : t.common.error) });
    } finally {
      setBusy(null);
    }
  }

  async function design() {
    setMsg(null);
    setBusy("design");
    try {
      const early = await ensure();
      if (early) return setMsg({ ok: false, text: early });
      const r = await designSectionFrameAction({ section, referencePath: reference, note, frameText: text });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      onSaved({ section, framePath: r.framePath, frameText: text, referencePath: reference, note });
      setDesigning(false);
      setMsg({ ok: true, text: fr.done });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t.common.error });
    } finally {
      setBusy(null);
    }
  }

  async function setText(pos: FrameText) {
    if (!frame) return;
    const before = frame;
    onSaved({ ...frame, frameText: pos });
    try {
      const r = await saveSectionFrameTextAction(section, pos);
      if (!r.ok) {
        onSaved(before);
        setMsg({ ok: false, text: r.error });
      }
    } catch {
      onSaved(before);
      setMsg({ ok: false, text: t.common.error });
    }
  }

  async function remove() {
    if (frame && !window.confirm(tn.bdSectionRemoveConfirm)) return;
    setBusy("remove");
    try {
      const r = frame ? await removeSectionFrameAction(section) : { ok: true as const };
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      onRemoved(section);
    } catch {
      setMsg({ ok: false, text: t.common.error });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="gm-card">
      <div className="gm-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div dir="ltr" style={{ width: PREVIEW_W, height: (CARD_H * PREVIEW_W) / CARD_W, overflow: "hidden", borderRadius: 10, flex: "none" }}>
          <div style={{ transform: `scale(${PREVIEW_W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
            <NewsCard
              kind={section === "breaking" ? "BREAKING" : "STANDARD"}
              brand={brand}
              content={{ headline: tn.cardSample, stat: null, quote: null, speaker: null, stamp: "١٠:٤٢", photoSrc: mediaSrc(p.samplePhoto) ?? "/brand/sample-photo.jpg" }}
            />
          </div>
        </div>
        <div className="gm-stack" style={{ flex: 1, minWidth: 220, gap: 8 }}>
          <p className="gm-sec" style={{ margin: 0 }}>{name}</p>
          <small className="gm-hint">{frame ? fr.ownFrame : fr.mainFrame}</small>
          <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="gm-btn quiet small" style={{ opacity: busy || locked ? 0.6 : 1, pointerEvents: busy || locked ? "none" : "auto" }}>
              {busy === "upload" ? tn.uploading : fr.uploadReady}
              <input type="file" accept="image/png" hidden disabled={!!busy} onChange={(e) => { if (e.target.files?.[0]) void pickReady(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {p.aiEnabled && (
              <button type="button" className="gm-btn small" disabled={!!busy || locked} onClick={() => setDesigning((v) => !v)} aria-expanded={designing}>
                {fr.design}
              </button>
            )}
            <button type="button" className="gm-btn quiet small" disabled={!!busy || locked} onClick={() => void remove()}>
              {frame ? fr.remove : tn.bdClose}
            </button>
          </div>
          {frame && (
            <>
              <small className="gm-hint">{tn.frameTextLabel}</small>
              <div className="gm-chips">
                {FRAME_TEXT.map((pos) => (
                  <button key={pos} type="button" className="gm-chip" aria-pressed={frame.frameText === pos} onClick={() => void setText(pos)}>
                    {tn.frameText[pos]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {designing && p.aiEnabled && (
        <div className="gm-stack" style={{ marginTop: 12 }}>
          <p className="gm-sec" style={{ margin: 0 }}>{fr.designSec}</p>
          <div className="gm-stack" style={{ gap: 6 }}>
            <span>{fr.referenceLabel}</span>
            <small className="gm-hint">{fr.referenceHelp}</small>
            <div className="gm-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label className="gm-btn quiet small" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
                {busy === "reference" ? tn.uploading : fr.referencePick}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!busy} onChange={(e) => { if (e.target.files?.[0]) void pickReference(e.target.files[0]); e.target.value = ""; }} />
              </label>
              {reference && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaSrc(reference) ?? ""} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 8 }} />
                  <button type="button" className="gm-btn quiet small" onClick={() => setReference(null)}>{fr.referenceClear}</button>
                </>
              )}
            </div>
          </div>
          <label className="gm-stack" style={{ gap: 6 }}>
            <span>{fr.noteLabel}</span>
            <input className="gm-input" value={note} maxLength={NOTE_MAX} placeholder={fr.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
          </label>
          <small className="gm-hint">{fr.cost}</small>
          <button type="button" className="gm-btn" style={{ alignSelf: "flex-start" }} disabled={!!busy || locked} onClick={() => void design()}>
            {busy === "design" ? fr.designing : fr.start}
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "gm-ok" : "gm-err"}>{msg.text}</p>}
    </div>
  );
}
