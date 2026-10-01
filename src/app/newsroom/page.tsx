import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, LayoutTemplate, ShieldCheck, Sparkles, Send, Users } from "lucide-react";

import { currentWorkspace, listWorkspaces } from "@/app/app/data";
import { NewsroomRoot } from "./desk-shell";
import { ShopNotice } from "./shop-notice";

export const metadata: Metadata = {
  title: "گیتواس نیوزڕووم",
  description: "ژووری هەواڵی کەناڵەکەت لەسەر سۆشیال میدیا: کارتی براندی خۆت و بڵاوکردنەوە بۆ هەموو پلاتفۆرمەکان لە یەک شوێنەوە.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    Icon: LayoutTemplate,
    title: "کارتی براندی کەناڵەکەت",
    body: "لۆگۆ و ڕەنگی خۆت، بە فۆنتێک کە هەڵیدەبژێریت، لەسەر هەموو کارتێک، بە چوار جۆر: ئاسایی، بەپەلە، ژمارە و وتە.",
  },
  {
    Icon: Sparkles,
    title: "کورتەی کوردی بە زیرەکیی دەستکرد",
    body: "هەواڵ لە چەند چرکەیەکدا دەبێتە سەردێڕ و دەقی کوردیی ئامادە بۆ پۆست. تۆ دەستکاری و پەسەندی دەکەیت.",
  },
  {
    Icon: Send,
    title: "یەک شوێن بۆ هەموو پلاتفۆرمەکان",
    body: "لە یەک پەڕەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک بڵاو بکەرەوە.",
  },
  {
    Icon: BarChart3,
    title: "کۆمێنت، نامە و ئامار",
    body: "وەڵامی بینەران بدەرەوە و بزانە کام هەواڵ زۆرترین کۆمێنتی وەرگرتووە، بێ ئەوەی لە ئەپێکەوە بچیتە ئەپێکی تر.",
  },
  {
    Icon: Users,
    title: "تیمەکەت پێکەوە",
    body: "نووسەر، سەرنووسەر و خاوەن، هەر یەکە بە ڕۆڵی خۆی. چەند مێز بۆ چەند زمان یان براند.",
  },
] as const;

export default async function NewsroomLandingPage() {
  const ws = await currentWorkspace();
  if (ws) {
    if (!ws.kindChosen || ws.kind === "NEWS") redirect("/newsroom/news");
    const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen).map((w) => ({ id: w.id, name: w.name }));
    return (
      <NewsroomRoot>
        <ShopNotice desks={desks} />
      </NewsroomRoot>
    );
  }

  return (
    <NewsroomRoot>
      <div className="nr-land">
        <header className="nr-land-bar">
          <div className="nr-wrap">
            <p className="nr-brand kufi" style={{ padding: 0 }}>
              <span className="nr-live" aria-hidden="true" />
              گیتواس نیوزڕووم
            </p>
            <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
              چوونەژوورەوە
            </Link>
          </div>
        </header>

        <main className="nr-land-main nr-wrap">
          <section className="nr-hero">
            <div className="nr-hero-copy">
              <h1 className="kufi">ژووری هەواڵی کەناڵەکەت، لەسەر هەموو پلاتفۆرمەکان</h1>
              <p>هەواڵ بکە بە کارتی براندی خۆت و لە یەک شوێنەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک بڵاوی بکەرەوە.</p>

              <div className="nr-cta">
                <Link href="/signup?next=/newsroom/news" className="gm-btn">
                  دەست پێ بکە
                </Link>
                <Link href="/newsroom/guide" className="gm-btn quiet">
                  چۆن کار دەکات؟
                </Link>
              </div>
              <p className="nr-promise">
                <ShieldCheck aria-hidden="true" />
                هیچ شتێک بێ پەسەندی تۆ بڵاو نابێتەوە.
              </p>
            </div>

            {/* decoration only: a news card on its way to three platforms */}
            <div className="nr-art" aria-hidden="true">
              <div className="nr-art-card back" />
              <div className="nr-art-card">
                <div className="nr-art-top">
                  <span className="nr-live" />
                  <i />
                  <i />
                </div>
                <div className="nr-art-photo" />
                <div className="nr-art-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="nr-art-plats">
                  <b />
                  <b />
                  <b />
                  <i />
                </div>
              </div>
            </div>
          </section>

          <div className="nr-features">
            {FEATURES.map(({ Icon, title, body }) => (
              <div key={title} className="nr-feature">
                <span className="nr-feature-icon" aria-hidden="true">
                  <Icon />
                </span>
                <h3 className="kufi">{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    </NewsroomRoot>
  );
}
