import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { loadPageChoice } from "@/lib/oauth/flow";
import { cancelPageChoiceAction, choosePageAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang());
  return { title: t.connectFacebook.metaTitle, robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

/** After Facebook sign-in, someone who runs several Pages picks the one to connect. */
export default async function ChooseFacebookPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string }> }) {
  const { c = "", error } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/connect/facebook?c=${c}`)}`);
  const choice = await loadPageChoice(c, session.user.id);
  const newsroom = !!choice?.redirectTo.startsWith("/newsroom");
  const lang = await getLang();
  const t = dict(lang);
  const cf = t.connectFacebook;

  return (
    <div className={`gm ${newsroom ? "nr " : ""}${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <div className="gm-auth">
        <p className="gm-brand kufi">{newsroom ? t.nr.shell.name : t.brand}</p>
        {!choice ? (
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>{cf.expired}</p>
          </div>
        ) : (
          <>
            <h1 className="gm-title kufi" style={{ marginTop: 12 }}>{cf.title}</h1>
            <p className="gm-sub">{newsroom ? cf.subDesk : cf.subShop}</p>
            {error && (
              <p className="gm-err" role="alert">
                {cf.error}
              </p>
            )}
            <div className="gm-stack">
              {choice.pages.map((p) => (
                <form key={p.id} action={choosePageAction}>
                  <input type="hidden" name="c" value={c} />
                  <input type="hidden" name="page" value={p.id} />
                  <button type="submit" className="gm-btn quiet block">
                    {p.name}
                  </button>
                </form>
              ))}
            </div>
            <form action={cancelPageChoiceAction} style={{ marginTop: 16, textAlign: "center" }}>
              <input type="hidden" name="c" value={c} />
              <button type="submit" className="gm-linkbtn gm-link">
                {cf.cancel}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
