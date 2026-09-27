import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { loadPageChoice } from "@/lib/oauth/flow";
import { cancelPageChoiceAction, choosePageAction } from "./actions";

export const metadata: Metadata = { title: "پەیجەکەت هەڵبژێرە — گیتواس", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

/** After Facebook sign-in, someone who runs several Pages picks the one to connect. */
export default async function ChooseFacebookPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string }> }) {
  const { c = "", error } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const choice = await loadPageChoice(c, session.user.id);
  const newsroom = !!choice?.redirectTo.startsWith("/newsroom");

  return (
    <div className={`gm ${newsroom ? "nr " : ""}${gmFontVars}`} dir="rtl" lang="ckb">
      <div className="gm-auth">
        <p className="gm-brand kufi">{newsroom ? "گیتواس نیوزڕووم" : "گیتواس"}</p>
        {!choice ? (
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>کاتی هەڵبژاردن بەسەرچوو یان ئەم بەستەرە بۆ تۆ نییە. لە ڕێکخستن دووبارە فەیسبووک پەیوەست بکەوە.</p>
          </div>
        ) : (
          <>
            <h1 className="gm-title kufi" style={{ marginTop: 12 }}>کام پەیج پەیوەست بکرێت؟</h1>
            <p className="gm-sub">ئەم پەیجانە لە فەیسبووک بەڕێوە دەبەیت. ئەوەی بۆ ئەم {newsroom ? "مێزە" : "دووکانە"}یە هەڵبژێرە.</p>
            {error && (
              <p className="gm-err" role="alert">
                پەیوەستکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.
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
                پاشگەزبوونەوە
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
