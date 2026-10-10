import { higgsfieldConfigured } from "./higgsfield";
import { imageModel } from "./presets";

/** Whether the Studio can make pictures here: the key pair and the chosen model are set. Server only, and light enough for layouts. */
export function studioReady(): boolean {
  return higgsfieldConfigured() && !!imageModel();
}
