import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link
        href={`/dashboard/projects/${id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to project
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Ad campaigns</h1>
      <p className="mt-1 text-muted-foreground">
        Realized from the marketing plan when you connect ad accounts.
      </p>
      <Card className="mt-6">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No campaigns yet.
        </CardContent>
      </Card>
    </div>
  );
}
