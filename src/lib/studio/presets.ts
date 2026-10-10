// The Studio's scenes and sizes, and the one prompt every picture is made with.
//
// The shop's own product photo is the reference: the model only changes what is around the
// product. It never writes text — image models write Kurdish wrong — so the headline, price,
// logo and delivery line are drawn by our renderer on top (src/app/studio-render).

export const STUDIO_PRESETS = [
  "studio",
  "home",
  "flatlay",
  "luxury",
  "outdoor",
  "newroz",
  "ramadan",
  "eid",
  "winter",
  "sale",
] as const;
export type StudioPreset = (typeof STUDIO_PRESETS)[number];
export const isStudioPreset = (v: unknown): v is StudioPreset => typeof v === "string" && (STUDIO_PRESETS as readonly string[]).includes(v);

/** What each scene puts around the product, in English (the models follow English best). */
const SCENE: Record<StudioPreset, string> = {
  studio: "on a clean seamless studio backdrop in soft brand-coloured tones, soft diffused light, gentle shadow, e-commerce hero shot",
  home: "styled in a warm, modern Middle Eastern home interior, natural window light, tasteful props, lifestyle product photo",
  flatlay: "top-down flat lay on a textured surface with a few matching props, even soft light, neat composition",
  luxury: "on black marble with subtle gold accents, dramatic soft spotlight, elegant reflections, premium mood",
  outdoor: "outdoors in a modern city street at golden hour, shallow depth of field, warm natural light",
  newroz: "in spring in the green mountains of Kurdistan, wildflowers, soft evening light with a warm Newroz bonfire glow in the far background, festive and fresh",
  ramadan: "on an elegant table at Ramadan night, glowing lanterns and a crescent moon motif, warm golden light, calm and refined",
  eid: "in a festive Eid gift setting, wrapped gift boxes, soft fairy lights, joyful and elegant",
  winter: "in a cozy winter scene, soft window light, knitted textures, warm tones",
  sale: "on a bold dark background with a dramatic spotlight and subtle glowing accents, energetic premium sale mood",
};

/** Which size suits each scene best when the merchant has not picked one. */
export const PRESET_ASPECT: Record<StudioPreset, StudioAspect> = {
  studio: "4:5",
  home: "4:5",
  flatlay: "1:1",
  luxury: "4:5",
  outdoor: "9:16",
  newroz: "9:16",
  ramadan: "4:5",
  eid: "4:5",
  winter: "4:5",
  sale: "9:16",
};

export const STUDIO_ASPECTS = ["1:1", "4:5", "9:16"] as const;
export type StudioAspect = (typeof STUDIO_ASPECTS)[number];
export const isStudioAspect = (v: unknown): v is StudioAspect => typeof v === "string" && (STUDIO_ASPECTS as readonly string[]).includes(v);

/** The finished ad's size in pixels: feed square, Instagram portrait, Reels/Stories/TikTok. */
export const ASPECT_PX: Record<StudioAspect, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/** What we ask the model for: the closest ratio it offers (4:5 is made as 3:4 and cropped by the renderer). */
export const MODEL_ASPECT: Record<StudioAspect, string> = { "1:1": "1:1", "4:5": "3:4", "9:16": "9:16" };

/** Rules that hold for every picture. */
const RULES = [
  "Keep the product exactly as it is in the reference photo: same shape, colours, materials, label, logo and proportions. Do not redesign, recolour or replace it.",
  "Do not add any text, letters, numbers, prices, watermarks or extra logos anywhere in the image.",
  "No real or famous people. If a person appears, they wear modest clothing.",
  "Photorealistic commercial product photography, sharp focus on the product, high detail.",
  "Leave calm space near the bottom of the frame for text that will be added later.",
].join(" ");

/** The prompt for one picture of the product in the reference photo. */
export function studioPrompt(preset: StudioPreset): string {
  return `A product photo of the item in the reference image, ${SCENE[preset]}. ${RULES}`;
}

/** The Higgsfield model that makes product pictures from a reference photo. Set in the environment once chosen in the Higgsfield console. */
export function imageModel(): string | null {
  const app = process.env.HIGGSFIELD_IMAGE_APP?.trim();
  return app || null;
}

/** The model's arguments: the prompt, the shop's own photo as the reference, the ratio. */
export function imageArgs(prompt: string, sourceUrl: string, aspect: StudioAspect): Record<string, unknown> {
  return { prompt, image_urls: [sourceUrl], aspect_ratio: MODEL_ASPECT[aspect] };
}

export const HEADLINE_MAX = 60;

/** A headline our renderer can draw: one line of plain text, at most 60 characters, no angle brackets. */
export function cleanHeadline(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(s).length <= HEADLINE_MAX ? s : null;
}
