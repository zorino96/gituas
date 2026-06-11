import { EngagementClient } from "./engagement-client";

// Live API calls (comments/DMs/insights) can take a few seconds.
export const maxDuration = 60;

export default function EngagementPage() {
  return <EngagementClient />;
}
