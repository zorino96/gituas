import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PROVIDERS, isProviderEnvConfigured } from "@/lib/oauth/registry";
import { IntegrationCard } from "./integration-card";

const ERROR_COPY: Record<string, string> = {
  state_expired: "the connect flow expired — try again",
  token_exchange_failed: "the platform rejected the token exchange — try again",
  provider_mismatch: "connect flow mismatch — start over from this page",
  oauth_failed: "the platform connection failed — try again",
  access_denied: "you declined the authorization on the platform",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const creds = await db.oAuthCredential.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
  });

  // GitHub is connected through Auth.js itself
  const githubAcct = await db.account.findFirst({
    where: { userId: session.user.id, provider: "github" },
    select: { providerAccountId: true, scope: true },
  });

  const byProvider = new Map<string, typeof creds>();
  for (const c of creds) {
    const arr = byProvider.get(c.provider) ?? [];
    arr.push(c);
    byProvider.set(c.provider, arr);
  }

  const categories = ["social", "ads", "payments", "infra"] as const;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      {connected && (
        <div className="rounded-md border border-money/40 bg-money/10 px-4 py-3 text-sm">
          <span className="font-mono text-money">✓ {connected.replace(/_/g, " ")}</span>{" "}
          <span className="text-fg">connected successfully — the account appears below.</span>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red/40 bg-red/10 px-4 py-3 text-sm">
          <span className="font-mono text-red">✕ connection failed</span>{" "}
          <span className="text-fg">{ERROR_COPY[error] ?? "something went wrong — try again"}</span>
        </div>
      )}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">integrations</div>
        <div className="mt-1 font-mono text-3xl">
          <span className="text-money">{creds.length + (githubAcct ? 1 : 0)}</span>
          <span className="text-fg-dim text-base ml-2">connected</span>
        </div>
        <p className="mt-2 text-sm text-fg-dim max-w-xl">
          add api keys or oauth-connect each platform <span className="text-money">after</span> you get the dev permissions and verify the business accounts. credentials are encrypted at rest with AES-256-GCM.
        </p>
      </div>

      {/* GitHub — special case, comes through Auth.js sign-in */}
      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">
          source · github
        </h2>
        <div className="rounded-xl border border-line bg-panel p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="led" />
              <span className="font-mono">github</span>
              <span className="text-fg-dim text-xs">via auth.js</span>
            </div>
            <div className="mt-1 text-xs text-fg-dim">
              account id: <span className="font-mono text-fg">{githubAcct?.providerAccountId ?? "—"}</span>
              {githubAcct?.scope && (
                <span className="ml-3">scopes: <span className="font-mono text-money">{githubAcct.scope}</span></span>
              )}
            </div>
          </div>
          <span className="font-mono text-xs text-money">connected</span>
        </div>
      </section>

      {categories.map((cat) => {
        const providers = PROVIDERS.filter((p) => p.category === cat);
        return (
          <section key={cat}>
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">
              {categoryLabel(cat)} · {providers.length}
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {providers.map((cfg) => (
                <IntegrationCard
                  key={cfg.provider}
                  cfg={cfg}
                  credentials={byProvider.get(cfg.provider) ?? []}
                  envConfigured={isProviderEnvConfigured(cfg)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function categoryLabel(c: string): string {
  switch (c) {
    case "social": return "social platforms";
    case "ads": return "ads";
    case "payments": return "payments";
    case "infra": return "infra";
    default: return c;
  }
}
