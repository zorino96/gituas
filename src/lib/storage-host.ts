/** Where our stored files are served from: Cloudflare R2 (bucket gituas-media) on our own domain. */
export const MEDIA_HOST = "media.gituas.com";

const OLD_BLOB_SUFFIX = ".public.blob.vercel-storage.com";

/** Our storage: R2's domain, or the old Vercel Blob store (files saved before 2026-10-25 still carry its address). */
export function isStorageHost(hostname: string): boolean {
  return hostname === MEDIA_HOST || hostname.endsWith(OLD_BLOB_SUFFIX);
}
