import { SetupPage } from "@/app/app/settings/setup-page";

export const dynamic = "force-dynamic";
// A frame designed with the AI takes up to a minute.
export const maxDuration = 60;

export default function Page() {
  return <SetupPage section="brand" title="brand" />;
}
