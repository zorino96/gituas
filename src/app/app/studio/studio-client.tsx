"use client";

import { useEffect, useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { useLang, useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/shop/money";
import { HEADLINE_MAX, PRESET_ASPECT, STUDIO_ASPECTS, STUDIO_PRESETS, type StudioAspect, type StudioPreset } from "@/lib/studio/presets";
import { useBase } from "../use-base";
import {
  createStudioImageAction,
  deleteStudioAssetAction,
  startStudioTopUpAction,
  saveStudioBrandAction,
  suggestStudioHeadlineAction,
  updateStudioTextAction,
} from "./actions";

export interface StudioProduct {
  id: string;
  name: string;
  photos: string[];
}

export interface StudioAssetView {
  id: string;
  status: "QUEUED" | "RUNNING" | "RENDERING" | "DONE" | "FAILED" | "BLOCKED";
  aspect: string;
  image: string;
  finished: boolean;
  headline: string;
  showPrice: boolean;
  drawFailed: boolean;
}

interface BrandView {
  logoPath: string | null;
  primary: string;
  accent: string;
  headingFont: "kufi" | "sans";
  tagline: string;
  deliveryNote: string;
}

const PENDING = new Set(["QUEUED", "RUNNING", "RENDERING"]);
const SIZE_KEY: Record<StudioAspect, "square" | "portrait" | "story"> = { "1:1": "square", "4:5": "portrait", "9:16": "story" };
const RATIO: Record<string, string> = { "1:1": "1 / 1", "4:5": "4 / 5", "9:16": "9 / 16" };

export function StudioClient(p: {
  workspaceId: string;
  ready: boolean;
  canConfigure: boolean;
  balance: number;
  price: number;
  packs: { id: string; amount: number }[];
  paid: "paid" | "paid_test" | "pending" | null;
  products: StudioProduct[];
  brand: BrandView;
  assets: StudioAssetView[];
}) {
  const t = useT().studio;
  const router = useRouter();

  // While a picture is being made, the page refreshes itself every few seconds.
  const waiting = p.assets.some((a) => PENDING.has(a.status));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  return (
    <div className="gm-stack">
      <p className="gm-sub" style={{ marginTop: 0 }}>{t.intro}</p>
      {!p.ready && <p className="gm-note warn">{t.notReady}</p>}
      <WalletPanel ready={p.ready} balance={p.balance} price={p.price} packs={p.packs} paid={p.paid} />
      {p.canConfigure && <BrandPanel workspaceId={p.workspaceId} brand={p.brand} />}
      <MakePanel ready={p.ready} balance={p.balance} price={p.price} products={p.products} />
      <Gallery assets={p.assets} />
    </div>
  );
}

/** The prepaid balance: pictures are paid from it, and it is topped up through Wayl. */
function WalletPanel({ ready, balance, price, packs, paid }: { ready: boolean; balance: number; price: number; packs: { id: string; amount: number }[]; paid: "paid" | "paid_test" | "pending" | null }) {
  const s = useT().studio;
  const lang = useLang();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const iqd = (n: number) => formatMoney(n, "IQD", lang);

  function topUp(pack: string) {
    setError(null);
    start(async () => {
      const r = await startStudioTopUpAction(pack);
      if (r.ok) window.location.assign(r.url);
      else setError(r.error);
    });
  }

  return (
    <div className="gm-card">
      <p className="gm-sec" style={{ marginTop: 0 }}>{s.walletSec}</p>
      {paid === "paid" && <p className="gm-ok" role="status">{s.topUpDone}</p>}
      {paid === "paid_test" && <p className="gm-note">{s.topUpTest}</p>}
      {paid === "pending" && <p className="gm-note">{s.topUpPending}</p>}
      <p style={{ margin: "4px 0", fontSize: 22, fontWeight: 700 }}>{iqd(balance)}</p>
      <p className="gm-hint" style={{ marginTop: 0 }}>{s.pricePer(iqd(price), Math.floor(balance / Math.max(1, price)))}</p>
      <p className="gm-sub" style={{ margin: "10px 0 6px", fontWeight: 600 }}>{s.topUp}</p>
      <div className="gm-chips" role="group" aria-label={s.topUp}>
        {packs.map((p) => (
          <button key={p.id} type="button" className="gm-chip" disabled={!ready || pending} onClick={() => topUp(p.id)}>
            {iqd(p.amount)}
          </button>
        ))}
      </div>
      <p className="gm-hint">{s.topUpHint}</p>
      {error && <p className="gm-err" role="alert">{error}</p>}
    </div>
  );
}

function BrandPanel({ workspaceId, brand }: { workspaceId: string; brand: BrandView }) {
  const t = useT();
  const s = t.studio;
  const uid = useId();
  const router = useRouter();
  const [form, setForm] = useState(brand);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const blob = await upload(`merchant/${workspaceId}/logo-${Date.now()}.${ext}`, file, { access: "public", handleUploadUrl: "/api/app/upload", contentType: file.type });
      setForm((f) => ({ ...f, logoPath: blob.pathname }));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t.common.error });
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveStudioBrandAction(form);
      setMsg(r.ok ? { ok: true, text: s.saved } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <details className="gm-card" open={!brand.logoPath}>
      <summary className="gm-sec" style={{ cursor: "pointer", margin: 0 }}>{s.brandSec}</summary>
      <p className="gm-hint">{s.brandIntro}</p>
      <div className="gm-field">
        <label htmlFor={`${uid}-logo`}>{s.logo}</label>
        <div className="gm-row" style={{ gap: 12, alignItems: "center" }}>
          {form.logoPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/m/${form.logoPath}`} alt="" style={{ height: 48, width: "auto", maxWidth: 160, objectFit: "contain", background: form.primary, borderRadius: 8, padding: 4 }} />
          )}
          <input id={`${uid}-logo`} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(e) => pickLogo(e.target.files?.[0])} />
        </div>
        <small className="gm-hint">{s.logoHint}</small>
      </div>
      <div className="gm-row" style={{ gap: 16, flexWrap: "wrap" }}>
        <div className="gm-field">
          <label htmlFor={`${uid}-primary`}>{s.primary}</label>
          <input id={`${uid}-primary`} type="color" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} />
        </div>
        <div className="gm-field">
          <label htmlFor={`${uid}-accent`}>{s.accent}</label>
          <input id={`${uid}-accent`} type="color" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} />
        </div>
        <div role="radiogroup" aria-label={s.font}>
          <p className="gm-sub" style={{ margin: "4px 0 0", fontWeight: 600 }}>{s.font}</p>
          {(["kufi", "sans"] as const).map((f) => (
            <label key={f} className="gm-radio">
              <input type="radio" name={`${uid}-font`} checked={form.headingFont === f} onChange={() => setForm({ ...form, headingFont: f })} />
              <span>{f === "kufi" ? s.fontKufi : s.fontSans}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-tagline`}>{s.tagline}</label>
        <input id={`${uid}-tagline`} className="gm-input" dir="auto" maxLength={60} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
        <small className="gm-hint">{s.taglineHint}</small>
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-delivery`}>{s.deliveryNote}</label>
        <input id={`${uid}-delivery`} className="gm-input" dir="auto" maxLength={80} value={form.deliveryNote} onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })} />
        <small className="gm-hint">{s.deliveryHint} · {s.whatsappFrom}</small>
      </div>
      <div className="gm-row" style={{ gap: 12, alignItems: "center" }}>
        <button type="button" className="gm-btn" disabled={pending || uploading} onClick={save}>{s.saveBrand}</button>
        {msg && <span className={msg.ok ? "gm-ok" : "gm-err"} role="status">{msg.text}</span>}
      </div>
    </details>
  );
}

function MakePanel({ ready, balance, price, products }: { ready: boolean; balance: number; price: number; products: StudioProduct[] }) {
  const s = useT().studio;
  const lang = useLang();
  const uid = useId();
  const router = useRouter();
  const base = useBase();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((x) => x.id === productId);
  const [photo, setPhoto] = useState(product?.photos[0] ?? "");
  const [preset, setPreset] = useState<StudioPreset>("studio");
  const [aspect, setAspect] = useState<StudioAspect | null>(null);
  const [headline, setHeadline] = useState("");
  const [showPrice, setShowPrice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const size = aspect ?? PRESET_ASPECT[preset];

  if (!products.length) {
    return (
      <div className="gm-card">
        <p className="gm-sec" style={{ marginTop: 0 }}>{s.makeSec}</p>
        <p className="gm-note">{s.noProducts}</p>
        <Link href={`${base}/products`} className="gm-btn">{s.addProduct}</Link>
      </div>
    );
  }

  function chooseProduct(id: string) {
    setProductId(id);
    setPhoto(products.find((x) => x.id === id)?.photos[0] ?? "");
  }

  function suggest() {
    setError(null);
    startSuggest(async () => {
      const r = await suggestStudioHeadlineAction(productId, preset);
      if (r.ok) setHeadline(r.headline);
      else setError(r.error);
    });
  }

  function generate() {
    setError(null);
    start(async () => {
      const r = await createStudioImageAction({ productId, photoUrl: photo, preset, aspect: size, headline, showPrice });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="gm-card">
      <p className="gm-sec" style={{ marginTop: 0 }}>{s.makeSec}</p>

      <div className="gm-field">
        <label htmlFor={`${uid}-product`}>{s.product}</label>
        <select id={`${uid}-product`} className="gm-input" value={productId} onChange={(e) => chooseProduct(e.target.value)}>
          {products.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>

      {product && product.photos.length > 1 && (
        <div role="radiogroup" aria-label={s.photo}>
          <p className="gm-sub" style={{ margin: "4px 0 6px", fontWeight: 600 }}>{s.photo}</p>
          <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {product.photos.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={photo === u}
                onClick={() => setPhoto(u)}
                style={{ padding: 0, border: photo === u ? "3px solid var(--gm-accent, #E0A526)" : "3px solid transparent", borderRadius: 10, background: "none", cursor: "pointer" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="gm-sub" style={{ margin: "12px 0 6px", fontWeight: 600 }}>{s.scene}</p>
      <div className="gm-chips" role="group" aria-label={s.scene}>
        {STUDIO_PRESETS.map((x) => (
          <button key={x} type="button" className="gm-chip" aria-pressed={preset === x} onClick={() => setPreset(x)}>
            {s.scenes[x]}
          </button>
        ))}
      </div>

      <p className="gm-sub" style={{ margin: "12px 0 6px", fontWeight: 600 }}>{s.size}</p>
      <div role="radiogroup" aria-label={s.size}>
        {STUDIO_ASPECTS.map((x) => (
          <label key={x} className="gm-radio">
            <input type="radio" name={`${uid}-size`} checked={size === x} onChange={() => setAspect(x)} />
            <span>{s.sizes[SIZE_KEY[x]]}</span>
          </label>
        ))}
      </div>

      <div className="gm-field" style={{ marginTop: 12 }}>
        <label htmlFor={`${uid}-headline`}>{s.headline}</label>
        <div className="gm-row" style={{ gap: 8 }}>
          <input id={`${uid}-headline`} className="gm-input" dir="auto" maxLength={HEADLINE_MAX} value={headline} onChange={(e) => setHeadline(e.target.value)} />
          <button type="button" className="gm-btn quiet small" disabled={suggesting || !productId} onClick={suggest}>
            {suggesting ? s.suggesting : s.suggest}
          </button>
        </div>
        <small className="gm-hint">{s.headlineHint} {Array.from(headline).length} / {HEADLINE_MAX}</small>
      </div>

      <label className="gm-radio">
        <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
        <span>{s.showPrice}</span>
      </label>

      <p className="gm-hint">{s.aiNote}</p>
      {error && <p className="gm-err" role="alert">{error}</p>}
      <div className="gm-row" style={{ gap: 12, alignItems: "center" }}>
        <button type="button" className="gm-btn" disabled={!ready || pending || !photo || balance < price} onClick={generate}>
          {pending ? s.generating : s.generate(formatMoney(price, "IQD", lang))}
        </button>
        {balance < price && <span className="gm-time">{s.topUpFirst}</span>}
      </div>
    </div>
  );
}

function Gallery({ assets }: { assets: StudioAssetView[] }) {
  const s = useT().studio;
  return (
    <div>
      <p className="gm-sec">{s.gallerySec}</p>
      {!assets.length ? (
        <p className="gm-empty">{s.empty}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
          {assets.map((a) => (
            <AssetCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetCard({ a }: { a: StudioAssetView }) {
  const t = useT();
  const s = t.studio;
  const router = useRouter();
  const base = useBase();
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(a.headline);
  const [showPrice, setShowPrice] = useState(a.showPrice);
  const [error, setError] = useState<string | null>(a.drawFailed ? s.drawFailed : null);
  const [pending, start] = useTransition();
  const busy = PENDING.has(a.status);

  function apply() {
    setError(null);
    start(async () => {
      const r = await updateStudioTextAction(a.id, headline, showPrice);
      if (!r.ok) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!window.confirm(s.removeConfirm)) return;
    start(async () => {
      const r = await deleteStudioAssetAction(a.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="gm-card" style={{ padding: 10 }}>
      <div style={{ position: "relative", aspectRatio: RATIO[a.aspect] ?? "4 / 5", borderRadius: 10, overflow: "hidden", background: "#0002" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: busy ? 0.45 : 1, filter: busy ? "blur(2px)" : undefined }} />
        {busy && <span className="gm-pending" role="status" aria-label={s.status[a.status]} style={{ position: "absolute", inset: 0, margin: "auto" }} />}
      </div>
      <p className="gm-time" style={{ margin: "8px 0" }}>{s.status[a.status]}</p>
      {error && <p className="gm-err" role="alert" style={{ marginTop: 0 }}>{error}</p>}

      {a.status === "DONE" && editing && (
        <div className="gm-stack" style={{ gap: 6 }}>
          <input className="gm-input" dir="auto" maxLength={HEADLINE_MAX} value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label={s.headline} />
          <label className="gm-radio">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
            <span>{s.showPrice}</span>
          </label>
          <button type="button" className="gm-btn small" disabled={pending} onClick={apply}>{s.saveText}</button>
        </div>
      )}

      {a.status === "DONE" && !editing && (
        <div className="gm-row" style={{ gap: 6, flexWrap: "wrap" }}>
          {a.finished && (
            <Link href={`${base}/publish?studio=${a.id}`} className="gm-btn small">{s.publish}</Link>
          )}
          {a.finished && (
            <a href={a.image} download className="gm-btn quiet small" target="_blank" rel="noreferrer">{s.download}</a>
          )}
          <button type="button" className="gm-btn quiet small" onClick={() => setEditing(true)}>{s.editText}</button>
          <button type="button" className="gm-btn quiet small danger" disabled={pending} onClick={remove}>{s.remove}</button>
        </div>
      )}
      {(a.status === "FAILED" || a.status === "BLOCKED") && (
        <button type="button" className="gm-btn quiet small danger" disabled={pending} onClick={remove}>{s.remove}</button>
      )}
    </div>
  );
}
