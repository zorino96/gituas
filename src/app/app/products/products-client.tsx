"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { useLang, useT } from "@/lib/i18n/client";
import { exponentOf, formatMoney } from "@/lib/shop/money";
import { archiveProductAction, saveProductAction } from "../automation/actions";
import { SaveMessage, useSaver } from "../automation/shared";
import { imageToJpeg } from "../publish/to-jpeg";

export interface ProductView {
  id: string;
  name: string;
  description: string;
  photos: string[];
  variants: { label: string; amountMinor: number; currency: string; inStock: boolean }[];
}

interface VariantRow {
  key: number;
  label: string;
  price: string;
  currency: string;
  inStock: boolean;
}

const MAX_PHOTOS = 5;

/** A stored price back to what the merchant types: whole dinars, or dollars with cents only when there are some. */
export function priceText(amountMinor: number, currency: string): string {
  const exp = exponentOf(currency);
  const value = amountMinor / 10 ** exp;
  return Number.isInteger(value) ? String(value) : value.toFixed(exp);
}

function ProductEditor({
  workspaceId,
  storeId,
  product,
  onDone,
}: {
  workspaceId: string;
  storeId: string;
  product: ProductView | null;
  onDone: () => void;
}) {
  const uid = useId();
  const t = useT();
  const pr = t.products;
  const { pending, message, run } = useSaver();
  const nextKey = useRef(0);
  const newRow = (): VariantRow => ({ key: nextKey.current++, label: "", price: "", currency: "IQD", inStock: true });

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? []);
  const [rows, setRows] = useState<VariantRow[]>(() =>
    product?.variants.length
      ? product.variants.map((v) => ({ key: nextKey.current++, label: v.label, price: priceText(v.amountMinor, v.currency), currency: v.currency, inStock: v.inStock }))
      : [newRow()],
  );
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function addPhotos(files: File[]) {
    setPhotoError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPhotoError(pr.maxPhotos);
      return;
    }
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of files.slice(0, room)) {
        // Instagram and the shop cards want JPEG — convert anything else before it is uploaded.
        const upFile = file.type !== "image/jpeg" ? await imageToJpeg(file) : file;
        const blob = await upload(`merchant/${workspaceId}/product-${Date.now()}.jpg`, upFile, {
          access: "public",
          handleUploadUrl: "/api/app/upload",
          contentType: "image/jpeg",
        });
        added.push(blob.url);
        setPhotos((p) => [...p, blob.url]);
      }
      if (files.length > room) setPhotoError(pr.maxPhotos);
      else if (!added.length) setPhotoError(pr.noneUploaded);
    } catch (e) {
      setPhotoError(pr.uploadFailed(e instanceof Error ? e.message : t.common.error));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function patchRow(key: number, patch: Partial<VariantRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    run(
      () =>
        saveProductAction(storeId, product?.id ?? null, {
          name,
          description,
          photos,
          variants: rows.map((r) => ({ label: r.label, price: r.price, currency: r.currency, inStock: r.inStock })),
        }),
      onDone,
    );
  }

  return (
    <div className="gm-stack">
      <div className="gm-field">
        <label htmlFor={`${uid}-name`}>{pr.name}</label>
        <input id={`${uid}-name`} className="gm-input" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-desc`}>{pr.description}</label>
        <textarea id={`${uid}-desc`} className="gm-textarea" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="gm-field">
        <label htmlFor={`${uid}-photos`}>{pr.photos}</label>
        {photos.length > 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            {photos.map((url) => (
              <div key={url} className="gm-row" style={{ gap: 4 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="gm-thumb" />
                <button type="button" className="gm-btn quiet small" aria-label={pr.removePhoto} disabled={pending} onClick={() => setPhotos((p) => p.filter((u) => u !== url))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInput}
          id={`${uid}-photos`}
          type="file"
          accept="image/*"
          multiple
          className="gm-input"
          disabled={uploading || pending || photos.length >= MAX_PHOTOS}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addPhotos(files);
          }}
        />
        {uploading && <p className="gm-hint">{pr.uploading}</p>}
        {photoError && <p className="gm-err">{photoError}</p>}
      </div>

      <p className="gm-sec" style={{ margin: 0 }}>{pr.variantsSec}</p>
      {rows.map((r, i) => (
        <div key={r.key} className="gm-stack" style={{ borderTop: i ? "1px solid var(--line-soft)" : undefined, paddingTop: i ? 12 : 0 }}>
          <div className="gm-field">
            <label htmlFor={`${uid}-label-${r.key}`}>{pr.variantLabel}</label>
            <input id={`${uid}-label-${r.key}`} className="gm-input" value={r.label} maxLength={40} onChange={(e) => patchRow(r.key, { label: e.target.value })} />
          </div>
          <div className="gm-row" style={{ gap: 8, alignItems: "flex-end" }}>
            <div className="gm-field" style={{ flex: 1 }}>
              <label htmlFor={`${uid}-price-${r.key}`}>{pr.price}</label>
              <input id={`${uid}-price-${r.key}`} className="gm-input gm-ltr" inputMode="decimal" value={r.price} onChange={(e) => patchRow(r.key, { price: e.target.value })} />
            </div>
            <div className="gm-field">
              <label htmlFor={`${uid}-cur-${r.key}`}>{pr.currency}</label>
              <select id={`${uid}-cur-${r.key}`} className="gm-input" value={r.currency} onChange={(e) => patchRow(r.key, { currency: e.target.value })}>
                <option value="IQD">{pr.iqd}</option>
                <option value="USD">{pr.usd}</option>
              </select>
            </div>
          </div>
          <div className="gm-between">
            <label className="gm-radio">
              <input type="checkbox" checked={r.inStock} onChange={(e) => patchRow(r.key, { inStock: e.target.checked })} />
              {pr.inStock}
            </label>
            <button
              type="button"
              className="gm-btn quiet small"
              aria-label={pr.removeVariant}
              disabled={rows.length === 1 || pending}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="gm-btn quiet small" disabled={rows.length >= 20 || pending} onClick={() => setRows((rs) => [...rs, newRow()])}>
          {pr.addVariant}
        </button>
      </div>

      <div className="gm-row" style={{ gap: 8 }}>
        <button type="button" className="gm-btn" disabled={pending || uploading} onClick={save}>
          {pr.save}
        </button>
        <button type="button" className="gm-btn quiet" disabled={pending} onClick={onDone}>
          {pr.cancel}
        </button>
      </div>
      <SaveMessage message={message} />
    </div>
  );
}

export function ProductsClient({ workspaceId, storeId, stores, products }: { workspaceId: string; storeId: string; stores: { id: string; name: string }[]; products: ProductView[] }) {
  const router = useRouter();
  const lang = useLang();
  const t = useT();
  const pr = t.products;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, message, setMessage, run } = useSaver();

  function open(key: string | "new") {
    setMessage(null);
    setEditing(key);
  }

  return (
    <div>
      <h2 className="gm-title kufi">{pr.title}</h2>
      <p className="gm-sub">{pr.sub}</p>

      {stores.length > 1 && (
        <select className="gm-input" aria-label={t.automation.pageAria} style={{ marginBottom: 12 }} value={storeId} onChange={(e) => router.push(`/app/products?store=${encodeURIComponent(e.target.value)}`)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <div style={{ margin: "12px 0" }}>
        <button type="button" className="gm-btn" disabled={editing === "new"} onClick={() => open("new")}>
          {pr.newProduct}
        </button>
      </div>

      {editing === "new" && (
        <div className="gm-card" style={{ marginBottom: 12 }}>
          <ProductEditor workspaceId={workspaceId} storeId={storeId} product={null} onDone={() => setEditing(null)} />
        </div>
      )}

      <SaveMessage message={message} />

      {products.length === 0 && editing !== "new" ? (
        <div className="gm-empty">
          <b className="kufi">{pr.emptyTitle}</b>
          {pr.emptyBody}
        </div>
      ) : (
        products.map((p) => (
          <div key={p.id} className="gm-card" style={{ marginBottom: 12 }}>
            {editing === p.id ? (
              <ProductEditor workspaceId={workspaceId} storeId={storeId} product={p} onDone={() => setEditing(null)} />
            ) : (
              <div className="gm-stack">
                <div className="gm-row" style={{ gap: 12, alignItems: "flex-start" }}>
                  {p.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photos[0]} alt="" className="gm-thumb" />
                  )}
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{p.name}</p>
                    <div className="gm-chips" style={{ marginTop: 8 }}>
                      {p.variants.map((v, i) => (
                        <span key={i} className="gm-chip" style={{ cursor: "default" }}>
                          {v.label ? `${v.label}: ` : ""}
                          {formatMoney(v.amountMinor, v.currency, lang)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="gm-row" style={{ gap: 6 }}>
                  <button type="button" className="gm-btn small quiet" disabled={pending} onClick={() => open(p.id)}>
                    {pr.edit}
                  </button>
                  <button
                    type="button"
                    className="gm-btn small danger"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(pr.confirmDelete)) run(() => archiveProductAction(storeId, p.id));
                    }}
                  >
                    {pr.delete}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
