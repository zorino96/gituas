"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLang, useT } from "@/lib/i18n/client";
import type { BoostPost } from "@/lib/boost/posts";
import type { SavedAnalysis } from "@/lib/boost/cache";
import type { BuyerProfile } from "@/lib/orders/stats";
import { AdviceCard } from "../advice-card";
import { kuDateTime } from "../format";
import { analyzePostAction, moveInstagramAction } from "./actions";
import { AudienceCard, BoostCard, type BoostView } from "./boost-cards";

const key = (p: BoostPost) => `${p.platform}:${p.id}`;

export function BoostClient({
  business,
  igElsewhere,
  audience,
  boost,
  posts,
  errors,
  saved,
  left: initialLeft,
  accounts,
}: {
  /** The business (store) being shown, when the workspace has several. */
  business: string | null;
  /** The connected Instagram account belongs to another business: say where, instead of mixing it in. */
  igElsewhere: { account: string; business: string; moveTo: { storeId: string; igUserId: string; business: string } | null } | null;
  audience: BuyerProfile;
  boost: BoostView;
  posts: BoostPost[];
  errors: { platform: "FB" | "IG"; message: string }[];
  saved: Record<string, SavedAnalysis>;
  left: number;
  accounts: { fb?: string; ig?: string };
}) {
  const t = useT();
  const b = t.boost;
  const [analyses, setAnalyses] = useState(saved);
  const [left, setLeft] = useState(initialLeft);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<{ key: string; text: string } | null>(null);

  async function analyse(p: BoostPost, force: boolean) {
    setBusy(key(p));
    setErrorFor(null);
    try {
      const r = await analyzePostAction({ platform: p.platform, postId: p.id, fb: accounts.fb, ig: accounts.ig, force });
      if (!r.ok) return setErrorFor({ key: key(p), text: r.error });
      setAnalyses((a) => ({ ...a, [r.key]: r.analysis }));
      setLeft(r.left);
    } catch {
      setErrorFor({ key: key(p), text: b.failed });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="gm-title kufi">{b.title}</h2>
      <p className="gm-sub">{b.sub}</p>
      {business && <p className="gm-hint" style={{ fontWeight: 600 }}>{b.business(business)}</p>}
      {igElsewhere && <IgElsewhere x={igElsewhere} />}

      <p className="gm-sec">{b.shopSec}</p>
      <AudienceCard a={audience} />
      <BoostCard b={boost} />

      <p className="gm-sec">{b.postsSec}</p>
      <p className="gm-hint">{b.postsHint}</p>
      <p className="gm-hint" style={{ fontWeight: 600 }}>{b.left(left)}</p>
      {errors.map((e) => (
        <p key={e.platform} className="gm-note warn">{t.platform[e.platform]}: {e.message}</p>
      ))}
      {posts.length === 0 && errors.length === 0 && <p className="gm-note">{b.none}</p>}

      <div className="gm-stack">
        {posts.map((p) => (
          <PostRow
            key={key(p)}
            p={p}
            analysis={analyses[key(p)] ?? null}
            busy={busy === key(p)}
            disabled={busy !== null}
            error={errorFor?.key === key(p) ? errorFor.text : null}
            onAnalyse={(force) => analyse(p, force)}
          />
        ))}
      </div>
    </div>
  );
}

function PostRow({
  p,
  analysis,
  busy,
  disabled,
  error,
  onAnalyse,
}: {
  p: BoostPost;
  analysis: SavedAnalysis | null;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onAnalyse: (force: boolean) => void;
}) {
  const t = useT();
  const b = t.boost;
  const lang = useLang();
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString(lang === "en" ? "en-US" : "ar-IQ"));
  return (
    <div className="gm-card">
      <div className="gm-row" style={{ gap: 12, alignItems: "flex-start" }}>
        {p.thumbUrl ? (
          // Meta's own CDN; small and lazy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumbUrl} alt="" loading="lazy" width={88} height={88} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 88, height: 88, borderRadius: 10, background: "var(--gm-soft, #eee)", flexShrink: 0 }} aria-hidden="true" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <small className="gm-hint">
            {t.platform[p.platform]} · {p.account}
            {p.mediaType === "VIDEO" ? " · 🎬" : ""}
            {p.createdAt ? ` · ${kuDateTime(p.createdAt, t)}` : ""}
          </small>
          <p dir="auto" style={{ margin: "4px 0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.caption || "—"}</p>
          <div className="gm-chips" style={{ gap: 6 }}>
            <span className="gm-chip" style={{ cursor: "default" }}>❤ {b.likes} {n(p.likes)}</span>
            <span className="gm-chip" style={{ cursor: "default" }}>💬 {b.comments} {n(p.comments)}</span>
            <span className="gm-chip" style={{ cursor: "default" }}>✉ {b.messages} {n(p.messages)}</span>
            <span className="gm-chip" style={{ cursor: "default" }}>🛒 {b.orders} {n(p.orders)}</span>
          </div>
          <small className="gm-hint" dir="auto">{p.productName ? `${b.product}: ${p.productName}` : b.noProduct}</small>
        </div>
      </div>
      <div className="gm-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" className="gm-btn small" disabled={disabled} onClick={() => onAnalyse(!!analysis)}>
          {busy ? b.working : analysis ? b.again : b.analyse}
        </button>
        {p.permalink && (
          <a className="gm-btn quiet small" href={p.permalink} target="_blank" rel="noreferrer">{b.open}</a>
        )}
        {analysis && <small className="gm-hint">{b.analysedAt}: {kuDateTime(analysis.at, t)}</small>}
      </div>
      {error && <p className="gm-err" role="alert">{error}</p>}
      {analysis && <AdviceCard a={analysis.advice} />}
    </div>
  );
}

/** The Instagram account belongs to another business: say which, and offer to move it here. */
function IgElsewhere({ x }: { x: { account: string; business: string; moveTo: { storeId: string; igUserId: string; business: string } | null } }) {
  const b = useT().boost;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = () =>
    start(async () => {
      setError(null);
      const r = await moveInstagramAction({ storeId: x.moveTo!.storeId, igUserId: x.moveTo!.igUserId });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  return (
    <div className="gm-note" style={{ marginBottom: 10 }}>
      <p style={{ margin: 0 }}>{b.igElsewhere(x.account, x.business)}</p>
      {x.moveTo && (
        <button type="button" className="gm-btn small" style={{ marginTop: 8 }} disabled={pending} onClick={move}>
          {pending ? "…" : b.moveHere(x.account, x.moveTo.business)}
        </button>
      )}
      {error && <p className="gm-err" role="alert">{error}</p>}
    </div>
  );
}
