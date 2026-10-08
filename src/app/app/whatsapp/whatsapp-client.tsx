"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import type { WaTemplate } from "@/lib/whatsapp/cloud";
import { ago } from "../format";
import {
  connectWhatsAppAction,
  createWhatsAppTemplateAction,
  disconnectWhatsAppAction,
  sendWhatsAppAction,
  sendWhatsAppTemplateAction,
  type Result,
} from "./actions";

export interface WaLine {
  id: string;
  from: "them" | "bot" | "you";
  text: string;
  at: string;
}

export interface WaChat {
  /** The buyer's WhatsApp id (phone digits). */
  id: string;
  name: string | null;
  lines: WaLine[];
  lastInboundAt: string | null;
}

type FbLoginResponse = { authResponse?: { code?: string } | null };
type FbSdk = { init(o: object): void; login(cb: (r: FbLoginResponse) => void, o: object): void };
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const DAY = 86_400_000;
const LANGS = ["ar", "en_US", "en", "tr", "fa"] as const;
const CATEGORIES = ["UTILITY", "MARKETING"] as const;

function loadFb(appId: string, version: string): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk"));
    document.body.appendChild(s);
  });
}

function Note({ r }: { r: { ok: boolean; text: string } | null }) {
  return r ? <p className={r.ok ? "gm-ok" : "gm-err"}>{r.text}</p> : null;
}

function Connect({ sdk }: { sdk: { appId: string; configId: string; version: string } | null }) {
  const t = useT().wa;
  const [coexist, setCoexist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fb = useRef<FbSdk | null>(null);
  const signup = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  useEffect(() => {
    if (!sdk) return;
    // Load early: FB.login must run straight from the click or the browser blocks its pop-up.
    loadFb(sdk.appId, sdk.version).then((f) => (fb.current = f), () => setNote({ ok: false, text: t.sdkFailed }));
    const onMessage = (ev: MessageEvent) => {
      if (!/^https:\/\/(www|web)\.facebook\.com$/.test(ev.origin)) return;
      try {
        const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(d.event).startsWith("FINISH") && d.data?.waba_id && d.data?.phone_number_id) {
          signup.current = { wabaId: String(d.data.waba_id), phoneNumberId: String(d.data.phone_number_id) };
        }
      } catch {
        // other Facebook frames post non-JSON messages
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sdk, t.sdkFailed]);

  async function finish(code: string) {
    // The pop-up's session message can land just after the login callback.
    for (let i = 0; i < 20 && !signup.current; i++) await new Promise((r) => setTimeout(r, 250));
    const s = signup.current;
    if (!s) {
      setBusy(false);
      return setNote({ ok: false, text: t.cancelled });
    }
    const r = await connectWhatsAppAction({ code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, coexist });
    setBusy(false);
    setNote(r.ok ? { ok: true, text: t.connectOk } : { ok: false, text: r.error });
  }

  function start() {
    if (!sdk) return;
    if (!fb.current) return setNote({ ok: false, text: t.sdkFailed });
    signup.current = null;
    setNote(null);
    setBusy(true);
    // The SDK rejects async callbacks, so this one only hands off.
    fb.current.login(
      (resp) => {
        const code = resp.authResponse?.code;
        if (!code) {
          setBusy(false);
          setNote({ ok: false, text: t.cancelled });
          return;
        }
        void finish(code);
      },
      {
        config_id: sdk.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: coexist ? "whatsapp_business_app_onboarding" : "", sessionInfoVersion: "3" },
      },
    );
  }

  if (!sdk) return <p className="gm-hint">{t.notReady}</p>;
  return (
    <>
      <label className="gm-row" style={{ gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
        <input type="checkbox" checked={coexist} onChange={(e) => setCoexist(e.target.checked)} style={{ marginTop: 4 }} />
        <span>{t.coexist}</span>
      </label>
      <p className="gm-hint">{t.coexistHint}</p>
      <button type="button" className="gm-btn" onClick={start} disabled={busy}>
        {busy ? t.connecting : t.connect}
      </button>
      <Note r={note} />
    </>
  );
}

function Chat({ chat, onBack }: { chat: WaChat; onBack: () => void }) {
  const all = useT();
  const t = all.wa;
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const open = !!chat.lastInboundAt && Date.now() - Date.parse(chat.lastInboundAt) < DAY;

  return (
    <div>
      <div className="gm-row" style={{ marginBottom: 12 }}>
        <button type="button" className="gm-btn quiet small" onClick={onBack} aria-label={t.back}>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <div>
          <div className="gm-who" dir="auto">{chat.name ?? `+${chat.id}`}</div>
          <span className="gm-time gm-ltr" dir="ltr">+{chat.id}</span>
        </div>
      </div>
      <div className="gm-card">
        {chat.lines.map((l) => (
          <div key={l.id} className={`gm-bubble ${l.from === "them" ? "them" : "us"}`} dir="auto">
            {l.text}
            <div className="gm-time" style={{ marginTop: 3 }}>
              {l.from === "bot" ? `${t.bot} · ` : l.from === "you" ? `${t.you} · ` : ""}
              {ago(l.at, all)}
            </div>
          </div>
        ))}
      </div>
      {open ? (
        <div className="gm-card">
          <textarea className="gm-textarea" dir="auto" rows={3} value={text} placeholder={t.replyPlaceholder} onChange={(e) => setText(e.target.value)} />
          <button
            type="button"
            className="gm-btn"
            disabled={pending || !text.trim()}
            onClick={() =>
              start(async () => {
                const r = await sendWhatsAppAction(chat.id, text);
                setNote(r.ok ? { ok: true, text: t.sent } : { ok: false, text: r.error });
                if (r.ok) setText("");
              })
            }
          >
            {pending ? t.sending : t.send}
          </button>
          <Note r={note} />
        </div>
      ) : (
        <p className="gm-note">{t.outsideWindow}</p>
      )}
    </div>
  );
}

function Templates({ templates, canConfigure }: { templates: WaTemplate[] | null; canConfigure: boolean }) {
  const t = useT().wa;
  const [form, setForm] = useState({ name: "", language: "ar", category: "UTILITY", body: "" });
  const [send, setSend] = useState({ to: "", pick: "" });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendNote, setSendNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const approved = (templates ?? []).filter((x) => x.status === "APPROVED");
  const run = (fn: () => Promise<Result>, ok: string, set: typeof setNote, after?: () => void) =>
    start(async () => {
      const r = await fn();
      set(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error });
      if (r.ok) after?.();
    });

  return (
    <>
      <p className="gm-sec">{t.templatesSec}</p>
      <p className="gm-hint">{t.templatesHint}</p>
      <div className="gm-card">
        {templates === null ? (
          <p className="gm-err">{t.templatesFailed}</p>
        ) : templates.length === 0 ? (
          <p className="gm-sub">{t.noTemplates}</p>
        ) : (
          templates.map((x) => (
            <div key={x.id} className="gm-target">
              <div>
                <p className="gm-ltr" dir="ltr" style={{ display: "inline-block" }}>
                  {x.name} <small>({x.language})</small>
                </p>{" "}
                <span className={`gm-badge ${x.status === "APPROVED" ? "" : x.status === "REJECTED" ? "warn" : "ghost"}`}>{t.status[x.status] ?? x.status}</span>
                <small style={{ display: "block" }} dir="auto">{x.body}</small>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="gm-sec">{t.sendTplSec}</p>
      <div className="gm-card">
        {approved.length === 0 ? (
          <p className="gm-sub">{t.noApproved}</p>
        ) : (
          <>
            <div className="gm-field">
              <label htmlFor="wa-to">{t.sendTplTo}</label>
              <input id="wa-to" className="gm-input gm-ltr" dir="ltr" inputMode="tel" placeholder="0750 123 4567" value={send.to} onChange={(e) => setSend({ ...send, to: e.target.value })} />
            </div>
            <div className="gm-field">
              <label htmlFor="wa-pick">{t.sendTplPick}</label>
              <select id="wa-pick" className="gm-input" value={send.pick} onChange={(e) => setSend({ ...send, pick: e.target.value })}>
                <option value="">—</option>
                {approved.map((x) => (
                  <option key={x.id} value={`${x.name}|${x.language}`}>
                    {x.name} ({x.language})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="gm-btn"
              disabled={pending || !send.to.trim() || !send.pick}
              onClick={() => {
                const [name, language] = send.pick.split("|");
                run(() => sendWhatsAppTemplateAction(send.to, name, language), t.sent, setSendNote);
              }}
            >
              {pending ? t.sending : t.send}
            </button>
          </>
        )}
        <Note r={sendNote} />
      </div>

      {canConfigure && (
        <>
          <p className="gm-sec">{t.newTemplate}</p>
          <div className="gm-card">
            <div className="gm-field">
              <label htmlFor="tpl-name">{t.tplName}</label>
              <input id="tpl-name" className="gm-input gm-ltr" dir="ltr" placeholder="order_ready" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="gm-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <div className="gm-field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="tpl-lang">{t.tplLanguage}</label>
                <select id="tpl-lang" className="gm-input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {t.languages[l]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="gm-field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="tpl-cat">{t.tplCategory}</label>
                <select id="tpl-cat" className="gm-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t.categories[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="gm-field">
              <label htmlFor="tpl-body">{t.tplBody}</label>
              <textarea id="tpl-body" className="gm-textarea" dir="auto" rows={4} maxLength={1024} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <button
              type="button"
              className="gm-btn"
              disabled={pending || !form.name.trim() || !form.body.trim()}
              onClick={() => run(() => createWhatsAppTemplateAction(form), t.created, setNote, () => setForm({ ...form, name: "", body: "" }))}
            >
              {pending ? t.creating : t.create}
            </button>
            <Note r={note} />
          </div>
        </>
      )}
    </>
  );
}

export function WhatsAppClient({
  connected,
  canConfigure,
  sdk,
  chats,
  templates,
}: {
  connected: { phone: string; name: string } | null;
  canConfigure: boolean;
  sdk: { appId: string; configId: string; version: string } | null;
  chats: WaChat[];
  templates: WaTemplate[] | null;
}) {
  const all = useT();
  const t = all.wa;
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = chats.find((c) => c.id === openId) ?? null;

  if (open) return <div className="gm-narrow"><Chat chat={open} onBack={() => setOpenId(null)} /></div>;

  return (
    <div className="gm-narrow">
      <h2 className="gm-title kufi">{t.title}</h2>
      <p className="gm-hint">{t.intro}</p>

      <p className="gm-sec">{t.connectSec}</p>
      <div className="gm-card">
        {connected ? (
          <div className="gm-target">
            <div>
              <p>
                <bdi className="gm-ltr" dir="ltr">{connected.phone}</bdi> <span className="gm-badge">{t.connected}</span>
              </p>
              <small dir="auto">{connected.name ? `${connected.name} · ` : ""}{t.connectedHint}</small>
            </div>
            {canConfigure && (
              <button
                type="button"
                className="gm-btn small quiet"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(t.disconnectConfirm)) start(async () => void (await disconnectWhatsAppAction()));
                }}
              >
                {t.disconnect}
              </button>
            )}
          </div>
        ) : canConfigure ? (
          <Connect sdk={sdk} />
        ) : (
          <p className="gm-sub">{t.errors.notConnected}</p>
        )}
      </div>

      {connected && (
        <>
          <p className="gm-sec">{t.chatsSec}</p>
          {chats.length === 0 ? (
            <div className="gm-empty">{t.noChats}</div>
          ) : (
            <div className="gm-stack">
              {chats.map((c) => {
                const last = c.lines[c.lines.length - 1];
                return (
                  <button key={c.id} type="button" className="gm-card gm-conv" onClick={() => setOpenId(c.id)}>
                    <div className="gm-between">
                      <span className="gm-who" dir="auto">{c.name ?? `+${c.id}`}</span>
                      <span className="gm-time">{ago(last.at, all)}</span>
                    </div>
                    <p className="gm-text" dir="auto" style={{ color: "var(--muted)", margin: "4px 0 0" }}>
                      {last.from === "them" ? "" : `${last.from === "bot" ? t.bot : t.you}: `}
                      {last.text}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          <Templates templates={templates} canConfigure={canConfigure} />
        </>
      )}
    </div>
  );
}
