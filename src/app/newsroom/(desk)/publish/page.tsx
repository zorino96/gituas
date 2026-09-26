// Segment config can't be re-exported — copied from src/app/app/publish/page.tsx.
// Instagram video containers are polled for up to ~45 s before publishing.
export const maxDuration = 60;

export { default } from "@/app/app/publish/page";
