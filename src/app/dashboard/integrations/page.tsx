import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PROVIDERS, isProviderEnvConfigured } from "@/lib/oauth/registry";
import { IntegrationCard } from "./integration-card";

export default async function IntegrationsPage() {
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
