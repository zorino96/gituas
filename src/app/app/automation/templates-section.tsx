"use client";

import { useId, useState } from "react";

import { deleteTemplateAction, saveTemplateAction } from "./actions";
import { SaveMessage, useSaver, type TemplateView } from "./shared";

/** Reply samples, one per line, plus the two DM options. Used for the default template and for the others. */
function TemplateEditor({
  storeId,
  template,
  withName,
  makeDefault,
  onSaved,
}: {
  storeId: string;
  template: TemplateView | null;
  withName: boolean;
  makeDefault: boolean;
  onSaved?: () => void;
}) {
  const uid = useId();
  const { pending, message, run } = useSaver();
  const [name, setName] = useState(template?.name ?? "");
  const [questions, setQuestions] = useState((template?.publicSamples ?? []).join("\n"));
  const [thanks, setThanks] = useState((template?.thanksSamples ?? []).join("\n"));
  const [dmGreeting, setDmGreeting] = useState(template?.dmGreeting ?? true);
  const [whatsappAlways, setWhatsappAlways] = useState(template?.whatsappAlways ?? false);

  function save() {
    run(
      () =>
        saveTemplateAction(storeId, template?.id ?? null, {
          name: withName ? name : (template?.name ?? "بنەڕەت"),
          publicSamples: questions.split("\n"),
          thanksSamples: thanks.split("\n"),
          dmGreeting,
          whatsappAlways,
          makeDefault,
        }),
      onSaved,
    );
  }

  return (
    <div className="gm-stack">
      {withName && (
        <div className="gm-field">
          <label htmlFor={`${uid}-name`}>ناو</label>
          <input id={`${uid}-name`} className="gm-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="gm-field">
        <label htmlFor={`${uid}-q`}>نموونەی وەڵام بۆ پرسیار (هەر دێڕێک یەک نموونە، تا ٥)</label>
        <textarea id={`${uid}-q`} className="gm-textarea" value={questions} onChange={(e) => setQuestions(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-t`}>نموونەی سوپاس (تا ٥)</label>
        <textarea id={`${uid}-t`} className="gm-textarea" value={thanks} onChange={(e) => setThanks(e.target.value)} />
      </div>
      <p className="gm-hint" style={{ margin: 0 }}>
        AI هەر جارێک بە زمانی کڕیار دەیگۆڕێت و هیچ ژمارەیەک ناخاتە سەری. وەڵامی گشتی تەنها کاتێک دەچێت کە نامەی تایبەتیش بچێت.
      </p>
      <div>
        <label className="gm-radio">
          <input type="checkbox" checked={dmGreeting} onChange={(e) => setDmGreeting(e.target.checked)} />
          سڵاوی AI لە سەرەتای نامەدا
        </label>
        <label className="gm-radio">
          <input type="checkbox" checked={whatsappAlways} onChange={(e) => setWhatsappAlways(e.target.checked)} />
          لینکی واتسئەپ هەمیشە لە نامەکەدا بێت
        </label>
      </div>
      <div>
        <button type="button" className="gm-btn" disabled={pending} onClick={save}>
          پاشەکەوت
        </button>
        <SaveMessage message={message} />
      </div>
    </div>
  );
}

/** Sections "وەڵامەکان" (the default template) and "تێمپلەیتەکانی تر". */
export function TemplatesSection({ storeId, templates, defaultTemplateId }: { storeId: string; templates: TemplateView[]; defaultTemplateId: string | null }) {
  const defaultTemplate = templates.find((t) => t.id === defaultTemplateId) ?? null;
  const others = templates.filter((t) => t.id !== defaultTemplate?.id);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, message, setMessage, run } = useSaver();

  function saved() {
    setEditing(null);
    setMessage({ ok: true, text: "پاشەکەوت کرا" });
  }

  function toggle(key: string | "new") {
    setMessage(null);
    setEditing((cur) => (cur === key ? null : key));
  }

  return (
    <>
      <p className="gm-sec">وەڵامەکان</p>
      <div className="gm-card">
        <TemplateEditor key={defaultTemplate?.id ?? "none"} storeId={storeId} template={defaultTemplate} withName={false} makeDefault />
      </div>

      <p className="gm-sec">تێمپلەیتەکانی تر</p>
      <div className="gm-card">
        {others.map((t) => (
          <div key={t.id}>
            <div className="gm-target">
              <p>{t.name}</p>
              <div className="gm-row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="gm-btn small quiet" aria-expanded={editing === t.id} disabled={pending} onClick={() => toggle(t.id)}>
                  دەستکاری
                </button>
                <button
                  type="button"
                  className="gm-btn small quiet"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      saveTemplateAction(storeId, t.id, {
                        name: t.name,
                        publicSamples: t.publicSamples,
                        thanksSamples: t.thanksSamples,
                        dmGreeting: t.dmGreeting,
                        whatsappAlways: t.whatsappAlways,
                        makeDefault: true,
                      }),
                    )
                  }
                >
                  بیکە بە بنەڕەت
                </button>
                <button
                  type="button"
                  className="gm-btn small danger"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("ئەم تێمپلەیتە بسڕدرێتەوە؟")) run(() => deleteTemplateAction(storeId, t.id), () => setEditing((cur) => (cur === t.id ? null : cur)));
                  }}
                >
                  سڕینەوە
                </button>
              </div>
            </div>
            {editing === t.id && (
              <div style={{ padding: "4px 0 14px" }}>
                <TemplateEditor storeId={storeId} template={t} withName makeDefault={false} onSaved={saved} />
              </div>
            )}
          </div>
        ))}
        {editing === "new" && <TemplateEditor storeId={storeId} template={null} withName makeDefault={false} onSaved={saved} />}
        <div style={{ marginTop: others.length || editing === "new" ? 12 : 0 }}>
          <button type="button" className="gm-btn quiet" aria-expanded={editing === "new"} disabled={pending} onClick={() => toggle("new")}>
            تێمپلەیتی نوێ
          </button>
        </div>
        <SaveMessage message={message} />
      </div>
    </>
  );
}
