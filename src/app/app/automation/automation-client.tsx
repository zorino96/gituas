"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { num } from "../format";
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
  const status = useSaver();
  // The last saved settings. Every control that saves sends all of them, because the action replaces them all.
  const [settings, setSettings] = useState<StoreSettings>(() => ({
    automationEnabled: store.automationEnabled,
    expiryDays: store.expiryDays,
    stopBefore: store.stopBefore,
    likeComments: store.likeComments,
    autoHideSpam: store.autoHideSpam,
    deliveryFee: store.deliveryFee,
    deliveryTime: store.deliveryTime,
    defaultDm: store.defaultDm,
  }));

  async function save(patch: Partial<StoreSettings>) {
    const r = await saveStoreSettingsAction(store.id, { ...settings, ...patch });
    if (r.ok) setSettings((s) => ({ ...s, ...patch }));
    return r;
  }

  const on = settings.automationEnabled;
  const defaultTemplate = templates.find((t) => t.id === store.defaultTemplateId) ?? null;

  return (
    <div>
      <h2 className="gm-title kufi">ئۆتۆمەیشن</h2>
      <p className="gm-sub">وەڵامدانەوەی خۆکار بۆ کۆمێنت و نامە</p>

      {stores.length > 1 && (
        <select className="gm-input" aria-label="پەیج" style={{ marginBottom: 12 }} value={store.id} onChange={(e) => router.push(`/app/automation?store=${encodeURIComponent(e.target.value)}`)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <p className="gm-sec">دۆخ</p>
      <div className="gm-card">
        <SwitchRow
          label="ئۆتۆمەیشن"
          hint={on ? "چالاکە — وەڵام دەدرێتەوە" : "کوژاوەتەوە — هیچ شتێک نانێردرێت"}
          checked={on}
          disabled={status.pending}
          onToggle={() => status.run(() => save({ automationEnabled: !on }))}
        />
        {store.pausedReason && <p className="gm-note warn" style={{ marginTop: 8 }}>پەیجەکەت دووبارە پەیوەست بکەرەوە — تۆکنەکەی بەسەرچووە.</p>}
        <SaveMessage message={status.message} />
      </div>

      <p className="gm-sec">بەکارهێنان</p>
      <div className="gm-card">
        <div className="gm-target">
          <p>پۆستی چالاک</p>
          <span className="gm-ltr">
            {num(usage.activePosts)} / {usage.postSlots == null ? "هەموو" : num(usage.postSlots)}
          </span>
        </div>
        <div className="gm-target">
          <p>وەڵامی ئەمڕۆ</p>
          <span className="gm-ltr">
            {num(usage.sentToday)} / {num(usage.cap)}
          </span>
        </div>
        <div className="gm-target">
          <p>گۆڕینی AI ئەم مانگە</p>
          <span className="gm-ltr">
            {num(usage.aiUsed)} / {num(usage.aiLimit)}
          </span>
        </div>
        <small className="gm-hint" style={{ display: "block" }}>
          پلان: {usage.plan}
        </small>
      </div>

      <p className="gm-sec">ئامادەکاری</p>
      <div className="gm-card">
        <Check done label="پەیج پەیوەستە" />
        <Check done={!!store.webhooksAt} label="ئاگادارکردنەوەکانی Meta تۆمار کراون" />
        <Check
          done={products.length > 0}
          label="لانیکەم یەک بەرهەم"
          action={
            <Link href="/app/products" className="gm-link">
              بەرهەمەکان
            </Link>
          }
        />
        <Check done={!!defaultTemplate && defaultTemplate.publicSamples.length > 0} label="نموونەی وەڵام نووسراوە" hint="ئەگەر ننووسیت، نموونەی ئامادە بەکاردێت" />
        <p className="gm-hint">ئینستاگرام: Settings ← Messages and story replies ← Connected tools ← Allow access to messages چالاک بکە، ئەگینا نامە ناگات.</p>
      </div>

      <TemplatesSection storeId={store.id} templates={templates} defaultTemplateId={store.defaultTemplateId} />
      <DeliverySection settings={settings} save={save} />
      <CommentsSection settings={settings} save={save} />
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
