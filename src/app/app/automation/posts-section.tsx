"use client";

import { useState } from "react";

import { useT } from "@/lib/i18n/client";
import type { BuyerProfile } from "@/lib/orders/stats";
import { friendlyError } from "../format";
import { useAudienceText } from "../orders/orders-client";
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
  boostText,
}: {
  storeId: string;
  post: PostView;
  auto: PostAutoView | undefined;
  expiryDays: number;
  products: { id: string; name: string }[];
  templates: TemplateView[];
  boostText: string;
}) {
  const t = useT();
  const a = t.automation;
  const { pending, message, run } = useSaver();
  const [row, setRow] = useState<Row>({ enabled: auto?.enabled ?? true, productId: auto?.productId ?? null, templateId: auto?.templateId ?? null });

  const created = post.createdAt ? Date.parse(post.createdAt) : NaN;
  const until = auto?.activeUntil ?? (Number.isNaN(created) ? null : new Date(created + expiryDays * DAY).toISOString());
  // Switched off, or past its end date: nothing is sent for this post.
  const live = row.enabled && (until == null || Date.parse(until) > Date.now());
  const caption = Array.from(post.caption).slice(0, 60).join("");

  function change(patch: Partial<Row>) {
    const prev = row;
    setRow({ ...prev, ...patch });
    run(
      () => setPostAutomationAction(storeId, { platform: post.platform, postId: post.id, ...patch }),
      undefined,
      () => setRow(prev),
    );
  }

  return (
    <section className="gm-card" aria-label={t.comments.postAria(t.platform[post.platform])}>
      <div className="gm-post">
        {post.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbUrl} alt="" className="gm-thumb" loading="lazy" />
        ) : (
          <div className="gm-thumb" aria-hidden="true" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className={`gm-plat ${post.platform}`}>{t.platform[post.platform]}</span>
          {caption && <p>{caption}</p>}
          <small className="gm-time">
            {live ? (
              <>
                {a.activeUntil} {until && <span className="gm-ltr" style={{ display: "inline-block" }}>{until.slice(0, 10)}</span>}
              </>
            ) : (
              a.off
            )}
          </small>
        </div>
        <Knob checked={row.enabled} label={a.switchLabel} disabled={pending} onClick={() => change({ enabled: !row.enabled })} />
      </div>
      <div className="gm-row" style={{ gap: 8, marginTop: 10 }}>
        <select className="gm-input" aria-label={a.productAria} value={row.productId ?? ""} disabled={pending} onChange={(e) => change({ productId: e.target.value || null })}>
          <option value="">{a.noCard}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="gm-input" aria-label={a.templateAria} value={row.templateId ?? ""} disabled={pending} onChange={(e) => change({ templateId: e.target.value || null })}>
          <option value="">{a.defaultTemplate}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </div>
      {post.permalink && (
        <div className="gm-row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
          <button
            type="button"
            className="gm-btn small"
            title={a.boostHint}
            // Meta has no public link straight to a post's boost dialog; the post itself carries the Boost button.
            onClick={() => {
              void navigator.clipboard.writeText(boostText).catch(() => undefined);
              window.open(post.permalink!, "_blank", "noopener");
            }}
          >
            {a.boost}
          </button>
          <small className="gm-hint">{a.boostHint}</small>
        </div>
      )}
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
  audience,
}: {
  storeId: string;
  posts: PostView[];
  postErrors: { platform: "FB" | "IG"; message: string }[];
  postAutomations: Record<string, PostAutoView>;
  expiryDays: number;
  products: { id: string; name: string }[];
  templates: TemplateView[];
  audience: BuyerProfile;
}) {
  const t = useT();
  const { text: boostText } = useAudienceText(audience);
  return (
    <>
      <p className="gm-sec">{t.automation.postsSec}</p>
      {postErrors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 10 }}>
          {t.platform[e.platform]}: {friendlyError(e.message, t)}
        </p>
      ))}
      {posts.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">{t.automation.noPosts}</b>
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
              boostText={boostText}
            />
          ))}
        </div>
      )}
    </>
  );
}
