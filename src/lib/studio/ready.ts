import { higgsfieldConfigured } from "./higgsfield";
import { imageModel } from "./presets";

/** Whether the Studio can make pictures here: the key pair and the model are set. Server only, and light enough for layouts. */
export function studioReady(): boolean {
  return higgsfieldConfigured() && !!imageModel();
}

/**
 * Whether this workspace sees the Studio. Until STUDIO_OPEN=1 (after Higgsfield confirms that
 * generation may be included in our plans), only the workspaces listed in STUDIO_TENANTS do.
 */
export function studioReadyFor(tenantId: string): boolean {
  if (!studioReady()) return false;
  if (process.env.STUDIO_OPEN?.trim() === "1") return true;
  return (process.env.STUDIO_TENANTS ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(tenantId);
}
