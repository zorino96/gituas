import { Card, CardContent } from "@/components/ui/card";

export default function ConversationsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Conversations</h1>
      <p className="mt-1 text-muted-foreground">DMs, comments, emails — handled or queued for you.</p>
      <Card className="mt-6">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No conversations yet.
        </CardContent>
      </Card>
    </div>
  );
}
