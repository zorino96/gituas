import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadForm } from "./upload-form";

export default async function ContentLibraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;

  const project = await db.project.findFirst({
    where: { id, tenant: { ownerId: session.user.id } },
    select: { id: true, name: true },
  });
  if (!project) return null;

  const posts = await db.contentPost.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { variants: true, platformPosts: true },
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link
        href={`/dashboard/projects/${id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {project.name}
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Content library</h1>
      <p className="mt-1 text-muted-foreground">
        One asset → 4 aspect ratios → every platform.
      </p>

      <Card className="mt-6">
        <CardContent className="p-5">
          <UploadForm projectId={project.id} />
        </CardContent>
      </Card>

      <div className="mt-8 space-y-4">
        {posts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No content posts yet — upload an image above to create one.
            </CardContent>
          </Card>
        ) : (
          posts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {p.variants[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.variants[0].assetUrl}
                      alt=""
                      className="h-20 w-20 rounded-md border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="secondary">{p.status.toLowerCase().replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{p.variants.length} variants</Badge>
                      <span className="text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm line-clamp-3">{p.description}</p>
                    {p.hashtags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.hashtags.slice(0, 8).map((h) => (
                          <span key={h} className="text-xs text-muted-foreground font-mono">
                            #{h}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.platformPosts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.platformPosts.map((pp) => (
                          <Badge key={pp.id} variant="outline" className="font-normal">
                            {pp.platform.toLowerCase().replace(/_/g, " ")} · {pp.status.toLowerCase()}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
