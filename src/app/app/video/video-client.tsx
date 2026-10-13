"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { useLang, useT } from "@/lib/i18n/client";
import { cityLabel } from "@/lib/orders/cities";
import { PAWAN_VOICES, VOICE_NAMES } from "@/lib/voice/voices";
import { SaveMessage, SwitchRow, useSaver } from "../automation/shared";
import { createVideoAction, publishVideoAction, refreshPlanAction, removeRefAction, saveMarketNotesAction, saveVideoAutoAction, type VideoResult } from "./actions";

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
  /** The plan this video was made for, and what came of it. */
  objective: string | null;
  why: string | null;
  look: string | null;
  comments: number | null;
  orders: number | null;
}

export interface RefView {
  pathname: string;
  url: string;
  kind: "image" | "video";
  name: string;
  size: number;
}

export interface PlanView {
  objective: string;
  why: string;
  format: string;
  priceMode: "engagement" | "conversion";
  cta: "whatsapp" | "dm" | "comment";
  urgent: boolean;
  product: string | null;
  boost: { worth: boolean; cities: string[]; note: string };
  source: "model" | "rules";
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
  workspaceId: string;
  /** Videos made today and the most one store makes in a day. */
  today: { used: number; max: number };
  /** How much of this month's AI allowance is used, 0 to 100. */
  aiPercent: number;
  refs: RefView[];
  refLimits: { images: number; videos: number; imageMb: number; videoMb: number };
  plan: PlanView | null;
  notes: string;
}

/** Statuses in which something is still going on: the page refreshes itself. */
const BUSY = ["QUEUED", "READY", "RENDERING", "POSTING"];

export function VideoClient({ storeId, stores, canFb, canIg, products, allowances, auto, jobs, configure, workspaceId, today, aiPercent, refs, refLimits, plan, notes }: Props) {
  const router = useRouter();
  const t = useT();
  const v = t.video;
  const ai = t.publish.ai;
  const lang = useLang();
  const uid = useId();
  // Start on a tier the plan has and that still has videos in it (a plan with Opus has no Haiku videos).
  const [tier, setTier] = useState<Tier>(
    (["LITE", "PRO"] as Tier[]).find((x) => allowances[x].left > 0) ?? (["LITE", "PRO"] as Tier[]).find((x) => allowances[x].limit > 0) ?? "LITE",
  );
  const [productId, setProductId] = useState("");
  const [topic, setTopic] = useState("");
  // Gituas reviews the idea against the brand first (the same switch as in the composer).
  const [review, setReview] = useState(true);
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
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [busy, router]);

  const left = allowances[tier];
  const targets = [...(fb && canFb ? ["FB"] : []), ...(ig && canIg ? ["IG"] : [])];

  function create() {
    setNote(null);
    start(async () => {
      const r = await createVideoAction(storeId, { tier, topic, productId: productId || null, voice, publish, targets, review });
      if (r.ok) {
        setNote({ ok: true, text: r.reviewed ? `${v.created} ${ai.reviewedNote(r.reviewed.summary)}` : v.created });
        setTopic("");
        router.refresh();
      } else {
        setNote({ ok: false, text: r.error });
      }
    });
  }

  // The free plan has no videos: say so and point at the plans, instead of a form that cannot be used.
  if (allowances.LITE.limit === 0 && allowances.PRO.limit === 0) {
    return (
      <div>
        <h2 className="gm-title kufi">{v.title}</h2>
        <p className="gm-sub">{v.sub}</p>
        <div className="gm-empty">
          <b className="kufi">{v.paidOnly}</b>
          <p style={{ marginTop: 12 }}>
            <Link href="/app/billing" className="gm-btn">
              {v.seePlans}
            </Link>
          </p>
        </div>
      </div>
    );
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

      <PlanCard storeId={storeId} plan={plan} notes={notes} />

      <p className="gm-sec">{v.makeSec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-field">
          <label>{v.tierLabel}</label>
          <div className="gm-seg" role="group" aria-label={v.tierLabel}>
            {allowances.LITE.limit > 0 && (
              <button type="button" aria-pressed={tier === "LITE"} onClick={() => setTier("LITE")}>
                {v.lite}
              </button>
            )}
            {allowances.PRO.limit > 0 && (
              <button type="button" aria-pressed={tier === "PRO"} onClick={() => setTier("PRO")}>
                {v.pro}
              </button>
            )}
          </div>
          <p className="gm-hint">
            {tier === "LITE" ? v.liteHint : v.proHint} · {left.limit > 0 ? v.left(left.left, left.limit) : v.noneLeft} · {v.dailyHint(today.used, today.max)}
          </p>
          <p className="gm-hint">{aiPercent >= 100 ? v.aiAllowanceDone : v.aiAllowance(aiPercent)}</p>
        </div>

        <div className="gm-field">
          <label htmlFor={`${uid}-product`}>{v.productLabel}</label>
          <select id={`${uid}-product`} className="gm-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{v.aiChooses}</option>
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
        <label className="gm-row" style={{ alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={review} disabled={pending} onChange={(e) => setReview(e.target.checked)} style={{ marginTop: 4 }} />
          <span>
            <b>{ai.reviewLabel}</b>
            <br />
            <span className="gm-hint">{ai.reviewHelp}</span>
          </span>
        </label>
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
          <button type="button" className="gm-btn" disabled={pending || left.left < 1 || today.used >= today.max || (publish && !targets.length)} onClick={create}>
            {v.create}
          </button>
          {note && <p className={note.ok ? "gm-ok" : "gm-err"}>{note.text}</p>}
        </div>
      </div>

      <RefsCard storeId={storeId} workspaceId={workspaceId} refs={refs} limits={refLimits} />

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

/** Today's plan: what kind of video matters now and why, boost advice, and the owner's notes about the market. */
function PlanCard({ storeId, plan, notes }: { storeId: string; plan: PlanView | null; notes: string }) {
  const router = useRouter();
  const v = useT().video;
  const lang = useLang();
  const [text, setText] = useState(notes);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<VideoResult>) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <>
      <p className="gm-sec">{v.planSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {v.planSub}
        </p>
        {plan ? (
          <>
            <div className="gm-chips">
              <span className="gm-badge">{v.objectives[plan.objective] ?? plan.objective}</span>
              {plan.urgent && <span className="gm-badge warn">{v.planUrgent}</span>}
              <span className="gm-badge ghost">{v.planBy[plan.source]}</span>
            </div>
            <p className="gm-text">{plan.why}</p>
            <p className="gm-hint">
              {v.planProduct}: {plan.product ?? v.planShop} · {v.planFormat}: {v.formats[plan.format] ?? plan.format.replace(/_/g, " ")}
            </p>
            <p className="gm-hint">
              {v.planPrice}: {v.priceModes[plan.priceMode]} · {v.planCta}: {v.ctas[plan.cta]}
            </p>
            <div>
              <b className="kufi">{v.boostSec}</b>
              <p className="gm-text" style={{ marginBottom: 4 }}>
                {plan.boost.worth ? v.boostYes : v.boostNo}
                {plan.boost.note ? ` ${plan.boost.note}` : ""}
              </p>
              {plan.boost.cities.length > 0 && (
                <p className="gm-hint" style={{ marginTop: 0 }}>
                  {v.boostCities}: {plan.boost.cities.map((c) => cityLabel(c, lang)).join("، ")}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="gm-hint">{v.planNone}</p>
        )}
        <div>
          <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => refreshPlanAction(storeId))}>
            {pending ? v.planThinking : plan ? v.planRemake : v.planMake}
          </button>
        </div>

        <div className="gm-field">
          <label>{v.notesSec}</label>
          <textarea className="gm-textarea" style={{ minHeight: 84 }} value={text} maxLength={800} placeholder={v.notesPlaceholder} onChange={(e) => setText(e.target.value)} />
          <p className="gm-hint">{v.notesHelp}</p>
        </div>
        <div>
          <button type="button" className="gm-btn small" disabled={pending || text.trim() === notes.trim()} onClick={() => run(() => saveMarketNotesAction(storeId, text))}>
            {v.notesSave}
          </button>
          {err && <p className="gm-err">{err}</p>}
        </div>
      </div>
    </>
  );
}

const MB = 1024 * 1024;
/** Some systems give a clip no type: the file's ending says what it is. */
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" };
const mimeOf = (f: File) => (f.type && f.type in MIME_BY_EXT_REVERSE ? f.type : MIME_BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? f.type);
const REF_TYPES: Record<string, { kind: "image" | "video"; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
};
const MIME_BY_EXT_REVERSE: Record<string, true> = Object.fromEntries(Object.keys(REF_TYPES).map((k) => [k, true]));

/** The owner's reference pictures and clips: the AI studies the pictures, the video shows both. */
function RefsCard({ storeId, workspaceId, refs, limits }: { storeId: string; workspaceId: string; refs: RefView[]; limits: Props["refLimits"] }) {
  const router = useRouter();
  const v = useT().video;
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  async function add(files: File[]) {
    setErr(null);
    setBusy(true);
    let nImages = images.length;
    let nVideos = videos.length;
    try {
      for (const file of files) {
        const mime = mimeOf(file);
        const type = REF_TYPES[mime];
        if (!type) {
          setErr(v.refBadType);
          continue;
        }
        const max = type.kind === "image" ? limits.imageMb : limits.videoMb;
        if (file.size > max * MB) {
          setErr(v.refTooBig(max));
          continue;
        }
        if (type.kind === "image" ? nImages >= limits.images : nVideos >= limits.videos) {
          setErr(v.refFull);
          continue;
        }
        try {
          await upload(`merchant/${workspaceId}/advideo-ref/${storeId}/${Date.now()}.${type.ext}`, file, {
            access: "public",
            handleUploadUrl: "/api/app/upload",
            contentType: mime,
            multipart: file.size > 20 * MB,
          });
          if (type.kind === "image") nImages++;
          else nVideos++;
        } catch {
          setErr(v.refFailed);
        }
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  function remove(pathname: string) {
    setErr(null);
    start(async () => {
      const r = await removeRefAction(storeId, pathname);
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <>
      <p className="gm-sec">{v.refSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {v.refSub}
        </p>
        {refs.length === 0 ? (
          <p className="gm-hint">{v.refEmpty}</p>
        ) : (
          <div className="gm-stack">
            {refs.map((r) => (
              <div key={r.pathname} className="gm-row">
                {r.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="gm-thumb" src={r.url} alt="" />
                ) : (
                  <video className="gm-thumb" src={r.url} muted playsInline preload="metadata" />
                )}
                <span className="gm-hint gm-ltr" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name} · {(r.size / MB).toFixed(1)} MB
                </span>
                <button type="button" className="gm-btn danger small" disabled={pending || busy} onClick={() => remove(r.pathname)}>
                  {v.refRemove}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {v.refCount(images.length, limits.images, videos.length, limits.videos)}
        </p>
        <div className="gm-row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="gm-btn quiet small" disabled={busy || images.length >= limits.images} onClick={() => imageInput.current?.click()}>
            {busy ? v.refUploading : v.refAddImage}
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void add(files);
            }}
          />
          <button type="button" className="gm-btn quiet small" disabled={busy || videos.length >= limits.videos} onClick={() => videoInput.current?.click()}>
            {busy ? v.refUploading : v.refAddVideo}
          </button>
          <input
            ref={videoInput}
            type="file"
            accept="video/mp4,video/quicktime"
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void add(files);
            }}
          />
        </div>
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {v.refRights}
        </p>
        {err && <p className="gm-err">{err}</p>}
      </div>
    </>
  );
}

function AutoCard({ storeId, auto, allowances, canPublish }: { storeId: string; auto: Props["auto"]; allowances: Props["allowances"]; canPublish: boolean }) {
  const v = useT().video;
  const { pending, message, run } = useSaver();
  const [mode, setMode] = useState(auto.mode);
  // The tier follows the plan: a plan with Opus videos has no Haiku ones, and the others the other way round.
  const [tier, setTier] = useState<Tier>(allowances[auto.tier].limit > 0 ? auto.tier : allowances.PRO.limit > 0 ? "PRO" : "LITE");
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
              <button type="button" aria-pressed={tier === "LITE"} disabled={allowances.LITE.limit === 0} onClick={() => setTier("LITE")}>
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
          {job.objective && (
            <p className="gm-hint" style={{ marginTop: 4 }}>
              {v.objectives[job.objective] ?? job.objective}
              {job.why ? ` — ${job.why}` : ""}
            </p>
          )}
          {job.look && (
            <p className="gm-hint gm-ltr" style={{ marginTop: 4 }}>
              {v.jobLook}: {job.look}
            </p>
          )}
          {job.comments !== null && job.orders !== null && (
            <p className="gm-hint" style={{ marginTop: 4 }}>
              {v.resultComments(job.comments)} · {v.resultOrders(job.orders)}
            </p>
          )}
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
