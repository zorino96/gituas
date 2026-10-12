"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLang, useT } from "@/lib/i18n/client";
import { PAWAN_VOICES, VOICE_NAMES } from "@/lib/voice/voices";
import { SaveMessage, SwitchRow, useSaver } from "../automation/shared";
import { createVideoAction, publishVideoAction, saveVideoAutoAction } from "./actions";

type Tier = "LITE" | "PRO";

export interface VideoJobView {
  id: string;
  tier: Tier;
  status: string;
  source: string;
  topic: string | null;
  productName: string | null;
  caption: string | null;
  videoUrl: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
}

interface Props {
  storeId: string;
  stores: { id: string; name: string }[];
  canFb: boolean;
  canIg: boolean;
  products: { id: string; name: string; hasPhoto: boolean }[];
  allowances: Record<Tier, { limit: number; used: number; left: number }>;
  auto: { mode: string; tier: Tier; hour: number };
  jobs: VideoJobView[];
  configure: boolean;
}

/** Statuses in which something is still going on: the page refreshes itself. */
const BUSY = ["QUEUED", "READY", "RENDERING", "POSTING"];

export function VideoClient({ storeId, stores, canFb, canIg, products, allowances, auto, jobs, configure }: Props) {
  const router = useRouter();
  const t = useT();
  const v = t.video;
  const lang = useLang();
  const uid = useId();
  const [tier, setTier] = useState<Tier>(allowances.LITE.left > 0 || allowances.PRO.left === 0 ? "LITE" : "PRO");
  const [productId, setProductId] = useState("");
  const [topic, setTopic] = useState("");
  const [voice, setVoice] = useState("shilan");
  const [publish, setPublish] = useState(false);
  const [fb, setFb] = useState(canFb);
  const [ig, setIg] = useState(canIg);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // While a video is being made the list keeps itself up to date.
  const busy = jobs.some((j) => BUSY.includes(j.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(timer);
  }, [busy, router]);

  const left = allowances[tier];
  const targets = [...(fb && canFb ? ["FB"] : []), ...(ig && canIg ? ["IG"] : [])];

  function create() {
    setNote(null);
    start(async () => {
      const r = await createVideoAction(storeId, { tier, topic, productId: productId || null, voice, publish, targets });
      if (r.ok) {
        setNote({ ok: true, text: v.created });
        setTopic("");
        router.refresh();
      } else {
        setNote({ ok: false, text: r.error });
      }
    });
  }

  return (
    <div>
      <h2 className="gm-title kufi">{v.title}</h2>
      <p className="gm-sub">{v.sub}</p>

      {stores.length > 1 && (
        <select className="gm-input" aria-label="store" style={{ marginBottom: 12 }} value={storeId} onChange={(e) => router.push(`/app/video?store=${encodeURIComponent(e.target.value)}`)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <p className="gm-sec">{v.makeSec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-field">
          <label>{v.tierLabel}</label>
          <div className="gm-seg" role="group" aria-label={v.tierLabel}>
            <button type="button" aria-pressed={tier === "LITE"} onClick={() => setTier("LITE")}>
              {v.lite}
            </button>
            <button type="button" aria-pressed={tier === "PRO"} onClick={() => setTier("PRO")}>
              {v.pro}
            </button>
          </div>
          <p className="gm-hint">
            {tier === "LITE" ? v.liteHint : v.proHint} · {left.limit > 0 ? v.left(left.left, left.limit) : v.noneLeft}
          </p>
        </div>

        <div className="gm-field">
          <label htmlFor={`${uid}-product`}>{v.productLabel}</label>
          <select id={`${uid}-product`} className="gm-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{v.wholeShop}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hasPhoto ? "" : ` (${v.noPhoto})`}
              </option>
            ))}
          </select>
        </div>

        <div className="gm-field">
          <label htmlFor={`${uid}-topic`}>{v.topicLabel}</label>
          <textarea id={`${uid}-topic`} className="gm-textarea" style={{ minHeight: 84 }} value={topic} maxLength={300} placeholder={v.topicPlaceholder} onChange={(e) => setTopic(e.target.value)} />
        </div>

        <div className="gm-field">
          <label htmlFor={`${uid}-voice`}>{v.voiceLabel}</label>
          <select id={`${uid}-voice`} className="gm-input" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {PAWAN_VOICES.map((name) => (
              <option key={name} value={name}>
                {lang === "en" ? VOICE_NAMES[name].en : VOICE_NAMES[name].ku}
              </option>
            ))}
          </select>
        </div>

        {(canFb || canIg) && (
          <>
            <SwitchRow label={v.publishWhenReady} checked={publish} disabled={pending} onToggle={() => setPublish((x) => !x)} />
            {publish && (
              <div className="gm-chips" role="group" aria-label={v.targetsLabel}>
                {canFb && (
                  <button type="button" className="gm-chip" aria-pressed={fb} onClick={() => setFb((x) => !x)}>
                    Facebook
                  </button>
                )}
                {canIg && (
                  <button type="button" className="gm-chip" aria-pressed={ig} onClick={() => setIg((x) => !x)}>
                    Instagram
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <button type="button" className="gm-btn" disabled={pending || left.left < 1 || (publish && !targets.length)} onClick={create}>
            {v.create}
          </button>
          {note && <p className={note.ok ? "gm-ok" : "gm-err"}>{note.text}</p>}
        </div>
      </div>

      {configure && <AutoCard storeId={storeId} auto={auto} allowances={allowances} canPublish={canFb || canIg} />}

      <p className="gm-sec">{v.listSec}</p>
      {jobs.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">{v.empty}</b>
        </div>
      ) : (
        <div className="gm-stack">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} canFb={canFb} canIg={canIg} />
          ))}
        </div>
      )}
    </div>
  );
}

function AutoCard({ storeId, auto, allowances, canPublish }: { storeId: string; auto: Props["auto"]; allowances: Props["allowances"]; canPublish: boolean }) {
  const v = useT().video;
  const { pending, message, run } = useSaver();
  const [mode, setMode] = useState(auto.mode);
  const [tier, setTier] = useState<Tier>(auto.tier);
  const [hour, setHour] = useState(auto.hour);
  return (
    <>
      <p className="gm-sec">{v.autoSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {v.autoSub}
        </p>
        <div className="gm-seg" role="group" aria-label={v.autoSec}>
          <button type="button" aria-pressed={mode === "OFF"} onClick={() => setMode("OFF")}>
            {v.autoOff}
          </button>
          <button type="button" aria-pressed={mode === "DRAFT"} onClick={() => setMode("DRAFT")}>
            {v.autoDraft}
          </button>
          {canPublish && (
            <button type="button" aria-pressed={mode === "PUBLISH"} onClick={() => setMode("PUBLISH")}>
              {v.autoPublish}
            </button>
          )}
        </div>
        {mode !== "OFF" && (
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            <div className="gm-seg" role="group" aria-label={v.tierLabel}>
              <button type="button" aria-pressed={tier === "LITE"} onClick={() => setTier("LITE")}>
                {v.lite}
              </button>
              <button type="button" aria-pressed={tier === "PRO"} disabled={allowances.PRO.limit === 0} onClick={() => setTier("PRO")}>
                {v.pro}
              </button>
            </div>
            <label className="gm-hint" style={{ margin: 0 }}>
              {v.autoHour}{" "}
              <select className="gm-input gm-ltr" style={{ width: 96, display: "inline-block" }} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div>
          <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveVideoAutoAction(storeId, { mode, tier, hour }))}>
            {v.autoSave}
          </button>
          <SaveMessage message={message} />
        </div>
      </div>
    </>
  );
}

function JobCard({ job, canFb, canIg }: { job: VideoJobView; canFb: boolean; canIg: boolean }) {
  const router = useRouter();
  const v = useT().video;
  const [fb, setFb] = useState(canFb);
  const [ig, setIg] = useState(canIg);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const targets = [...(fb && canFb ? ["FB"] : []), ...(ig && canIg ? ["IG"] : [])];
  const label = (v.status as Record<string, string>)[job.status] ?? job.status;
  const tone = job.status === "FAILED" ? "warn" : job.status === "RENDERED" || job.status === "POSTED" ? "" : "ghost";

  function post() {
    setErr(null);
    start(async () => {
      const r = await publishVideoAction(job.id, targets);
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <div className="gm-card">
      <div className="gm-between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="gm-chips">
            <span className={`gm-badge ${tone}`}>{label}</span>
            <span className="gm-badge ghost">{job.tier === "PRO" ? v.pro : v.lite}</span>
            {job.source === "AUTO" && <span className="gm-badge ghost">{v.auto}</span>}
          </div>
          <p className="gm-hint" style={{ marginTop: 8 }}>
            {job.createdAt.slice(0, 10)}
            {job.productName ? ` · ${job.productName}` : ""}
            {job.topic ? ` · ${job.topic}` : ""}
          </p>
        </div>
      </div>

      {job.videoUrl && (
        <div style={{ marginTop: 12 }}>
          <video src={job.videoUrl} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 280, aspectRatio: "9 / 16", borderRadius: 14, background: "var(--media)" }} />
        </div>
      )}
      {job.caption && job.status !== "QUEUED" && <p className="gm-text" style={{ marginTop: 12 }}>{job.caption}</p>}

      {job.status === "RENDERED" && (
        <div className="gm-stack" style={{ marginTop: 12 }}>
          {canFb || canIg ? (
            <div className="gm-row" style={{ flexWrap: "wrap" }}>
              {canFb && (
                <button type="button" className="gm-chip" aria-pressed={fb} onClick={() => setFb((x) => !x)}>
                  Facebook
                </button>
              )}
              {canIg && (
                <button type="button" className="gm-chip" aria-pressed={ig} onClick={() => setIg((x) => !x)}>
                  Instagram
                </button>
              )}
              <button type="button" className="gm-btn small" disabled={pending || !targets.length} onClick={post}>
                {v.publishNow}
              </button>
            </div>
          ) : (
            <p className="gm-hint">{v.noTargets}</p>
          )}
        </div>
      )}
      {job.videoUrl && (
        <p style={{ marginTop: 10 }}>
          <a className="gm-link" href={job.videoUrl} download target="_blank" rel="noreferrer">
            {v.download}
          </a>
        </p>
      )}
      {(err || job.error) && job.status !== "POSTED" && <p className="gm-err">{err ?? job.error}</p>}
    </div>
  );
}
