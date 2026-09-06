"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";

export interface CreateProjectResult {
  error?: string;
}

/** Turn a display name into a slug that is safe in a URL and stable to type. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Create the tenant's first (or next) project.
 *
 * Until this existed there was no path in the app that created a Project, so a
 * new account signed in, got a tenant from the signIn callback, and landed on a
 * dashboard whose every surface — approvals, content, agents — hangs off a
 * project it had no way to make. The owner's own project had been inserted by
 * hand, which is why the gap stayed invisible.
 *
 * Name is the only thing asked for. Everything else on Project is optional and
 * is filled in later from the project's own settings.
 */
export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the project a name." };
  if (name.length > 60) return { error: "Keep the name under 60 characters." };

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  // The signIn callback creates a tenant on first sign-in, so this should not
  // happen. If it does, say so plainly instead of throwing a 500 at the user.
  if (!tenant) return { error: "No workspace found for this account. Sign out and back in." };

  const base = slugify(name) || "project";

  // slug is unique per tenant (@@unique([tenantId, slug])). Two projects called
  // "Vidsave" in the same workspace is a reasonable thing to want, so suffix
  // rather than reject.
  let slug = base;
  for (let n = 2; n <= 50; n++) {
    const taken = await db.project.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${base}-${n}`;
    if (n === 50) return { error: "Too many projects with that name." };
  }

  const project = await db.project.create({
    data: { tenantId: tenant.id, name, slug },
    select: { id: true },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
  redirect(`/dashboard/projects/${project.id}`);
}
