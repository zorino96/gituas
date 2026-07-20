"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Plug, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import type { ProviderConfig } from "@/lib/oauth/registry";
import { saveManualCredential, saveMetaAdsCredential, disconnectIntegration, testConnection } from "./actions";

interface Cred {
  id: string;
  provider: string;
  providerAccountId: string;
  providerAccountName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export function IntegrationCard({
  cfg,
  credentials,
  envConfigured,
}: {
  cfg: ProviderConfig;
  credentials: Cred[];
  envConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const connected = credentials.length > 0;
  const blocked = !!cfg.blocked;

  return (
    <div className={`rounded-xl border ${connected ? "border-money/40 shadow-money" : "border-line"} bg-panel`}>
      <div className="p-4 flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`led ${connected ? "" : blocked ? "red" : "dim"}`} />
            <span className="font-mono lowercase">{cfg.label}</span>
            {cfg.mode === "oauth2_pkce" && (
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-line text-mint">pkce</span>
            )}
            {cfg.mode === "api_key" && (
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-line text-amber">api key</span>
            )}
            {cfg.mode === "oauth2" && (
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-line text-mint">oauth2</span>
            )}
          </div>
          <div className="mt-1 text-xs text-fg-dim">
            {blocked ? (
              <span className="text-amber">{cfg.blocked!.reason}</span>
            ) : connected ? (
              <span>
                <span className="font-mono text-money">{credentials.length}</span>{" "}
                {credentials.length === 1 ? "connection" : "connections"}
              </span>
            ) : envConfigured ? (
              <span className="text-fg-dim">ready to connect</span>
            ) : (
              <span className="text-amber">
                set {cfg.envClientIdKey ?? "credentials"} in .env first
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cfg.docs && (
            <a href={cfg.docs} target="_blank" rel="noopener noreferrer" className="text-fg-dim hover:text-fg" title="docs">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="font-mono text-xs px-3 py-1.5 rounded border border-line text-fg-dim hover:text-fg inline-flex items-center gap-1.5"
          >
            {connected ? "manage" : "connect"}
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line p-4 space-y-4">
          {blocked && (
            <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-xs text-amber">
              <div className="font-medium">blocked: {cfg.blocked!.reason}</div>
              <div className="mt-1 text-fg-dim">↳ {cfg.blocked!.nextStep}</div>
            </div>
          )}

          {credentials.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-2">
                connections · {credentials.length}
              </div>
              <ul className="space-y-2">
                {credentials.map((c) => (
                  <CredentialRow key={c.id} cred={c} />
                ))}
              </ul>
            </div>
          )}

          {cfg.mode === "api_key" ? (
            <ManualForm cfg={cfg} />
          ) : (
            <>
              <OAuthForm cfg={cfg} envConfigured={envConfigured} />
              {cfg.provider === "META_FACEBOOK" && <AdsTokenForm />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CredentialRow({ cred }: { cred: Cred }) {
  const [isPending, startTransition] = useTransition();
  const [testing, setTesting] = useState<{ ok: boolean; detail: string } | null>(null);

  const onTest = () => {
    startTransition(async () => {
      const r = await testConnection(cred.id);
      setTesting(r);
      if (r.ok) toast.success(`connection ok · ${r.detail}`);
      else toast.error(r.detail);
    });
  };
  const onDisconnect = () => {
    if (!confirm(`disconnect ${cred.providerAccountName}?`)) return;
    startTransition(async () => {
      try {
        await disconnectIntegration(cred.id);
        toast.success("disconnected");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "fail");
      }
    });
  };

  return (
    <li className="rounded-md border border-line bg-panel-2 px-3 py-2 flex items-center justify-between text-xs">
      <div className="min-w-0 flex items-center gap-2.5">
        {cred.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cred.avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full border border-line object-cover shrink-0"
          />
        )}
        <div className="min-w-0">
        <div className="font-mono text-fg">{cred.providerAccountName ?? cred.providerAccountId}</div>
        <div className="text-fg-dim mt-0.5 truncate">
          {cred.scopes.length > 0 && <span>scopes · <span className="font-mono">{cred.scopes.join(" ")}</span></span>}
          {cred.expiresAt && (
            <span className="ml-2">
              expires <span className={cred.expiresAt < new Date() ? "text-red" : "text-fg-dim"}>
                {new Date(cred.expiresAt).toLocaleDateString()}
              </span>
            </span>
          )}
          {cred.lastUsedAt && (
            <span className="ml-2">last used {relative(cred.lastUsedAt)}</span>
          )}
          {testing && (
            <span className={`ml-2 ${testing.ok ? "text-money" : "text-red"}`}>· {testing.detail}</span>
          )}
        </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onTest}
          disabled={isPending}
          className="font-mono text-[10px] px-2 py-1 rounded border border-line text-fg-dim hover:text-fg inline-flex items-center gap-1"
          title="test"
        >
          <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} /> test
        </button>
        <button
          onClick={onDisconnect}
          disabled={isPending}
          className="font-mono text-[10px] px-2 py-1 rounded border border-line text-red hover:bg-red/10 inline-flex items-center gap-1"
          title="disconnect"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function ManualForm({ cfg }: { cfg: ProviderConfig }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const fields = cfg.manualFields ?? [];

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fields.some((f) => !values[f.key]?.trim())) {
      toast.error("fill all fields");
      return;
    }
    startTransition(async () => {
      try {
        await saveManualCredential(cfg.provider, values, label || undefined);
        toast.success("saved · encrypted at rest");
        setValues({});
        setLabel("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "fail");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">label (optional)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. main account"
          className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono"
        />
      </div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{f.label}</label>
          <input
            type={f.type}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono"
          />
          {f.helper && <p className="mt-1 text-[10px] text-fg-dim">{f.helper}</p>}
        </div>
      ))}
      <button
        type="submit"
        disabled={isPending}
        className="w-full font-mono text-xs px-3 py-2 rounded bg-money text-bg inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Plug className="h-3.5 w-3.5" />
        {isPending ? "saving…" : "save credentials"}
      </button>
    </form>
  );
}

/** Meta Marketing API System-User token entry (ads/boost), keyed by ad account.
 *  Lives under the facebook pages card since ads ride the same META_FACEBOOK
 *  provider — but the token is a server-side System-User token, not the Page
 *  OAuth token, so it gets its own form + action. */
function AdsTokenForm() {
  const [acct, setAcct] = useState("");
  const [token, setToken] = useState("");
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acct.trim() || !token.trim()) {
      toast.error("fill both fields");
      return;
    }
    startTransition(async () => {
      try {
        await saveMetaAdsCredential(acct, token);
        toast.success("ads token saved · encrypted at rest");
        setAcct("");
        setToken("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "fail");
      }
    });
  };

  return (
    <div className="mt-3 rounded-md border border-line bg-bg p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-1">
        marketing api · system-user token
      </div>
      <p className="text-[10px] text-fg-dim mb-3">
        for ads / boost. business settings → system users → generate token (scopes:
        ads_management, ads_read, business_management), assign the ad account, paste below.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">ad account id</label>
          <input
            value={acct}
            onChange={(e) => setAcct(e.target.value)}
            placeholder="act_1234567890"
            className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">system-user token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAG…"
            className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full font-mono text-xs px-3 py-2 rounded border border-money/40 text-money inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Plug className="h-3.5 w-3.5" />
          {isPending ? "saving…" : "save ads token"}
        </button>
      </form>
    </div>
  );
}

function OAuthForm({ cfg, envConfigured }: { cfg: ProviderConfig; envConfigured: boolean }) {
  if (cfg.blocked) {
    return (
      <div className="text-xs text-fg-dim">
        next step: complete platform verification, then set <code className="font-mono text-money">{cfg.envClientIdKey ?? "OAuth credentials"}</code> in .env and reload.
      </div>
    );
  }

  if (!envConfigured) {
    return (
      <div className="rounded-md border border-line bg-bg p-3 text-xs">
        <div className="text-amber mb-2">
          set these in <code className="text-money">.env</code> first:
        </div>
        <pre className="font-mono text-fg-dim">
{cfg.envClientIdKey}="..."
{cfg.envClientSecretKey}="..."</pre>
        <div className="mt-2 text-fg-dim">
          register the app at the provider's developer console with the callback url:
          <pre className="mt-1 font-mono text-money">{appUrl()}/api/oauth/{cfg.provider.toLowerCase()}/callback</pre>
        </div>
      </div>
    );
  }

  return (
    <a
      href={`/api/oauth/${cfg.provider.toLowerCase()}/start`}
      className="block w-full font-mono text-xs text-center px-3 py-2 rounded bg-money text-bg"
    >
      connect via {cfg.label}
    </a>
  );
}

function appUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
}

function relative(d: Date): string {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
