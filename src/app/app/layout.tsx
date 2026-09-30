import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import "./app.css";
import { claimKind, currentWorkspace, listWorkspaces } from "./data";
import { gmFontVars } from "./fonts";
import { Tabs } from "./nav";
import { switchWorkspaceAction } from "@/app/newsroom/desk-actions";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { createShopAction } from "./shop-actions";
import { dict, getLang, type Lang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";

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
        <div className={`gm ${gmFontVars}`} dir="rtl" lang={lang}>
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
      <div className={`gm ${gmFontVars}`} dir="rtl" lang={lang}>
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

  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang={lang}>
      <div className="gm-shell">
        <header className="gm-head">
          <div>
            <h1 className="kufi">{ws.name}</h1>
            <small>{t.brand}</small>
          </div>
          <Link href="/app/settings" className="gm-btn quiet small">
            <Settings size={15} aria-hidden="true" />
            {t.layout.settings}
          </Link>
        </header>
        <main className="gm-main">{children}</main>
      </div>
      <Tabs kind={ws.kind} />
    </div>
  );
}
