import Link from "next/link";

import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { cityFees } from "@/lib/shop/compose";
import { loadShopState } from "@/lib/shop/state";
import { currentWorkspace, loadConnections, loadPosts } from "../data";
import { AutomationClient } from "./automation-client";
import type { PostAutoView, PostView } from "./shared";

export const dynamic = "force-dynamic";

const iso = (raw: string | undefined) => {
  const t = raw ? new Date(raw) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
};

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ws = (await currentWorkspace())!;
  const t = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const sp = await searchParams;
  const conns = await loadConnections(ws.id);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const state = await loadShopState(ws.id, sp.store, connectedIds);
  if (!state.store) {
    return (
      <div className="gm-empty">
        <b className="kufi">{t.automation.noPageTitle}</b>
        {t.automation.noPageBody}{" "}
        <Link href="/app/settings" className="gm-link">
          {t.automation.settingsLink}
        </Link>
      </div>
    );
  }

  const { store } = state;
  const { posts: fetched, errors } = await loadPosts(ws.id, conns, 8);
  // Only this store's posts: a Facebook post id starts with its Page id; Instagram posts belong to the connected account.
  const posts = fetched.filter((p) =>
    p.platform === "FB"
      ? !!store.fbPageId && p.id.startsWith(`${store.fbPageId}_`)
      : !!store.igUserId && conns.META_INSTAGRAM.accountId === store.igUserId,
  );

  const postAutomations: Record<string, PostAutoView> = {};
  for (const a of state.posts) {
    postAutomations[`${a.platform === "META_INSTAGRAM" ? "IG" : "FB"}:${a.externalPostId}`] = {
      enabled: a.enabled,
      productId: a.productId,
      templateId: a.templateId,
      activeUntil: a.activeUntil.toISOString(),
    };
  }
  const recent: PostView[] = posts.map((p) => ({ platform: p.platform, id: p.id, caption: p.caption, thumbUrl: p.thumbUrl ?? null, createdAt: iso(p.createdAt) }));

  return (
    <AutomationClient
      key={store.id}
      store={{
        id: store.id,
        automationEnabled: store.automationEnabled,
        expiryDays: store.expiryDays,
        stopBefore: store.stopBefore ? new Date(store.stopBefore.getTime() + 3 * 3_600_000).toISOString().slice(0, 10) : "",
        likeComments: store.likeComments,
        autoHideSpam: store.autoHideSpam,
        deliveryFee: store.deliveryFeeMinor == null ? "" : String(store.deliveryFeeMinor),
        deliveryTime: store.deliveryTime ?? "",
        cityFees: Object.fromEntries(Object.entries(cityFees(store)).map(([k, v]) => [k, String(v)])),
        defaultDm: store.defaultDm ?? "",
        defaultTemplateId: store.defaultTemplateId,
        pausedReason: store.pausedReason,
        webhooksAt: store.webhooksAt ? store.webhooksAt.toISOString() : null,
      }}
      stores={state.stores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "—") }))}
      templates={state.templates.map((t) => ({
        id: t.id,
        name: t.name,
        publicSamples: t.publicSamples,
        thanksSamples: t.thanksSamples,
        dmGreeting: t.dmGreeting,
        whatsappAlways: t.whatsappAlways,
      }))}
      products={state.products.map((p) => ({ id: p.id, name: p.name }))}
      postAutomations={postAutomations}
      posts={recent}
      postErrors={errors}
      usage={state.usage}
    />
  );
}
