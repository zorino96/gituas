import Link from "next/link";

import { dict, dirOf, getLang } from "@/lib/i18n";
import { guideFor } from "@/lib/newsroom/guide";

export async function GuideArticle() {
  const lang = await getLang();
  const d = dict(lang);
  const t = d.nr.shell.guide;
  const guide = guideFor(lang);
  return (
    <article className="nr-guide">
      <header className="nr-guide-head">
        <h1 className="gm-title kufi">{t.title}</h1>
        <p className="gm-sub">{t.sub}</p>
      </header>
      <nav aria-label={t.toc} className="gm-chips nr-toc">
        {guide.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="gm-chip">
            {s.title}
          </a>
        ))}
      </nav>

      <div className="nr-guide-body">
        {guide.map((s, i) => (
          <section key={s.id} id={s.id} className="gm-card" aria-labelledby={`${s.id}-title`}>
            <h2 id={`${s.id}-title`} className="kufi">
              {d.fmt.num(i + 1)}. {s.title}
            </h2>
            <p>{s.intro}</p>
            {s.steps && (
              <ol className="nr-steps">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {s.qa && (
              <dl className="nr-qa">
                {s.qa.map(({ q, a }) => (
                  <div key={q}>
                    <dt>{q}</dt>
                    <dd>{a}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.link && (
              <Link href={s.link.href} className="gm-link nr-more-link">
                {s.link.label} {dirOf(lang) === "ltr" ? "→" : "←"}
              </Link>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
