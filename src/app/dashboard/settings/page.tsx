import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AiKeysForm } from "./ai-keys-form";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: {
      anthropicKeyEncrypted: true,
      googleAiKeyEncrypted: true,
      openaiKeyEncrypted: true,
    },
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Bring your own AI keys — they live encrypted in your tenant row.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI provider keys</CardTitle>
          <CardDescription>
            Keys are encrypted with AES-256-GCM before storage. The instance default in <code className="rounded bg-muted px-1 font-mono">.env</code> is used when no tenant key is set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiKeysForm
            hasAnthropic={!!tenant?.anthropicKeyEncrypted}
            hasGoogle={!!tenant?.googleAiKeyEncrypted}
            hasOpenAi={!!tenant?.openaiKeyEncrypted}
          />
        </CardContent>
      </Card>
    </div>
  );
}
