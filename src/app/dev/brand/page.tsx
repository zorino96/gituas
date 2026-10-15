import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import { BrandEditor } from "@/app/app/settings/brand-editor";
import { LangProvider } from "@/lib/i18n/client";

/** Dev only: the Brand tab without signing in (its actions need a session, so nothing is saved from here). */
export default async function DevBrandPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { lang } = await searchParams;
  const l = lang === "en" || lang === "ar" ? lang : "ckb";
  return (
    <LangProvider lang={l}>
      <div className={`gm ${gmFontVars}`} dir={l === "en" ? "ltr" : "rtl"}>
        <div className="gm-main" style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
          <BrandEditor
            workspaceId="dev"
            pageName=""
            kit={{ logoPath: null, primary: "#0B2545", accent: "#E0A526", text: "#FFFFFF", headingFont: "kufi", framePath: null, frameText: "bottom", logoCorner: "off" }}
            photos={[]}
            sectionFrames={[]}
            designPrompt=""
            aiFrames
            photoCardsOnly={false}
            sourceImages={false}
            aiPictures={false}
            accountNames={{ FB: "هەواڵنووس", IG: "hawalnoos" }}
          />
        </div>
      </div>
    </LangProvider>
  );
}
