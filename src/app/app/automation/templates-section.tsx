"use client";

import { useId, useState } from "react";

import { useT } from "@/lib/i18n/client";

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
  const a = useT().automation;
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
          name: withName ? name : (template?.name ?? a.defaultName),
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
          <label htmlFor={`${uid}-name`}>{a.templateName}</label>
          <input id={`${uid}-name`} className="gm-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="gm-field">
        <label htmlFor={`${uid}-q`}>{a.questionSamples}</label>
        <textarea id={`${uid}-q`} className="gm-textarea" value={questions} onChange={(e) => setQuestions(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-t`}>{a.thanksSamples}</label>
        <textarea id={`${uid}-t`} className="gm-textarea" value={thanks} onChange={(e) => setThanks(e.target.value)} />
      </div>
      <p className="gm-hint" style={{ margin: 0 }}>
        {a.aiHint}
      </p>
      <div>
        <label className="gm-radio">
          <input type="checkbox" checked={dmGreeting} onChange={(e) => setDmGreeting(e.target.checked)} />
          {a.dmGreeting}
        </label>
        <label className="gm-radio">
          <input type="checkbox" checked={whatsappAlways} onChange={(e) => setWhatsappAlways(e.target.checked)} />
          {a.whatsappAlways}
        </label>
      </div>
      <div>
        <button type="button" className="gm-btn" disabled={pending} onClick={save}>
          {a.save}
        </button>
        <SaveMessage message={message} />
      </div>
    </div>
  );
}

/** Sections "وەڵامەکان" (the default template) and "تێمپلەیتەکانی تر". */
export function TemplatesSection({ storeId, templates, defaultTemplateId }: { storeId: string; templates: TemplateView[]; defaultTemplateId: string | null }) {
  const a = useT().automation;
  const defaultTemplate = templates.find((t) => t.id === defaultTemplateId) ?? null;
  const others = templates.filter((t) => t.id !== defaultTemplate?.id);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, message, setMessage, run } = useSaver();

  function saved() {
    setEditing(null);
    setMessage({ ok: true, text: a.saved });
  }

  function toggle(key: string | "new") {
    setMessage(null);
    setEditing((cur) => (cur === key ? null : key));
  }

  return (
    <>
      <p className="gm-sec">{a.repliesSec}</p>
      <div className="gm-card">
        <TemplateEditor key={defaultTemplate?.id ?? "none"} storeId={storeId} template={defaultTemplate} withName={false} makeDefault />
      </div>

      <p className="gm-sec">{a.othersSec}</p>
      <div className="gm-card">
        {others.map((t) => (
          <div key={t.id}>
            <div className="gm-target">
              <p>{t.name}</p>
              <div className="gm-row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="gm-btn small quiet" aria-expanded={editing === t.id} disabled={pending} onClick={() => toggle(t.id)}>
                  {a.edit}
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
                  {a.makeDefault}
                </button>
                <button
                  type="button"
                  className="gm-btn small danger"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(a.confirmDeleteTemplate)) run(() => deleteTemplateAction(storeId, t.id), () => setEditing((cur) => (cur === t.id ? null : cur)));
                  }}
                >
                  {a.delete}
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
            {a.newTemplate}
          </button>
        </div>
        <SaveMessage message={message} />
      </div>
    </>
  );
}
