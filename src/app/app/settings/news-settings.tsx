"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { useT } from "@/lib/i18n/client";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom, mediaSrc } from "@/lib/cards/brand";
import { ReferencePicker } from "./color-picker";
import { AUTO_DAILY_MAX, AUTO_MIN_GAP, AUTO_MODES, AUTO_TARGETS, type AutoMode, type AutoTarget } from "@/lib/news/autopilot-settings";
import { GROUPS, type SourceGroup, type SourceLang } from "@/lib/news/catalog";
import { subcategoryLabel, TAXONOMY } from "@/lib/news/taxonomy";
import { VOICE_NOTE_MAX } from "@/lib/news/voice";
import { FOCUS_PROMPT_MAX, type FilterMode } from "@/lib/news/focus-shared";
import type { PromptFilter } from "@/lib/billing/plans";
import type { LibraryClip } from "@/lib/news/clips";
import { PAWAN_VOICES, SPEECH_SPEED, VOICE_NAMES } from "@/lib/voice/voices";
import { useLang } from "@/lib/i18n/client";
import {
  addRssSourceAction,
  removeSourceAction,
  saveAutopilotAction,
  saveBrandKitAction,
  saveCategoriesAction,
  saveKeywordsAction,
  saveNewsFilterAction,
  saveVideoSettingsAction,
  addNewsClipAction,
  deleteNewsClipAction,
  previewVoiceAction,
  saveVoiceNoteAction,
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
  /** Keywords or a prompt; `level` is what the plan includes (none on LITE and MANUAL). */
  filter: { level: PromptFilter; mode: FilterMode; focus: string; exclude: string; broad: boolean };
  /** Auto-video: `quota` 0 means the plan has none; `full` is ENTERPRISE (the prompt). */
  video: { quota: number; used: number; full: boolean; mode: "OFF" | "AUTO"; style: "TEMPLATE" | "HIGHLIGHT"; clips: LibraryClip[]; topics: string[]; dailyMax: number; voice: string; speed: number; prompt: string };
  voiceNote: string;
  autopilot: {
    mode: AutoMode;
    targets: AutoTarget[];
    dailyMax: number;
    minGapMin: number;
    /** Quiet hours in Baghdad time, or null. */
    quietFrom: number | null;
    quietTo: number | null;
    /** Whether the plan lets the autopilot post by itself. */
    canPublish: boolean;
    refreshSec: number;
    connected: Record<AutoTarget, boolean>;
  };
  feeds: Array<{ id: string; name: string; url: string; lastError: string | null }>;
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: "kufi" | "sans" };
}

const PREVIEW_W = 180;

export function NewsSettings(p: NewsSettingsProps) {
  const router = useRouter();
  const t = useT();
  const tn = t.settings.news;
  const nr = t.nr.news;
  const about: Record<string, string> = nr.settings.about;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywords, setKeywords] = useState(p.keywords.join("، "));
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const [kit, setKit] = useState(p.kit);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [cats, setCats] = useState<string[]>(p.categories);
  const [voiceNote, setVoiceNote] = useState(p.voiceNote);
  const lang = useLang();
  const [video, setVideo] = useState({ ...p.video, dailyMax: String(p.video.dailyMax) });
  const [hearing, setHearing] = useState<string | null>(null);
  const [filter, setFilter] = useState(p.filter);

  async function listen(voice: string) {
    setHearing(voice);
    try {
      const r = await previewVoiceAction(voice, video.speed);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      await new Audio(r.url).play();
    } catch {
      setMsg({ ok: false, text: tn.videoVoiceFailed });
    } finally {
      setHearing(null);
    }
  }
  const promptOn = filter.level !== "none" && filter.mode === "PROMPT";
  const ap = p.autopilot;
  const [auto, setAuto] = useState({
    mode: ap.mode,
    targets: ap.targets,
    dailyMax: String(ap.dailyMax),
    minGapMin: String(ap.minGapMin),
    quietFrom: ap.quietFrom === null ? "" : String(ap.quietFrom),
    quietTo: ap.quietTo === null ? "" : String(ap.quietTo),
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? t.common.error });
      if (r.ok) router.refresh();
    });

  function saveAutopilot() {
    if (auto.mode === "PUBLISH" && !window.confirm(tn.autoConfirm)) return;
    // Only connected pages are sent; the server checks all of it again.
    const targets = auto.targets.filter((k) => ap.connected[k]);
    const hour = (v: string) => (v.trim() === "" ? null : Number(v));
    run(
      () =>
        saveAutopilotAction({
          mode: auto.mode,
          targets,
          dailyMax: Number(auto.dailyMax),
          minGapMin: Number(auto.minGapMin),
          quietFrom: hour(auto.quietFrom),
          quietTo: hour(auto.quietTo),
        }),
      tn.saved,
    );
  }

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
      <p className="gm-sec">{tn.filterSec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-chips">
          {(["KEYWORDS", "PROMPT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="gm-chip"
              aria-pressed={filter.mode === m || (m === "KEYWORDS" && filter.level === "none")}
              disabled={m === "PROMPT" && filter.level === "none"}
              onClick={() => setFilter((f) => ({ ...f, mode: m }))}
            >
              {tn.filterMode[m]}
            </button>
          ))}
        </div>
        {filter.level === "none" ? (
          <p className="gm-hint" style={{ margin: 0 }}>
            <Link href="/newsroom/billing" className="gm-link">{tn.filterPlanOnly}</Link>
          </p>
        ) : (
          promptOn && (
            <>
              <div className="gm-field">
                <label htmlFor="ns-focus">{tn.focusLabel}</label>
                <textarea
                  id="ns-focus"
                  className="gm-textarea"
                  dir="auto"
                  maxLength={FOCUS_PROMPT_MAX}
                  value={filter.focus}
                  placeholder={tn.focusPlaceholder}
                  onChange={(e) => setFilter((f) => ({ ...f, focus: e.target.value }))}
                />
              </div>
              {filter.level === "full" ? (
                <>
                  <div className="gm-field">
                    <label htmlFor="ns-exclude">{tn.excludeLabel}</label>
                    <textarea
                      id="ns-exclude"
                      className="gm-textarea"
                      dir="auto"
                      maxLength={FOCUS_PROMPT_MAX}
                      value={filter.exclude}
                      placeholder={tn.excludePlaceholder}
                      onChange={(e) => setFilter((f) => ({ ...f, exclude: e.target.value }))}
                    />
                  </div>
                  <div className="gm-chips">
                    {([false, true] as const).map((b) => (
                      <button key={String(b)} type="button" className="gm-chip" aria-pressed={filter.broad === b} onClick={() => setFilter((f) => ({ ...f, broad: b }))}>
                        {b ? tn.focusBroad : tn.focusStrict}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="gm-hint" style={{ margin: 0 }}>
                  <Link href="/newsroom/billing" className="gm-link">{tn.filterFullOnly}</Link>
                </p>
              )}
              <p className="gm-hint" style={{ margin: 0 }}>{tn.focusHint}</p>
            </>
          )
        )}
        {filter.level !== "none" && (
          <button
            type="button"
            className="gm-btn"
            disabled={pending}
            onClick={() => run(() => saveNewsFilterAction({ mode: filter.mode, focus: filter.focus, exclude: filter.exclude, broad: filter.broad }), tn.saved)}
          >
            {tn.save}
          </button>
        )}
      </div>

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
              <p className="gm-hint" style={{ fontWeight: 700, margin: "10px 0 2px" }}>{nr.settings.groups[g.id]}</p>
              {entries.map((c) => (
                <div key={c.id} className="gm-target">
                  <div>
                    <p>
                      {c.name} {c.lang && <span className="gm-badge ghost">{nr.langs[c.lang]}</span>}
                    </p>
                    <small>{c.lastError ? tn.sourceError(c.lastError) : about[c.id] ?? c.description ?? ""}</small>
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
                  {nr.topics[c.id]}
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
                        {subcategoryLabel(c.id, s.id, nr)}
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

      <p className="gm-sec">{tn.voiceSec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-field">
          <label htmlFor="ns-voice">{tn.voiceLabel}</label>
          <textarea
            id="ns-voice"
            className="gm-textarea"
            dir="auto"
            maxLength={VOICE_NOTE_MAX}
            value={voiceNote}
            onChange={(e) => setVoiceNote(e.target.value)}
          />
          <p className="gm-hint" style={{ marginBottom: 0 }}>{tn.voiceHint}</p>
        </div>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveVoiceNoteAction(voiceNote), tn.saved)}>
          {tn.save}
        </button>
      </div>

      <p className="gm-sec">{tn.autoSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>
          {t.billing.features.label.refresh}: {t.billing.features.refresh(ap.refreshSec)}. {tn.autoTopicsAbove}.
        </p>
        <div className="gm-chips">
          {AUTO_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className="gm-chip"
              aria-pressed={auto.mode === m}
              disabled={m === "PUBLISH" && !ap.canPublish}
              onClick={() => setAuto((a) => ({ ...a, mode: m }))}
            >
              {tn.autoMode[m]}
            </button>
          ))}
        </div>
        {!ap.canPublish && (
          <p className="gm-hint" style={{ margin: 0 }}>
            <Link href="/newsroom/billing" className="gm-link">{tn.autoPlanOnly}</Link>
          </p>
        )}
        <div>
          {AUTO_TARGETS.map((k) => (
            <label key={k} className="gm-radio" style={ap.connected[k] ? undefined : { cursor: "not-allowed" }}>
              <input
                type="checkbox"
                checked={ap.connected[k] && auto.targets.includes(k)}
                disabled={!ap.connected[k]}
                onChange={(e) =>
                  setAuto((a) => ({ ...a, targets: e.target.checked ? [...a.targets.filter((x) => x !== k), k] : a.targets.filter((x) => x !== k) }))
                }
              />
              {t.platform[k]}
              {!ap.connected[k] && <span className="gm-badge ghost">{t.settings.notConnectedBadge}</span>}
            </label>
          ))}
          {[tn.autoTikTok, tn.autoYouTube].map((label) => (
            <label key={label} className="gm-radio" style={{ cursor: "not-allowed", color: "var(--muted)" }}>
              <input type="checkbox" checked={false} disabled readOnly />
              {label}
            </label>
          ))}
        </div>
        <div className="gm-field">
          <label htmlFor="ns-auto-max">{tn.autoDailyMax}</label>
          <input
            id="ns-auto-max"
            className="gm-input gm-ltr"
            dir="ltr"
            type="number"
            inputMode="numeric"
            min={AUTO_DAILY_MAX.min}
            max={AUTO_DAILY_MAX.max}
            step={1}
            value={auto.dailyMax}
            onChange={(e) => setAuto((a) => ({ ...a, dailyMax: e.target.value }))}
          />
        </div>
        <div className="gm-field">
          <label htmlFor="ns-auto-gap">{tn.autoMinGap}</label>
          <input
            id="ns-auto-gap"
            className="gm-input gm-ltr"
            dir="ltr"
            type="number"
            inputMode="numeric"
            min={AUTO_MIN_GAP.min}
            max={AUTO_MIN_GAP.max}
            step={1}
            value={auto.minGapMin}
            onChange={(e) => setAuto((a) => ({ ...a, minGapMin: e.target.value }))}
          />
        </div>
        <div className="gm-field">
          <label>{tn.autoQuiet}</label>
          <div className="gm-row" style={{ gap: 8, alignItems: "center" }}>
            <input
              className="gm-input gm-ltr"
              dir="ltr"
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              placeholder="1"
              aria-label={tn.autoQuietFrom}
              value={auto.quietFrom}
              onChange={(e) => setAuto((a) => ({ ...a, quietFrom: e.target.value }))}
              style={{ width: 90 }}
            />
            <span>{tn.autoQuietTo}</span>
            <input
              className="gm-input gm-ltr"
              dir="ltr"
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              placeholder="8"
              aria-label={tn.autoQuietTo}
              value={auto.quietTo}
              onChange={(e) => setAuto((a) => ({ ...a, quietTo: e.target.value }))}
              style={{ width: 90 }}
            />
          </div>
          <p className="gm-hint" style={{ marginBottom: 0 }}>{tn.autoQuietHint}</p>
        </div>
        <p className="gm-note warn" style={{ margin: 0 }}>{tn.autoWarn}</p>
        <button type="button" className="gm-btn" disabled={pending} onClick={saveAutopilot}>
          {tn.save}
        </button>
      </div>

      <p className="gm-sec">{tn.videoSec}</p>
      <div className="gm-card gm-stack">
        {video.quota < 1 ? (
          <p className="gm-hint" style={{ margin: 0 }}>
            <Link href="/newsroom/billing" className="gm-link">{tn.videoPlanOnly}</Link>
          </p>
        ) : (
          <>
            <p className="gm-hint" style={{ margin: 0 }}>{tn.videoHint}</p>
            <div className="gm-chips">
              {(["OFF", "AUTO"] as const).map((m) => (
                <button key={m} type="button" className="gm-chip" aria-pressed={video.mode === m} onClick={() => setVideo((v) => ({ ...v, mode: m }))}>
                  {tn.videoMode[m]}
                </button>
              ))}
            </div>
            {video.mode === "AUTO" && (
              <>
                <div className="gm-chips">
                  {(["TEMPLATE", "HIGHLIGHT"] as const).map((st) => (
                    <button key={st} type="button" className="gm-chip" aria-pressed={video.style === st} onClick={() => setVideo((v) => ({ ...v, style: st }))}>
                      {tn.videoStyle[st]}
                    </button>
                  ))}
                </div>
                {video.style === "HIGHLIGHT" && <ClipLibrary workspaceId={p.workspaceId} initial={p.video.clips} />}
                <p className="gm-hint" style={{ margin: 0 }}>{tn.videoTopicsHint}</p>
                <div className="gm-chips">
                  {TAXONOMY.map((c) => {
                    const on = video.topics.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="gm-chip"
                        aria-pressed={on}
                        onClick={() => setVideo((v) => ({ ...v, topics: on ? v.topics.filter((x) => x !== c.id) : [...v.topics, c.id] }))}
                      >
                        {nr.topics[c.id]}
                      </button>
                    );
                  })}
                </div>
                {video.full && (
                  <div className="gm-field">
                    <label htmlFor="ns-video-prompt">{tn.videoPrompt}</label>
                    <textarea
                      id="ns-video-prompt"
                      className="gm-textarea"
                      dir="auto"
                      maxLength={FOCUS_PROMPT_MAX}
                      value={video.prompt}
                      placeholder={tn.videoPromptPlaceholder}
                      onChange={(e) => setVideo((v) => ({ ...v, prompt: e.target.value }))}
                    />
                  </div>
                )}
                <div className="gm-field">
                  <label htmlFor="ns-video-max">{tn.videoDailyMax}</label>
                  <input
                    id="ns-video-max"
                    className="gm-input gm-ltr"
                    dir="ltr"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    value={video.dailyMax}
                    onChange={(e) => setVideo((v) => ({ ...v, dailyMax: e.target.value }))}
                  />
                </div>
                <p className="gm-hint" style={{ margin: 0, fontWeight: 700 }}>{tn.videoVoice}</p>
                <div className="gm-chips">
                  {PAWAN_VOICES.map((voice) => (
                    <span key={voice} className="gm-row" style={{ gap: 4 }}>
                      <button type="button" className="gm-chip" aria-pressed={video.voice === voice} onClick={() => setVideo((v) => ({ ...v, voice }))}>
                        {lang === "en" ? VOICE_NAMES[voice].en : VOICE_NAMES[voice].ku}
                      </button>
                      <button
                        type="button"
                        className="gm-btn quiet small"
                        aria-label={`${tn.videoListen}: ${VOICE_NAMES[voice].en}`}
                        disabled={hearing !== null}
                        onClick={() => listen(voice)}
                      >
                        {hearing === voice ? "…" : "▶"}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="gm-field">
                  <label htmlFor="ns-video-speed">{tn.videoSpeed(video.speed.toFixed(2))}</label>
                  <input
                    id="ns-video-speed"
                    type="range"
                    min={SPEECH_SPEED.min}
                    max={SPEECH_SPEED.max}
                    step={0.05}
                    value={video.speed}
                    onChange={(e) => setVideo((v) => ({ ...v, speed: Number(e.target.value) }))}
                  />
                </div>
              </>
            )}
            <p className="gm-hint" style={{ margin: 0 }}>{tn.videoUsage(video.used, video.quota)}</p>
            <button
              type="button"
              className="gm-btn"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    saveVideoSettingsAction({
                      mode: video.mode,
                      style: video.style,
                      topics: video.topics,
                      dailyMax: Number(video.dailyMax),
                      voice: video.voice,
                      speed: video.speed,
                      prompt: video.prompt,
                    }),
                  tn.saved,
                )
              }
            >
              {tn.save}
            </button>
          </>
        )}
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

/** The desk's own footage for automatic highlights: upload, say what it shows, delete. */
function ClipLibrary({ workspaceId, initial }: { workspaceId: string; initial: LibraryClip[] }) {
  const t = useT();
  const tn = t.settings.news;
  const [clips, setClips] = useState(initial);
  const [label, setLabel] = useState("");
  const [general, setGeneral] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(file: File | undefined) {
    if (!file) return;
    if (file.type !== "video/mp4" && file.type !== "video/quicktime") return setNote({ ok: false, text: t.common.error });
    if (!label.trim()) return setNote({ ok: false, text: tn.clipBadLabel });
    setBusy(true);
    setNote(null);
    try {
      const ext = file.type === "video/quicktime" ? "mov" : "mp4";
      const blob = await upload(`merchant/${workspaceId}/footage/library-${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
        multipart: file.size > 20 * 1024 * 1024,
      });
      const r = await addNewsClipAction({ url: blob.url, label, general });
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setClips((c) => [r.clip, ...c]);
      setLabel("");
      setGeneral(false);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : t.common.error });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const r = await deleteNewsClipAction(id);
    if (r.ok) setClips((c) => c.filter((x) => x.id !== id));
    else setNote({ ok: false, text: r.error });
  }

  return (
    <div className="gm-stack" style={{ gap: 10 }}>
      <p className="gm-sec" style={{ margin: 0 }}>{tn.clipsSec}</p>
      <p className="gm-hint" style={{ margin: 0 }}>{tn.clipsHint}</p>
      <div className="gm-field">
        <label htmlFor="clip-label">{tn.clipLabel}</label>
        <input id="clip-label" className="gm-input" dir="auto" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <label className="gm-radio">
        <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
        <span>{tn.clipGeneral}</span>
      </label>
      <label className="gm-btn quiet small" style={{ alignSelf: "flex-start", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
        {busy ? tn.clipUploading : tn.clipAdd}
        <input type="file" accept="video/mp4,video/quicktime" hidden disabled={busy} onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {note && <p className={note.ok ? "gm-ok" : "gm-err"} style={{ margin: 0 }}>{note.text}</p>}
      {clips.length === 0 ? (
        <p className="gm-sub" style={{ margin: 0 }}>{tn.clipsEmpty}</p>
      ) : (
        clips.map((c) => (
          <div key={c.id} className="gm-target">
            <div className="gm-row" style={{ gap: 10 }}>
              <video src={c.url} preload="metadata" muted playsInline style={{ width: 54, height: 96, objectFit: "cover", borderRadius: 8, background: "#000" }} />
              <div>
                <p dir="auto" style={{ margin: 0 }}>{c.label}</p>
                {c.general && <span className="gm-badge ghost">{tn.clipGeneralBadge}</span>}
              </div>
            </div>
            <button type="button" className="gm-btn small quiet" onClick={() => void remove(c.id)}>
              {tn.clipDelete}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
