// The growth coach (the weekly note, the Today cards, the business-picture tool's profile lines) is switched on together with the
// setup interview: BUSINESS_PROFILE_ENABLED=1. One switch, so the owner turns the whole growth coach on and off in one place.

import { profileEnabled } from "@/lib/shop/profile-shared";

export const coachEnabled = (): boolean => profileEnabled();
