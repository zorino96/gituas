"use client";

// The setup interview: one short question per screen, chips first, every question skippable, every answer saved as it is
// given. What the owner wants Gituas to do is the first question and shapes the rest (a person who wants more viewers
// is not asked about delivery). Nothing buyers will read is switched on until the owner confirms the last screen.

import { useState } from "react";
import Link from "next/link";

import { useLang, useT } from "@/lib/i18n/client";
import { CITIES } from "@/lib/orders/cities";
import {
  CATEGORIES,
  CUSTOMERS,
  GOALS,
  PAYMENTS,
  PROFILE_LANGS,
  RETURNS,
  TONES,
  type Category,
  type Customer,
  type Fact,
  type Goal,
  type Tone,
  cleanLine,
  hasLinkOrPhone,
} from "@/lib/shop/profile-shared";
import { finishInterviewAction, saveProfileStepAction } from "./actions";

export interface SetupInitial {
  goal: Goal | null;
  goalText: string;
  category: Category | null;
  offerLine: string;
  customer: Customer[];
  sellsTo: string[];
  language: "ckb" | "ar" | null;
  tone: Tone | null;
  facts: Fact[];
  finished: boolean;
  /** The facts that were already switched on before this visit (the owner confirmed them earlier). */
  confirmedBefore: string[];
}

type StepId = "goal" | "what" | "who" | "where" | "facts" | "tone" | "review";

/** The screens for this goal, in order: delivery and payment only for people who sell or take enquiries. */
export function stepsFor(goal: Goal | null, hasFacts: boolean): StepId[] {
  // Only an owner who wants viewers and followers is spared the questions about buyers; every one of them can be skipped.
  const asksBuyers = goal !== "grow";
  const out: StepId[] = ["goal", "what", "who"];
  if (asksBuyers) out.push("where", "facts");
  out.push("tone");
  if (asksBuyers && hasFacts) out.push("review");
  return out;
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const keyOf = (f: Pick<Fact, "k" | "v">) => `${f.k}:${f.v}`;

export function SetupClient({ storeId, storeName, initial, initialStep = 0 }: { storeId: string; storeName: string; initial: SetupInitial; initialStep?: number }) {
  const t = useT();
  const s = t.setup;
  const lang = useLang();
  const [p, setP] = useState(initial);
  const [i, setI] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [custom, setCustom] = useState("");

  const steps = stepsFor(p.goal, p.facts.length > 0);
  const step = steps[Math.min(i, steps.length - 1)];
  const label = (group: "cat" | "cust" | "pay" | "ret" | "tone" | "goal" | "lang", id: string): string => (s as unknown as Record<string, string>)[`${group}_${id}`] ?? id;

  /** The fields this screen owns. */
  function patchFor(id: StepId): Record<string, unknown> {
    switch (id) {
      case "goal": return { goal: p.goal, goalText: p.goalText };
      case "what": return { category: p.category, offerLine: p.offerLine };
      case "who": return { customer: p.customer };
      case "where": return { sellsTo: p.sellsTo };
      // New facts are stored switched off by the server: they are switched on only when the owner confirms the review screen.
      case "facts": return { facts: p.facts };
      case "tone": return { tone: p.tone, language: p.language };
      default: return {};
    }
  }

  async function go(skipped: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await saveProfileStepAction(storeId, patchFor(step), { step, index: i, skipped });
      if (!r.ok) return setErr(s.saveFailed(r.error));
      if (r.dropped?.length) return setErr(`${s.customRefused} ${r.dropped.join("، ")}`);
      if (step === steps[steps.length - 1]) {
        // The last screen: the review when there are facts to confirm, else done at once (facts never reviewed stay as they were).
        const before = new Set(initial.confirmedBefore);
        const f = await finishInterviewAction(storeId, p.facts.map((x) => ({ ...x, on: step === "review" ? x.on : before.has(keyOf(x)) })));
        if (!f.ok) return setErr(s.saveFailed(f.error));
        return setDone(true);
      }
      setI((n) => n + 1);
    } catch {
      setErr(s.saveFailed(t.common.error));
    } finally {
      setBusy(false);
    }
  }

  const setFact = (k: Fact["k"], v: string, on: boolean) =>
    setP((x) => {
      // Returns is one choice: a new one replaces the one before.
      const rest = x.facts.filter((f) => !(f.k === k && (f.v === v || (k === "returns" && on))));
      return { ...x, facts: on ? [...rest, { k, v, on: true }] : rest };
    });
  const hasFact = (k: Fact["k"], v: string) => p.facts.some((f) => f.k === k && f.v === v);

  if (done) {
    return (
      <div className="gm-card gm-stack">
        <p className="gm-sec" style={{ margin: 0 }}>{s.doneTitle}</p>
        <p className="gm-hint" style={{ margin: 0 }}>{s.doneBody}</p>
        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link href="/app/products" className="gm-btn small">{s.doneProducts}</Link>
          <Link href="/app/automation" className="gm-btn small quiet">{s.doneAuto}</Link>
          <Link href="/app" className="gm-btn small quiet">{s.doneToday}</Link>
        </div>
      </div>
    );
  }

  const chip = (key: string, text: string, pressed: boolean, onClick: () => void) => (
    <button key={key} type="button" className="gm-chip" aria-pressed={pressed} onClick={onClick}>
      {text}
    </button>
  );

  return (
    <div className="gm-stack">
      <div>
        <h2 className="gm-title kufi" style={{ marginBottom: 4 }}>{s.title}</h2>
        {storeName && <p className="gm-sub" style={{ margin: 0 }}>{storeName}</p>}
        {i === 0 && <p className="gm-hint" style={{ marginTop: 6 }}>{initial.finished ? s.finishedNote : s.intro}</p>}
      </div>

      <div className="gm-card gm-stack">
        <small className="gm-hint">{s.progress(Math.min(i + 1, steps.length), steps.length)}</small>

        {step === "goal" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.goalQ}</p>
            <div className="gm-chips">{GOALS.map((g) => chip(g, label("goal", g), p.goal === g, () => setP((x) => ({ ...x, goal: x.goal === g ? null : g }))))}</div>
            <input className="gm-input" dir="auto" maxLength={200} value={p.goalText} placeholder={s.goalTextPh} onChange={(e) => setP((x) => ({ ...x, goalText: e.target.value }))} />
            <small className="gm-hint">{s.goalHint}</small>
          </>
        )}

        {step === "what" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.whatQ}</p>
            <div className="gm-chips">{CATEGORIES.map((c) => chip(c, label("cat", c), p.category === c, () => setP((x) => ({ ...x, category: x.category === c ? null : c }))))}</div>
            <label className="gm-stack" style={{ gap: 6 }}>
              <span>{s.offerQ}</span>
              <input className="gm-input" dir="auto" maxLength={140} value={p.offerLine} placeholder={s.offerPh} onChange={(e) => setP((x) => ({ ...x, offerLine: e.target.value }))} />
            </label>
          </>
        )}

        {step === "who" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.whoQ}</p>
            <div className="gm-chips">{CUSTOMERS.map((c) => chip(c, label("cust", c), p.customer.includes(c), () => setP((x) => ({ ...x, customer: toggle(x.customer, c) }))))}</div>
          </>
        )}

        {step === "where" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.whereQ}</p>
            <div className="gm-chips">
              {chip("all", s.whereAll, p.sellsTo.length === CITIES.length, () => setP((x) => ({ ...x, sellsTo: x.sellsTo.length === CITIES.length ? [] : CITIES.map((c) => c.code) })))}
              {CITIES.map((c) => chip(c.code, c[lang === "ar" ? "ar" : lang === "en" ? "en" : "ckb"], p.sellsTo.includes(c.code), () => setP((x) => ({ ...x, sellsTo: toggle(x.sellsTo, c.code) }))))}
            </div>
            <small className="gm-hint">{s.whereHint}</small>
          </>
        )}

        {step === "facts" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.factsQ}</p>
            <small className="gm-hint">{s.factsHint}</small>
            <small className="gm-sub">{s.payQ}</small>
            <div className="gm-chips">{PAYMENTS.map((v) => chip(v, label("pay", v), hasFact("payment", v), () => setFact("payment", v, !hasFact("payment", v))))}</div>
            <small className="gm-sub">{s.retQ}</small>
            <div className="gm-chips">{RETURNS.map((v) => chip(v, label("ret", v), hasFact("returns", v), () => setFact("returns", v, !hasFact("returns", v))))}</div>
            <small className="gm-sub">{s.customQ}</small>
            {p.facts.filter((f) => f.k === "custom").map((f) => (
              <div key={f.v} className="gm-between">
                <span dir="auto">{f.v}</span>
                <button type="button" className="gm-btn small quiet" onClick={() => setFact("custom", f.v, false)}>×</button>
              </div>
            ))}
            {p.facts.filter((f) => f.k === "custom").length < 3 && (
              <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input className="gm-input" dir="auto" maxLength={160} value={custom} placeholder={s.customPh} onChange={(e) => setCustom(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
                <button
                  type="button"
                  className="gm-btn small quiet"
                  disabled={!custom.trim()}
                  onClick={() => {
                    const text = cleanLine(custom, 160);
                    if (!text) return;
                    if (hasLinkOrPhone(text)) return setErr(s.customRefused);
                    setErr(null);
                    setCustom("");
                    setP((x) => (x.facts.some((f) => f.k === "custom" && f.v === text) ? x : { ...x, facts: [...x.facts, { k: "custom", v: text, on: true }] }));
                  }}
                >
                  {s.customAdd}
                </button>
              </div>
            )}
            <small className="gm-hint">{s.customHint}</small>
          </>
        )}

        {step === "tone" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.toneQ}</p>
            <div className="gm-chips">{TONES.map((v) => chip(v, label("tone", v), p.tone === v, () => setP((x) => ({ ...x, tone: x.tone === v ? null : v }))))}</div>
            <small className="gm-sub">{s.langQ}</small>
            <div className="gm-chips">{PROFILE_LANGS.map((v) => chip(v, label("lang", v), p.language === v, () => setP((x) => ({ ...x, language: x.language === v ? null : v }))))}</div>
            <small className="gm-hint">{s.langHint}</small>
          </>
        )}

        {step === "review" && (
          <>
            <p className="gm-sec" style={{ margin: 0 }}>{s.reviewTitle}</p>
            <small className="gm-hint">{s.reviewHint}</small>
            {p.facts.length === 0 && <p className="gm-hint" style={{ margin: 0 }}>{s.reviewEmpty}</p>}
            {p.facts.map((f) => (
              <div key={`${f.k}:${f.v}`} className="gm-between">
                <span dir="auto" id={`fact-${f.k}-${f.v.length}-${f.v.slice(0, 12)}`}>{f.k === "payment" ? label("pay", f.v) : f.k === "returns" ? label("ret", f.v) : f.v}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={f.on}
                  aria-labelledby={`fact-${f.k}-${f.v.length}-${f.v.slice(0, 12)}`}
                  title={f.on ? s.factSay : s.factHide}
                  className="gm-knob"
                  onClick={() => setP((x) => ({ ...x, facts: x.facts.map((y) => (y.k === f.k && y.v === f.v ? { ...y, on: !y.on } : y)) }))}
                >
                  <i />
                </button>
              </div>
            ))}
          </>
        )}

        {err && <p className="gm-err" role="alert" style={{ margin: 0 }}>{err}</p>}

        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {i > 0 && (
            <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => setI((n) => Math.max(0, n - 1))}>{s.back}</button>
          )}
          <button type="button" className="gm-btn" disabled={busy} onClick={() => void go(false)}>
            {busy ? s.saving : step === steps[steps.length - 1] ? s.finish : s.next}
          </button>
          {step !== "review" && (
            <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => void go(true)}>{s.skip}</button>
          )}
        </div>
      </div>
    </div>
  );
}
