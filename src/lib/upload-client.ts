"use client";

// Browser uploads straight to our storage (R2): /api/app/upload checks the request and answers with an address that can
// write that one file, then the file goes there directly (it never passes through a Vercel function, capped at 4.5 MB).
// The same call as the Vercel Blob `upload` it replaced.

export interface UploadOptions {
  access?: "public";
  handleUploadUrl: string;
  contentType?: string;
  /** Kept for the callers written for Blob; R2 takes one request up to 5 GB. */
  multipart?: boolean;
  onUploadProgress?: (e: { loaded: number; total: number; percentage: number }) => void;
}

export async function upload(pathname: string, file: Blob, o: UploadOptions): Promise<{ url: string; pathname: string }> {
  const contentType = o.contentType || file.type || "application/octet-stream";
  const res = await fetch(o.handleUploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname, contentType, size: file.size }),
  });
  const grant = (await res.json().catch(() => ({}))) as { uploadUrl?: string; url?: string; pathname?: string; error?: string };
  if (!res.ok || !grant.uploadUrl || !grant.url || !grant.pathname) throw new Error(grant.error || "Upload refused");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", grant.uploadUrl!);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) o.onUploadProgress?.({ loaded: e.loaded, total: e.total, percentage: (e.loaded / e.total) * 100 });
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
  return { url: grant.url, pathname: grant.pathname };
}
