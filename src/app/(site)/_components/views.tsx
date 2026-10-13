// The public pages' bodies. Plain server components: headings in order, answer-first text, links between pages,
// and the same facts in the visible text that the structured data states.

import Link from "next/link";

import { CHROME } from "@/lib/site/chrome";
import { CONTENT_UPDATED, guidesFor } from "@/lib/site/content";
import { FEATURE_GUIDE } from "@/lib/site/feature-guides";
import { sitePath, type SiteLang } from "@/lib/site/langs";
import type { PlanRow } from "@/lib/site/pricing";
import type { Guide, Landing, Qa } from "@/lib/site/types";
import { ku as kuDigits } from "@/lib/site/digits";

/** "14 October 2026" in the page's language: when the prices and limits on the page were last checked. */
const checkedDate = (lang: SiteLang) =>
  new Date(`${CONTENT_UPDATED}T00:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : lang === "ku" ? "ckb-IQ" : "ar-IQ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const fmt = (lang: SiteLang, n: number) => (lang === "en" ? n.toLocaleString("en-US") : kuDigits(n.toLocaleString("en-US")).replace(/,/g, "٬"));

function Faq({ title, items }: { title: string; items: Qa[] }) {
  return (
    <section className="site-section" aria-labelledby="faq">
      <h2 id="faq">{title}</h2>
      <div className="site-faq">
        {items.map((f) => (
          <div key={f.q} className="site-qa">
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PlanCards({ lang, plans, compact }: { lang: SiteLang; plans: PlanRow[]; compact?: boolean }) {
  const c = CHROME[lang].pricing;
  return (
    <div className={`site-plans${compact ? " compact" : ""}`}>
      {plans.map((p) => (
        <article key={p.plan} className="site-plan" data-plan={p.plan}>
          <h3>{c.plans[p.plan].name}</h3>
          <p className="site-plan-price">
            <strong>{fmt(lang, p.price)}</strong> <span>{lang === "en" ? "IQD" : lang === "ku" ? "دینار" : "دينار"}</span>
          </p>
          <p className="site-plan-per">{p.price === 0 ? `${c.free} · ${c.forShop}` : c.perMonth}</p>
          <p className="site-plan-blurb">{c.plans[p.plan].blurb}</p>
        </article>
      ))}
    </div>
  );
}

export function LandingView({ lang, landing, plans }: { lang: SiteLang; landing: Landing; plans: PlanRow[] }) {
  const c = CHROME[lang];
  return (
    <>
      <section className="site-hero">
        <div className="site-wrap">
          <h1>{landing.h1}</h1>
          <p className="site-lead">{landing.lead}</p>
          <div className="site-cta">
            <Link href="/signup?next=/app" className="site-btn big" prefetch={false}>
              {c.cta.start}
            </Link>
            <Link href={sitePath(lang, "/pricing")} className="site-btn quiet big">
              {c.nav.pricing}
            </Link>
          </div>
        </div>
      </section>

      <section className="site-section site-wrap" aria-labelledby="how">
        <h2 id="how">{c.sections.how}</h2>
        <ol className="site-steps">
          {landing.steps.map((s, i) => (
            <li key={s.title}>
              <span className="site-step-n" aria-hidden="true">
                {lang === "en" ? i + 1 : kuDigits(String(i + 1))}
              </span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section site-wrap" id="features" aria-labelledby="features-h">
        <h2 id="features-h">{c.sections.features}</h2>
        <div className="site-features">
          {landing.features.map((f, i) => {
            const slug = FEATURE_GUIDE[i];
            return (
              <article key={f.title} className="site-feature">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                {slug && (
                  <p className="site-feature-link">
                    <Link href={sitePath(lang, `/guides/${slug}`)} className="site-link">
                      {c.sections.read} →
                    </Link>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="site-section site-wrap" aria-labelledby="audience">
        <h2 id="audience">{c.sections.audience}</h2>
        <div className="site-features two">
          {landing.audience.map((a) => (
            <article key={a.title} className="site-feature">
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section site-wrap" aria-labelledby="market">
        <h2 id="market">{landing.market.title}</h2>
        <div className="site-prose">
          {landing.market.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <p className="site-more">
          <Link href={sitePath(lang, "/guides")}>{c.nav.guides} →</Link>
        </p>
      </section>

      <section className="site-section site-wrap" aria-labelledby="pricing">
        <h2 id="pricing">{landing.pricing.title}</h2>
        <p className="site-prose-lead">{landing.pricing.intro}</p>
        <PlanCards lang={lang} plans={plans} compact />
        <p className="site-note">{landing.pricing.note}</p>
        <p className="site-note">{c.pricing.checked(checkedDate(lang))}</p>
        <p className="site-more">
          <Link href={sitePath(lang, "/pricing")}>{c.sections.more} →</Link>
        </p>
      </section>

      <div className="site-wrap">
        <Faq title={c.sections.faq} items={landing.faq} />
      </div>

      <section className="site-closing">
        <div className="site-wrap">
          <h2>{landing.closing.title}</h2>
          <p>{landing.closing.body}</p>
          <Link href="/signup?next=/app" className="site-btn big" prefetch={false}>
            {c.cta.startFree}
          </Link>
        </div>
      </section>
    </>
  );
}

export function GuidesIndexView({ lang }: { lang: SiteLang }) {
  const c = CHROME[lang];
  const guides = guidesFor(lang);
  return (
    <section className="site-section site-wrap">
      <h1>{c.guides.title}</h1>
      <p className="site-lead">{c.guides.intro}</p>
      <div className="site-guides">
        {guides.map((g) => (
          <article key={g.slug} className="site-guide-card">
            <h2>
              <Link href={sitePath(lang, `/guides/${g.slug}`)}>{g.title}</Link>
            </h2>
            <p>{g.metaDescription}</p>
            <Link href={sitePath(lang, `/guides/${g.slug}`)} className="site-link">
              {c.guides.read} →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function GuideView({ lang, guide }: { lang: SiteLang; guide: Guide }) {
  const c = CHROME[lang];
  const related = guidesFor(lang).filter((g) => guide.related.includes(g.slug));
  const date = new Date(`${CONTENT_UPDATED}T00:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : lang === "ku" ? "ckb-IQ" : "ar-IQ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <article className="site-section site-wrap site-article">
      <nav className="site-crumbs" aria-label="Breadcrumb">
        <Link href={sitePath(lang)}>{c.home}</Link> <span aria-hidden="true">/</span> <Link href={sitePath(lang, "/guides")}>{c.guides.title}</Link>
      </nav>
      <h1>{guide.title}</h1>
      <p className="site-updated">
        {c.guides.updated}: <time dateTime={CONTENT_UPDATED}>{date}</time>
      </p>
      <p className="site-answer">{guide.answer}</p>

      <aside className="site-keyfacts" aria-label={c.guides.keyFacts}>
        <h2>{c.guides.keyFacts}</h2>
        <ul>
          {guide.keyPoints.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </aside>

      {guide.sections.map((s) => (
        <section key={s.h2}>
          <h2>{s.h2}</h2>
          {s.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {s.bullets && s.bullets.length > 0 && (
            <ul>
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {guide.steps && guide.steps.length > 0 && (
        <section>
          <h2>{c.guides.steps}</h2>
          <ol className="site-ol">
            {guide.steps.map((s) => (
              <li key={s.name}>
                <strong>{s.name}</strong> {s.text}
              </li>
            ))}
          </ol>
        </section>
      )}

      <Faq title={c.guides.faq} items={guide.faq} />

      {related.length > 0 && (
        <section>
          <h2>{c.guides.related}</h2>
          <ul>
            {related.map((g) => (
              <li key={g.slug}>
                <Link href={sitePath(lang, `/guides/${g.slug}`)}>{g.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="site-article-cta">
        <Link href="/signup?next=/app" className="site-btn big" prefetch={false}>
          {c.cta.startFree}
        </Link>
      </div>
    </article>
  );
}

export function PricingView({ lang, plans }: { lang: SiteLang; plans: PlanRow[] }) {
  const maxOpen = plans.some((p) => p.plan === "MAX");
  const c = CHROME[lang].pricing;
  const u = c.units;
  const n = (v: number) => fmt(lang, v);
  const cell = (v: number, unit: string) => (v > 0 ? `${n(v)} ${unit}` : c.rows.none);
  const rows: { label: string; cells: string[] }[] = [
    { label: c.rows.price, cells: plans.map((p) => (p.price === 0 ? c.free : `${n(p.price)} ${lang === "en" ? "IQD" : lang === "ku" ? "دینار" : "دينار"}`)) },
    { label: c.rows.posts, cells: plans.map((p) => (p.posts === null ? c.rows.allPosts : lang === "en" ? u.newest(p.posts) : kuDigits(u.newest(p.posts)))) },
    { label: c.rows.replies, cells: plans.map((p) => n(p.repliesPerDay)) },
    { label: c.rows.ai, cells: plans.map((p) => n(p.aiRepliesPerMonth)) },
    { label: c.rows.voice, cells: plans.map((p) => cell(p.voiceNotesPerDay, u.perDay)) },
    { label: c.rows.boost, cells: plans.map((p) => n(p.boostPerDay)) },
    { label: c.rows.video, cells: plans.map((p) => cell(p.videosPerMonth, u.ads)) },
    { label: c.rows.pictures, cells: plans.map((p) => cell(p.picturesPerMonth, u.pics)) },
    { label: c.rows.accounts, cells: plans.map((p) => n(p.accounts)) },
    { label: c.rows.model, cells: plans.map((p) => (p.opus ? c.rows.opus : c.rows.fast)) },
  ];
  return (
    <>
      <section className="site-section site-wrap">
        <h1>{c.title}</h1>
        <p className="site-lead">{c.intro}</p>
        <h2 className="site-visually-hidden">{CHROME[lang].sections.plans}</h2>
        <PlanCards lang={lang} plans={plans} />
        <p className="site-note">{c.checked(checkedDate(lang))}</p>
        <h2>{c.compare}</h2>
        <div className="site-table-wrap">
          <table className="site-table">
            <thead>
              <tr>
                <th scope="col" />
                {plans.map((p) => (
                  <th key={p.plan} scope="col">
                    {c.plans[p.plan].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((v, i) => (
                    <td key={`${r.label}-${plans[i].plan}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="site-notes">
          {c.notes.map((n2) => (
            <li key={n2}>{n2}</li>
          ))}
        </ul>
        <h2>{c.payTitle}</h2>
        <p className="site-prose-lead">{c.payBody}</p>
      </section>
      <div className="site-wrap">
        <Faq title={CHROME[lang].sections.faq} items={c.faq(maxOpen)} />
      </div>
      <section className="site-closing">
        <div className="site-wrap">
          <Link href="/signup?next=/app" className="site-btn big" prefetch={false}>
            {CHROME[lang].cta.startFree}
          </Link>
        </div>
      </section>
    </>
  );
}
