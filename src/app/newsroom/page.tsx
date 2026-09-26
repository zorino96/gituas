import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import { currentWorkspace } from "@/app/app/data";
import { gmFontVars } from "@/app/app/fonts";
import { ShopNotice } from "./shop-notice";

export const metadata: Metadata = {
  title: "گیتواس نیوزڕووم",
  description: "هەواڵی ڕۆژانەی کەناڵەکەت بە کارتی براندی خۆت، لە چەند خولەکێکدا",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

const STEPS = ["هەواڵ لە سەرچاوەکانەوە", "کورتەی کوردی بە زیرەکیی دەستکرد", "کارت و بڵاوکردنەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک"];

export default async function NewsroomLandingPage() {
  const ws = await currentWorkspace();
  if (ws) {
    if (!ws.kindChosen || ws.kind === "NEWS") redirect("/newsroom/news");
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <ShopNotice />
      </div>
    );
  }

  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <div className="gm-auth">
        <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
        <h1 className="gm-title kufi" style={{ marginTop: 10 }}>
          هەواڵی ڕۆژانەی کەناڵەکەت بە کارتی براندی خۆت، لە چەند خولەکێکدا
        </h1>

        <div className="gm-stack" style={{ marginTop: 16 }}>
          {STEPS.map((step) => (
            <div key={step} className="gm-card">
              {step}
            </div>
          ))}
        </div>

        <div className="gm-stack" style={{ marginTop: 20 }}>
          <Link href="/signup?next=/newsroom/news" className="gm-btn block">
            خۆتۆمارکردن
          </Link>
          <Link href="/login?next=/newsroom/news" className="gm-btn quiet block">
            چوونەژوورەوە
          </Link>
        </div>
      </div>
    </div>
  );
}
