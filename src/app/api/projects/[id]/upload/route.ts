import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { buildAllVariants, bufferToDataUrl, type AspectRatioKey } from "@/lib/image-pipeline";

export const runtime = "nodejs";

/**
 * POST /api/projects/:id/upload
 * multipart/form-data with field "image" containing the source file.
 *
 * Produces a ContentPost with 4 ContentVariant rows (one per aspect ratio).
 * Stored as data: URLs for now; switching to @vercel/blob is a single-file edit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const project = await db.project.findFirst({
    where: { id, tenant: { ownerId: session.user.id } },
    select: { id: true, tenantId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'image' field" }, { status: 400 });
  }
  const description = (form.get("description") as string | null) ?? "";
  const hashtags = (form.get("hashtags") as string | null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  const source = Buffer.from(await file.arrayBuffer());
  const variants = await buildAllVariants(source);

  const sourceUrl = bufferToDataUrl(
    await (await import("sharp")).default(source).jpeg({ quality: 88 }).toBuffer(),
  );

  const post = await db.contentPost.create({
    data: {
      projectId: project.id,
      sourceAssetUrl: sourceUrl,
      sourceAssetType: "IMAGE",
      description,
      hashtags,
      status: "DRAFT",
      variants: {
        create: variants.map((v) => ({
          aspectRatio: v.ratio as AspectRatioKey,
          assetUrl: bufferToDataUrl(v.buffer),
        })),
      },
    },
    include: { variants: true },
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenantId,
      projectId: project.id,
      actor: "USER",
      action: "content.uploaded",
      reasoning: `User uploaded an image. 4 aspect-ratio variants generated.`,
      metadata: { contentPostId: post.id, variants: variants.length },
    },
  });

  return NextResponse.json({
    contentPost: {
      id: post.id,
      status: post.status,
      variants: post.variants.map((v) => ({ ratio: v.aspectRatio, assetUrl: v.assetUrl })),
    },
  });
}
