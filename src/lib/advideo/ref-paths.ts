// Where the owner's reference files live and what counts as one. No dependencies: the upload route
// and the Video page use it as well as the server code that reads the files.

export type RefKind = "image" | "video";

export const REF_LIMITS = {
  images: 8,
  videos: 3,
  imageBytes: 12 * 1024 * 1024,
  videoBytes: 40 * 1024 * 1024,
  /** Pictures the director is shown at once. */
  seen: 4,
} as const;

export const refPrefix = (tenantId: string, storeId: string) => `merchant/${tenantId}/advideo-ref/${storeId}/`;

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov)$/i;

export function refKind(pathname: string): RefKind | null {
  return IMAGE_EXT.test(pathname) ? "image" : VIDEO_EXT.test(pathname) ? "video" : null;
}

/** Whether a pathname is one of this store's reference files (and climbs out of nothing). */
export function isRefPath(pathname: unknown, tenantId: string, storeId: string): pathname is string {
  return typeof pathname === "string" && pathname.startsWith(refPrefix(tenantId, storeId)) && !/\.\.|%|\\|\/\//.test(pathname.slice(refPrefix(tenantId, storeId).length)) && refKind(pathname) !== null;
}

/** The store id in a reference path of this workspace, or null when the path is not one. */
export function refStoreOf(pathname: string, tenantId: string): string | null {
  const m = /^merchant\/([^/]+)\/advideo-ref\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m || m[1] !== tenantId || /\.\.|%|\\/.test(m[3]) || refKind(pathname) === null) return null;
  return m[2];
}
