/**
 * Whether the AI video section is open (nav item, page, automation). It needs the AdVideo table
 * (gituas-private/apply-video-schema.cjs) and the render worker, so it stays closed until
 * AD_VIDEO_ENABLED=1 is set in Vercel; setting it to anything else closes it again.
 */
export function adVideoEnabled(): boolean {
  return process.env.AD_VIDEO_ENABLED?.trim() === "1";
}
