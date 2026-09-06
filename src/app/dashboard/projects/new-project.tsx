"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createProject } from "./actions";

/**
 * The form that makes a tenant's first project.
 *
 * `emptyState` renders it inline and already open, because a new account with
 * no projects has nothing else to do on this page; anywhere else it starts as
 * a button so it does not crowd the list.
 */
export function NewProject({ emptyState = false }: { emptyState?: boolean }) {
  const [open, setOpen] = useState(emptyState);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // A successful create redirects, so control only returns here on failure.
      const res = await createProject(formData);
      if (res?.error) setError(res.error);
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New project
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <form action={onSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="name" className="text-sm font-medium">
              Project name
            </label>
            <p className="text-sm text-muted-foreground mt-0.5">
              One product Gituas markets for you. You can connect a repo and a site later.
            </p>
          </div>

          <input
            id="name"
            name="name"
            autoFocus
            required
            maxLength={60}
            placeholder="Vidsave"
            className="h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm outline-none focus:border-money"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create project"}
            </Button>
            {!emptyState && (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
