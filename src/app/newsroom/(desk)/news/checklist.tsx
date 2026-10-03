import Link from "next/link";
import { Check } from "lucide-react";

import { num } from "@/app/app/format";
import { dict, getLang } from "@/lib/i18n";
import type { ChecklistStep } from "@/lib/newsroom/checklist";

/** A new desk's first steps. The page hides it once every step is done. */
export async function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const tc = dict(await getLang()).nr.news.checklist;
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="gm-card nr-check" aria-labelledby="nr-check-title">
      <div className="gm-between">
        <h3 id="nr-check-title" className="kufi" style={{ margin: 0, fontSize: 15 }}>
          {tc.title}
        </h3>
        <small className="gm-sub" style={{ margin: 0 }}>
          {num(done)} / {num(steps.length)}
        </small>
      </div>
      <div className="nr-meter" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol role="list">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "done" : undefined}>
            <Link href={s.href}>
              <span className="tick" aria-hidden="true">
                {s.done && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="label">{s.label}</span>
              {s.done && <span className="state">{tc.done}</span>}
            </Link>
          </li>
        ))}
      </ol>
      <Link href="/newsroom/guide" className="gm-link" style={{ fontSize: 12.5 }}>
        {tc.guide}
      </Link>
    </section>
  );
}
