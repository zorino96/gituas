"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function UploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error("Pick an image first");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("description", description);
      fd.append("hashtags", hashtags);
      const toastId = toast.loading("Sharp is building 4 aspect-ratio variants…");
      try {
        const res = await fetch(`/api/projects/${projectId}/upload`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
        toast.success("Uploaded — 4 variants created", { id: toastId });
        setFile(null);
        setDescription("");
        setHashtags("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label
        htmlFor="file"
        className="flex items-center gap-3 rounded-md border-2 border-dashed border-border px-4 py-3 hover:bg-muted/30 cursor-pointer"
      >
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm flex-1 truncate">
          {file ? file.name : "Pick an image — we'll crop 16:9, 9:16, 1:1 and 4:5 for you"}
        </span>
      </label>
      <input
        id="file"
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Caption / post body…"
        rows={3}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <input
        value={hashtags}
        onChange={(e) => setHashtags(e.target.value)}
        placeholder="hashtags (comma-separated, no #)"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
      />
      <Button type="submit" disabled={isPending || !file} className="w-full">
        <Upload className="mr-2 h-4 w-4" />
        {isPending ? "Uploading…" : "Upload & create 4 variants"}
      </Button>
    </form>
  );
}
