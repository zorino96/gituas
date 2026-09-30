"use client";

import { useState } from "react";

import { PLATFORM_NAME, friendlyError } from "../format";
import { setPostAutomationAction } from "./actions";
import { Knob, SaveMessage, useSaver, type PostAutoView, type PostView, type TemplateView } from "./shared";

const DAY = 86_400_000;

type Row = Pick<PostAutoView, "enabled" | "productId" | "templateId">;

function PostRow({
  storeId,
  post,
  auto,
  expiryDays,
  products,
  templates,
}: {
  storeId: string;
  post: PostView;
  auto: PostAutoView | undefined;
  expiryDays: number;
  products: { id: string; name: string }[];
  templates: TemplateView[];
}) {
  const { pending, message, run } = useSaver();
  const [row, setRow] = useState<Row>({ enabled: auto?.enabled ?? true, productId: auto?.productId ?? null, templateId: auto?.templateId ?? null });

  const created = post.createdAt ? Date.parse(post.createdAt) : NaN;
  const until = auto?.activeUntil ?? (Number.isNaN(created) ? null : new Date(created + expiryDays * DAY).toISOString());
  const caption = Array.from(post.caption).slice(0, 60).join("");

  function change(patch: Partial<Row>) {
    const prev = row;
    setRow({ ...prev, ...patch });
    run(
      () => setPostAutomationAction(storeId, { platform: post.platform, postId: post.id, postCreatedAt: post.createdAt, ...patch }),
      undefined,
      () => setRow(prev),
    );
  }

  return (
    <section className="gm-card" aria-label={`پۆستی ${PLATFORM_NAME[post.platform]}`}>
      <div className="gm-post">
        {post.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbUrl} alt="" className="gm-thumb" loading="lazy" />
        ) : (
          <div className="gm-thumb" aria-hidden="true" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className={`gm-plat ${post.platform}`}>{PLATFORM_NAME[post.platform]}</span>
          {caption && <p>{caption}</p>}
          <small className="gm-time">
            {row.enabled ? (
              <>
                چالاکە تا {until && <span className="gm-ltr" style={{ display: "inline-block" }}>{until.slice(0, 10)}</span>}
              </>
            ) : (
              "کوژاوەتەوە"
            )}
          </small>
        </div>
        <Knob checked={row.enabled} label="ئۆتۆمەیشن" disabled={pending} onClick={() => change({ enabled: !row.enabled })} />
      </div>
      <div className="gm-row" style={{ gap: 8, marginTop: 10 }}>
        <select className="gm-input" aria-label="بەرهەم" value={row.productId ?? ""} disabled={pending} onChange={(e) => change({ productId: e.target.value || null })}>
          <option value="">بێ کارتی بەرهەم</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="gm-input" aria-label="تێمپلەیت" value={row.templateId ?? ""} disabled={pending} onChange={(e) => change({ templateId: e.target.value || null })}>
          <option value="">بنەڕەت</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <SaveMessage message={message} />
    </section>
  );
}

/** Section "پۆستەکان": per-post switch, product and template. */
export function PostsSection({
  storeId,
  posts,
  postErrors,
  postAutomations,
  expiryDays,
  products,
  templates,
}: {
  storeId: string;
  posts: PostView[];
  postErrors: { platform: "FB" | "IG"; message: string }[];
  postAutomations: Record<string, PostAutoView>;
  expiryDays: number;
  products: { id: string; name: string }[];
  templates: TemplateView[];
}) {
  return (
    <>
      <p className="gm-sec">پۆستەکان</p>
      {postErrors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 10 }}>
          {PLATFORM_NAME[e.platform]}: {friendlyError(e.message)}
        </p>
      ))}
      {posts.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">هیچ پۆستێک نەدۆزرایەوە</b>
        </div>
      ) : (
        <div className="gm-stack">
          {posts.map((p) => (
            <PostRow
              key={`${p.platform}:${p.id}`}
              storeId={storeId}
              post={p}
              auto={postAutomations[`${p.platform}:${p.id}`]}
              expiryDays={expiryDays}
              products={products}
              templates={templates}
            />
          ))}
        </div>
      )}
    </>
  );
}
