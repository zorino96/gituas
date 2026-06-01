import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const projects = await db.project.findMany({
    where: { tenant: { ownerId: session.user.id } },
    orderBy: { updatedAt: "desc" },
    include: { personality: true, mode: true },
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-muted-foreground">Each project is one product Gituas markets.</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No projects yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.id}`}>
              <Card className="hover:bg-muted/30">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-lg">{p.name}</div>
                        <Badge variant="outline">{p.status.toLowerCase()}</Badge>
                        <Badge variant="secondary">{p.mode?.masterMode ?? "MANUAL"}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {p.description ?? "No description yet."}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {p.githubRepoOwner && p.githubRepoName
                      ? `${p.githubRepoOwner}/${p.githubRepoName}`
                      : "No repo connected"}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
