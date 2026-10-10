"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";

import { saveStoreSettingsAction } from "./actions";
import { PostsSection } from "./posts-section";
import { CommentsSection, DeliverySection } from "./settings-sections";
import { SaveMessage, SwitchRow, useSaver, type PostAutoView, type PostView, type StoreSettings, type StoreView, type TemplateView, type Usage } from "./shared";
import { TemplatesSection } from "./templates-section";

export interface AutomationProps {
  store: StoreView;
  stores: { id: string; name: string }[];
  templates: TemplateView[];
  products: { id: string; name: string }[];
  /** Keyed by `${FB|IG}:${externalPostId}`. */
  postAutomations: Record<string, PostAutoView>;
  posts: PostView[];
  postErrors: { platform: "FB" | "IG"; message: string }[];
  usage: Usage;
}

function Check({ done, label, hint, action }: { done: boolean; label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="gm-target">
      <div>
        <p>
          {done ? "✓" : "○"} {label}
        </p>
        {hint && !done && <small>{hint}</small>}
      </div>
      {action}
    </div>
  );
}

export function AutomationClient({ store, stores, templates, products, postAutomations, posts, postErrors, usage }: AutomationProps) {
  const router = useRouter();
  const t = useT();
  const a = t.automation;
  const status = useSaver();
  // The last saved settings, for display. A save sends only the fields its own control or section owns.
  const [settings, setSettings] = useState<StoreSettings>(() => ({
    automationEnabled: store.automationEnabled,
    expiryDays: store.expiryDays,
    stopBefore: store.stopBefore,
    likeComments: store.likeComments,
    autoHideSpam: store.autoHideSpam,
    deliveryFee: store.deliveryFee,
    deliveryTime: store.deliveryTime,
    defaultDm: store.defaultDm,
    cityFees: store.cityFees,
  }));

  async function save(patch: Partial<StoreSettings>) {
    const r = await saveStoreSettingsAction(store.id, patch);
    if (r.ok) setSettings((s) => ({ ...s, ...patch }));
    return r;
  }

  const on = settings.automationEnabled;
  const defaultTemplate = templates.find((t) => t.id === store.defaultTemplateId) ?? null;

  return (
    <div>
      <h2 className="gm-title kufi">{a.title}</h2>
      <p className="gm-sub">{a.sub}</p>

      {stores.length > 1 && (
        <select className="gm-input" aria-label={a.pageAria} style={{ marginBottom: 12 }} value={store.id} onChange={(e) => router.push(`/app/automation?store=${encodeURIComponent(e.target.value)}`)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <div className="gm-cols-2">
        <div>
          <p className="gm-sec">{a.statusSec}</p>
          <div className="gm-card">
            <SwitchRow
              label={a.switchLabel}
              hint={on ? a.switchOn : a.switchOff}
              checked={on}
              disabled={status.pending}
              onToggle={() => status.run(() => save({ automationEnabled: !on }))}
            />
            {store.pausedReason && <p className="gm-note warn" style={{ marginTop: 8 }}>{a.paused}</p>}
            <SaveMessage message={status.message} />
          </div>

          <p className="gm-sec">{a.usageSec}</p>
          <div className="gm-card">
            <div className="gm-target">
              <p>{a.activePosts}</p>
              <span className="gm-ltr">
                {t.fmt.num(usage.activePosts)} / {usage.postSlots == null ? a.allPosts : t.fmt.num(usage.postSlots)}
              </span>
            </div>
            <div className="gm-target">
              <p>{a.sentToday}</p>
              <span className="gm-ltr">
                {t.fmt.num(usage.sentToday)} / {t.fmt.num(usage.cap)}
              </span>
            </div>
            <div className="gm-target">
              <p>{a.aiVaried}</p>
              <span className="gm-ltr">
                {t.fmt.num(usage.aiUsed)} / {t.fmt.num(usage.aiLimit)}
              </span>
            </div>
            <small className="gm-hint" style={{ display: "block" }}>
              <Link href="/app/billing" className="gm-link">
                {a.plan(usage.plan)}
              </Link>
            </small>
          </div>
        </div>
        <div className="gm-section">
          <p className="gm-sec">{a.readySec}</p>
          <div className="gm-card">
            <Check done label={a.pageConnected} />
            <Check done={!!store.webhooksAt} label={a.webhooks} />
            <Check
              done={products.length > 0}
              label={a.oneProduct}
              action={
                <Link href={`/app/products?store=${encodeURIComponent(store.id)}`} className="gm-link">
                  {a.productsLink}
                </Link>
              }
            />
            <Check done={!!defaultTemplate && defaultTemplate.publicSamples.length > 0} label={a.sampleWritten} hint={a.sampleHint} />
            <p className="gm-hint">{a.igHint}</p>
          </div>
        </div>
      </div>

      <TemplatesSection storeId={store.id} templates={templates} defaultTemplateId={store.defaultTemplateId} />
      <div className="gm-cols-2">
        <div className="gm-section">
          <DeliverySection settings={settings} save={save} />
        </div>
        <div className="gm-section">
          <CommentsSection settings={settings} save={save} />
        </div>
      </div>
      <PostsSection
        storeId={store.id}
        posts={posts}
        postErrors={postErrors}
        postAutomations={postAutomations}
        expiryDays={settings.expiryDays}
        products={products}
        templates={templates}
      />
    </div>
  );
}
