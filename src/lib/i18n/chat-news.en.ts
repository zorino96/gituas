import type { chatNewsCkb } from "./chat-news.ckb";

// The news desk's wording of the chat, in English: exactly the keys of chat-news.ckb.ts; no Arabic-script text.
export const chatNewsEn: typeof chatNewsCkb = {
  sidebar: {
    classic: "Hawalnoos sections",
  },

  screen: {
    assistant: "Hawalnoos",
  },

  empty: {
    hello: "Hi! What can I do for your news desk today?",
    sub: "Tell me what you need in your own words: I find stories, get the text and the card ready, or look at your comments and settings. For anything that matters, like publishing, I show you a card to approve before it happens.",
    examples: [
      "What new stories are there today?",
      "Show me the stories that are ready to publish",
      "Get today's most important story ready to post",
      "Show me the comments I have not answered",
      "How is automatic publishing set up?",
      "How did my pages do this week?",
    ],
  },

  quick: {
    today: { label: "Today", lead: "Here is your desk today." },
    stories: { label: "New stories", lead: "These are the newest stories." },
    ready: { label: "Ready to publish", lead: "These are ready to publish." },
    comments: { label: "Comments", lead: "These comments have no reply yet." },
    messages: { label: "Messages", lead: "These messages have no reply yet." },
    scheduled: { label: "Scheduled", lead: "These posts are scheduled." },
    check: { label: "Check everything", lead: "Here is what I checked on your desk:" },
  },

  errors: {
    forbidden: "Your role may not use the chat. Ask the desk's owner or editor-in-chief.",
    workspace: "This screen belongs to another desk you were in. Reload the page.",
    frozen: "The trial or the plan of this desk has ended, so typed messages are paused. The quick buttons still work, and with them you can look at stories, comments and messages. Choose a plan to continue.",
  },

  runs: {
    tainted: "This card came after reading text written by others (stories, comments or messages): check the values before you confirm.",
    // A desk has no AI allowance: what its chat spends is the plan's monthly count of stories, videos and frames.
    risk: { money: "Counts against this month's limit in your plan" },
  },

  settings: {
    levels: {
      LOW: {
        help: "Small, easy changes (like changing keywords, topics or sources, or switching “Auto drafts” on or off) it does by itself. Auto drafts, once on, prepare drafts on their own within your plan's monthly limit and publish nothing. Anything else that uses AI (writing a story, a video, a frame), becomes public (a post, the design and logo), sends a message to a person, removes something, or keeps acting later on its own (like “Auto publish”) still gets a card. If the chat has read stories, comments or messages, everything in that answer and the next one gets a card.",
      },
      ALL: {
        help: "Small changes (switching “Auto drafts” on or off included), what uses AI in a simple way (like a video) and what becomes public (like scheduling a post, the design and logo, or the writing style) it does by itself. Auto drafts, once on, prepare drafts on their own within your plan's monthly limit and publish nothing. Writing and improving a story, making a card, publishing right now, designing a frame, messages and replies to people, things that keep acting later on their own (like “Auto publish”) and removing something always get a card. If the chat has read stories, comments or messages, everything in that answer and the next one gets a card.",
      },
    },
    ownerOnly: "Only the owner and the editor-in-chief can change this.",
    deleteHelp: "Deletes all your chats in this desk and cannot be undone. Other people's chats are not deleted.",
    retention: "What the chat looked up (stories, comments, messages) is blanked after 1 day. The tables and the values on cards are removed after 30 days, and a chat nobody uses for 180 days is deleted.",
    frozenNote: "This desk's trial or plan has ended, so the chat can only read now: with the quick buttons it shows stories, comments and messages, but it changes and publishes nothing. Choose a plan to get typed chat back.",
  },
};
