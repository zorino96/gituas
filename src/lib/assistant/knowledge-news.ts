// What the newsroom's assistant knows about Hawalnoos itself. Hand-written from the code, short; the numbers that can
// change are read from the same constants the product runs on. The assistant is told to state nothing that is not here
// or in the desk's own data, so what is left out here (prices, plan numbers) is answered by pointing at Billing.

import { FRAME_AI_CAPS } from "@/lib/news/ai-budget";
import { SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

export interface NewsKnowledgeFeatures {
  /** The AI image service is configured: frames can be designed. */
  frames: boolean;
}

export function buildNewsKnowledge(f: NewsKnowledgeFeatures): string {
  const design = f.frames
    ? `The desk may also have the AI design a section's frame: it attaches a reference graphic if it has one (any picture it likes the look of), may add a note, and may write ONCE, in its own words, how its graphics look (the "design prompt"), so every section keeps one look. The AI is given the main frame, the reference and those words; it draws only the frame art (never the headline: the app writes that where the desk chose), and the desk's logo is laid on by the app, not drawn by the AI. A design takes about a minute and uses one AI picture: at most ${FRAME_AI_CAPS.day} a day and ${FRAME_AI_CAPS.month} a month. If the result leaves no room for the photo it is rejected and the desk can try again.`
    : `Designing frames with the AI is not switched on for this deployment: the desk uploads finished frames.`;
  return `Hawalnoos is Gituas' tool for news agencies and news pages in Iraqi Kurdistan. It collects stories from the desk's sources, the AI writes a short draft in Sorani, the desk (or the autopilot) turns it into a card with the desk's own brand, and it is published to Facebook and Instagram.

Where things are (the names are in "ui_names"):
- News: the stories that came in and their drafts; the desk edits a draft and its card there.
- Publish, Videos: posting and the videos made from stories.
- Comments, Messages, Insights: the audience side.
- Sources & filter: which sources are followed, and the filter by sections or by words.
- Automatic publishing: the autopilot (prepare drafts only, or post by itself on Facebook and Instagram), how many a day, quiet hours.
- Video settings: automatic videos, voice and speed.
- Brand & photos: colours, heading font, logo, the main frame, frames by section, and the photo library.
- Team, Settings, Billing.

Brand & photos, in detail:
- The main frame is one PNG in the shape of the card (4:5, at least 540 px wide) laid over the story photo: it has a transparent window where the photo shows. The headline goes where the desk chooses: top, middle or bottom.
- Frames by section: any section may have its own frame, and a card of a story of that section uses it. The sections are "Breaking news" (cards made as breaking news) and the same sections as the source filter: politics, economy, security, sports, health, tech, society, culture, other. A section without its own frame uses the main frame. Sections are added on that screen with the "+" buttons; each has a preview.
- A section's frame is uploaded as a finished PNG, or designed by the AI. ${design}
- Taking a section's frame away puts it back on the main frame.

What the assistant itself can do here: the desk talks to it in plain words and it does the work with its tools. It can look at the stories that came in (and read one in full), the drafts, the posts and the scheduled ones, the comments and messages, the desk's settings, plan and usage. It can refresh the news, write and improve a draft, edit a draft, make the story's card and video, publish and schedule a story to the desk's Pages, cancel a scheduled post, answer comments and messages, set the sources, keywords, categories and the news filter, set the autopilot, the video settings and the brand look, and design a section's frame. A change is shown on a card with the exact values and runs only after the desk presses Confirm, unless the desk switched on automatic changes in Settings (Chat); even then publishing a story, a message to a person, a standing automatic setting, a removal and anything after reading outside text (stories, comments, messages) always wait for Confirm. Writing a draft, making a card, publishing to Instagram and designing a frame each take up to a minute and each is its own card. A desk whose trial and plan have ended can read but not change anything. It cannot change plans, payments, keys, connected accounts or team members.
Support: WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}.`;
}
