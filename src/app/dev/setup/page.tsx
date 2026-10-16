import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import { SetupClient } from "@/app/app/setup/setup-client";
import { LangProvider } from "@/lib/i18n/client";

/** Dev only: the setup interview without signing in (its actions need a session, so nothing is saved from here). */
export default async function DevSetupPage({ searchParams }: { searchParams: Promise<{ lang?: string; step?: string; goal?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const l = sp.lang === "en" || sp.lang === "ar" ? sp.lang : "ckb";
  const goal = sp.goal === "grow" || sp.goal === "leads" || sp.goal === "other" ? sp.goal : "sell";
  return (
    <LangProvider lang={l}>
      <div className={`gm ${gmFontVars}`} dir={l === "en" ? "ltr" : "rtl"}>
        <div className="gm-main" style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
          <SetupClient
            storeId="dev"
            storeName="hawalnoos"
            initialStep={Number(sp.step ?? 0) || 0}
            initial={{
              goal,
              goalText: "",
              category: "fashion",
              offerLine: "",
              customer: ["women"],
              sellsTo: ["erbil"],
              language: null,
              tone: null,
              facts: [
                { k: "payment", v: "cod", on: true },
                { k: "returns", v: "exchange", on: true },
              ],
              finished: false,
              confirmedBefore: [],
            }}
          />
        </div>
      </div>
    </LangProvider>
  );
}
