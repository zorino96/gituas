import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import "./app.css";
import { claimKind, currentWorkspace, listWorkspaces } from "./data";
import { gmFontVars } from "./fonts";
import { AppFrame } from "./frame";
import { deleteThreadAction, listThreadsAction, pinThreadAction, renameThreadAction } from "./assistant/chat-actions";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { studioReadyFor } from "@/lib/studio/ready";
import { switchWorkspaceAction } from "@/app/newsroom/desk-actions";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { createShopAction } from "./shop-actions";
import { dict, dirOf, getLang, type Lang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { chatEnabled } from "@/lib/chat/enabled";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { loadOwnerType } from "@/lib/shop/owner-type";
import { OwnerTypeProvider } from "./owner-type-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang());
  return { title: t.brand, description: t.layout.metaDescription };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <LangProvider lang={lang}>
      <Shell lang={lang}>{children}</Shell>
    </LangProvider>
  );
}

async function Shell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const t = dict(lang);
  let ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/app");
  if (!ws.kindChosen) ws = await claimKind(ws, "MERCHANT");
  if (ws.kind === "NEWS") {
    const shops = (await listWorkspaces()).filter((w) => w.kind === "MERCHANT" && w.kindChosen);
    if (shops.length === 0) {
      // A newsroom account opening the shop: offer it a shop of its own instead of bouncing to the newsroom.
      return (
        <div className={`gm ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
          <div className="gm-auth">
            <p className="gm-brand kufi">{t.brand}</p>
            <div className="gm-card" style={{ marginTop: 18 }}>
              <p style={{ margin: 0 }}>{t.layout.newsOnly}</p>
            </div>
            <form action={createShopAction}>
              <button type="submit" className="gm-btn block" style={{ marginTop: 12 }}>
                {t.layout.createShop}
              </button>
            </form>
            <a href={`${NEWSROOM_ORIGIN}/newsroom/news`} className="gm-btn quiet block" style={{ marginTop: 10 }}>
              {t.layout.goNewsroom}
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className={`gm ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
        <div className="gm-auth">
          <p className="gm-brand kufi">{t.brand}</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>{t.layout.inDesk(ws.name)}</p>
          </div>
          {shops.map((s) => (
            <form key={s.id} action={switchWorkspaceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="next" value="/app" />
              <button type="submit" className="gm-btn block" style={{ marginTop: 10 }}>
                {t.layout.goShop(s.name)}
              </button>
            </form>
          ))}
          <Link href="/newsroom/news" className="gm-btn quiet block" style={{ marginTop: 10 }}>
            {t.layout.backNewsroom}
          </Link>
        </div>
      </div>
    );
  }

  // The chat has its own frame (history sidebar, composer) on /app/assistant; it is for the people who may configure the shop.
  const chat =
    chatEnabled() && can(ws.role, "configure")
      ? {
          api: { list: listThreadsAction, rename: renameThreadAction, pin: pinThreadAction, remove: deleteThreadAction },
          support: { url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY },
        }
      : null;

  // A creator (someone who earns from content, not from selling) gets a menu and a chat that do not talk about orders and products.
  const ownerType = await loadOwnerType(ws.id);

  return (
    <div className={`gm ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <OwnerTypeProvider value={ownerType}>
        <AppFrame kind={ws.kind} workspace={ws.name} workspaceId={ws.id} studio={studioReadyFor(ws.id)} video={adVideoEnabled()} chat={chat}>
          {children}
        </AppFrame>
      </OwnerTypeProvider>
    </div>
  );
}
