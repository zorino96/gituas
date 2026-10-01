import Link from "next/link";

import { num } from "@/app/app/format";
import { GUIDE } from "@/lib/newsroom/guide";

export function GuideArticle() {
  return (
    <article className="nr-guide">
      <header className="nr-guide-head">
        <h1 className="gm-title kufi">ڕێنمایی نیوزڕووم</h1>
        <p className="gm-sub">
          هەموو ئەوەی پێویستە بۆ ئەوەی کەناڵەکەت لە یەک ڕۆژدا دەست بە کار بکات.
        </p>
      </header>
      <nav aria-label="ناوەڕۆک" className="gm-chips nr-toc">
        {GUIDE.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="gm-chip">
            {s.title}
          </a>
        ))}
      </nav>

      <div className="nr-guide-body">
        {GUIDE.map((s, i) => (
          <section key={s.id} id={s.id} className="gm-card" aria-labelledby={`${s.id}-title`}>
            <h2 id={`${s.id}-title`} className="kufi">
              {num(i + 1)}. {s.title}
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
                {s.link.label} ←
              </Link>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
