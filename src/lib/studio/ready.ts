import { higgsfieldConfigured } from "./higgsfield";
import { imageModel } from "./presets";

/**
 * The Studio's master switch. It is OFF (decided 2026-10-12): the owner took the Higgsfield Studio
 * out of the product to make video ads with the programmatic motion engine instead. Nothing was
 * deleted — pages, actions, jobs, renderer, webhook and tables are all still here — so setting
 * STUDIO_ENABLED=1 (with the Higgsfield keys) brings it back.
 */
export function studioEnabled(): boolean {
  return process.env.STUDIO_ENABLED?.trim() === "1";
}

/** Whether the Studio can make pictures here: switched on, and the key pair and the model are set. Server only, and light enough for layouts. */
export function studioReady(): boolean {
  return studioEnabled() && higgsfieldConfigured() && !!imageModel();
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
