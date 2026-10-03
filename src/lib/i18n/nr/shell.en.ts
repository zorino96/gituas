import type { nrShellCkb } from "./shell.ckb";

/** "1 day" / "12 days", with Western digits. */
function days(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`;
}

/** "1 desk" / "3 desks". */
function desks(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "desk" : "desks"}`;
}

// The newsroom's shell text in English: exactly the keys of shell.ckb.ts. Wired into en.ts as `nr.shell`.
// The product name stays in Latin letters. News drafts and cards stay Sorani whatever the UI language.
export const nrShellEn: typeof nrShellCkb = {
  name: "Hawalnoos",
  signIn: "Sign in",
  signOut: "Sign out",

  desk: {
    metaDescription: "Stories, cards and publishing for your channel",
    trialLeft: (n: number) => `${days(n)} left in your free trial —`,
    frozen: "Your free trial has ended. You can still read the stories, but writing and publishing are paused.",
    choosePlan: "Choose a plan",
    switchLabel: (name: string) => `Desk: ${name} — switch`,
    newDesk: "New desk",
    notReady: "Your account isn't ready. Reload the page.",
    retry: "Try again",
  },

  nav: {
    groups: { desk: "News desk", audience: "Audience", account: "Channel" },
    items: {
      news: "News",
      publish: "Publish",
      comments: "Comments",
      messages: "Messages",
      insights: "Insights",
      team: "Team",
      settings: "Settings",
      guide: "Guide",
    },
    sideLabel: "Hawalnoos sections",
    barLabel: "Sections",
    more: "More",
    all: "All sections",
    close: "Close",
    help: "Guide for this section",
    helpTitle: "Guide",
  },

  landing: {
    metaDescription:
      "Your channel's newsroom on social media: cards in your own brand, published to every platform from one place.",
    title: "Your channel's newsroom, on every platform",
    lead: "Turn a story into a card in your own brand and publish it to Facebook, Instagram and TikTok from one place.",
    start: "Get started",
    how: "How does it work?",
    promise: "Nothing is published without your approval.",
    features: {
      cards: {
        title: "Cards in your channel's brand",
        body: "Your logo and colors, in a font you choose, on every card, in four types: standard, breaking, stat and quote.",
      },
      ai: {
        title: "Kurdish summaries with AI",
        body: "In seconds, a story becomes a Kurdish headline and text, ready to post. You edit and approve it.",
      },
      platforms: {
        title: "One place for every platform",
        body: "Publish to Facebook, Instagram and TikTok from a single page.",
      },
      audience: {
        title: "Comments, messages and insights",
        body: "Reply to your audience and see which story got the most comments, without switching between apps.",
      },
      team: {
        title: "Your team together",
        body: "Editor, editor-in-chief and owner, each with their own role. Several desks for several languages or brands.",
      },
    },
  },

  shopNotice: {
    pickDesk: "You're in your shop right now. Choose a news desk:",
    noDesk:
      "This account has a shop. With the same account you can also create a separate newsroom, with its own plan and billing, free for 14 days.",
    nameLabel: "Channel or page name",
    creating: "Creating…",
    create: "Create my newsroom",
    goDesk: (name: string) => `Go to “${name}”`,
    newRoom: "New newsroom",
  },

  newDesk: {
    title: "New desk",
    sub: "A separate desk for another language, section or brand of your channel. Each desk has its own pages, sources, brand and team.",
    full: (n: number) => `Your plan includes ${desks(n)}, and ${n === 1 ? "it is" : "all of them are"} in use. Contact us for more desks.`,
    nameLabel: "Desk name",
    namePlaceholder: "e.g. Arabic section",
    creating: "Creating…",
    create: "Create desk",
    signInAgain: "Sign in again.",
    nameMissing: "Enter a name for the desk, up to 60 characters.",
    limit: "You've reached your plan's desk limit.",
  },

  join: {
    metaTitle: "Invitation — Hawalnoos",
    notFound: "This invitation wasn't found or has been withdrawn.",
    used: "This invitation has already been used.",
    goNewsroom: "Go to Hawalnoos",
    expired: "This invitation has expired. Ask the desk owner for a new one.",
    title: (desk: string) => `Invitation to “${desk}”`,
    as: (role: string) => `as ${role}`,
    signIn: "Sign in",
    signUp: "Create a new account",
    sameEmail: "Sign in or sign up with the same email address shown above.",
    otherBefore: "You're signed in as",
    otherAfter: "— this invitation is for a different email address.",
    unverified:
      "This account's email address hasn't been verified yet. We'll send a code to your email. Once you set a new password, your email is verified and you can join the desk.",
    verify: "Verify my email",
    wait: "Please wait…",
    enter: "Join the desk",
    switchAccount: "Sign in with a different account",
    signInFirst: "Sign in first.",
    gone: "This invitation is no longer valid.",
    wrongEmail: "This invitation is for a different email address.",
    full: "All seats on this desk are taken. Tell the desk owner.",
  },

  guide: {
    metaTitle: "Guide — Hawalnoos",
    metaDescription: "How to get your channel started in Hawalnoos: connecting pages, brand, sources, cards and publishing.",
    title: "Hawalnoos guide",
    sub: "Everything you need to get your channel up and running in a day.",
    toc: "Contents",
    sections: {
      start: {
        title: "What is Hawalnoos?",
        intro:
          "Hawalnoos is your channel's newsroom on social media. You see the news, AI drafts a short Kurdish summary from it, you turn it into a card in your own brand, and you publish it to Facebook, Instagram and TikTok from one place.",
        steps: [
          "Connect your pages.",
          "Add your channel's logo and colors.",
          "Choose your sources and keywords.",
          "Open a story, create its card and publish it.",
        ],
      },
      connect: {
        title: "Connect your pages",
        intro: "To publish, read comments and see insights, connect your channel's pages to Gituas.",
        steps: [
          "Go to “Settings” → “Accounts”.",
          "Next to Facebook, Instagram or TikTok, press “Connect”.",
          "In the platform's window, choose your channel's page and allow access.",
          "If Instagram doesn't connect, make sure your account is a professional one (business or creator).",
        ],
        link: "Go to Settings",
      },
      brand: {
        title: "Your channel's brand",
        intro: "Every card is made with your channel's logo, colors and font.",
        steps: [
          "In “Settings” → “Brand”, upload your “Logo” (PNG, JPG or WEBP).",
          "Choose the “Main color”, “Accent color” and “Text color”.",
          "To pick colors from your own images, open “Reference image” or “My logo”, choose which color to set, then click on the image or pick one of the main colors below it.",
          "Choose the headline font: “Kufi” or “Standard”.",
          "Press “Save brand”. You'll see a sample card right there.",
        ],
        link: "Set up your brand",
      },
      sources: {
        title: "Sources and keywords",
        intro:
          "Stories come from the sources you turn on: world, regional, Kurdish and official sources, plus search by keywords.",
        steps: [
          "In “Settings” → “Sources”, turn on the sources you want. Each source's language is shown next to it.",
          "For GDELT, enter keywords in several languages, for example: Erbil, Hewlêr, Arbil.",
          "In “Topics”, choose which topics to bring in, for example only politics and economy. If you choose none, you get all of them.",
          "If you only want stories related to your keywords, turn on the keyword filter for RSS.",
          "You can also add the RSS feed of another source. Only add feeds you have the right to use.",
        ],
        link: "Set up sources",
      },
      stories: {
        title: "From story to card",
        intro:
          "In “News”, stories are in three tabs: “New”, “Ready” and “Published”. Filter them by topic, region, language and source.",
        steps: [
          "Open a story. A Kurdish summary is drafted automatically (up to 20 seconds).",
          "Edit the “Headline” and “Body”.",
          "Choose the card type: “Standard”, “Breaking”, “Stat” or “Quote”.",
          "Add a photo from your channel with “Your own photo”. No photo is ever taken from the sources.",
          "If you don't like the text, press “Improve”. To remove the story, press “Dismiss”.",
          "Press “Prepare to publish”.",
        ],
        link: "Go to News",
      },
      publish: {
        title: "Publishing",
        intro: "The Publish page opens with the card and its text. Nothing is published without your click.",
        steps: [
          "Choose the pages and accounts you want to publish to.",
          "Read the post text and edit it if needed.",
          "For TikTok, choose who can view the post. By publishing, you agree to TikTok's music usage terms.",
          "Press “Publish”. The result for each platform is shown separately.",
        ],
        link: "Go to Publish",
      },
      comments: {
        title: "Comments and messages",
        intro:
          "See and reply to the comments on your posts and your audience's messages on Facebook and Instagram, all in one place.",
        steps: [
          "Open “Comments” for comments on your posts.",
          "Open “Messages” for private messages.",
          "Write your reply and send it. It appears on the platform right away.",
        ],
        link: "Go to Comments",
      },
      insights: {
        title: "Insights",
        intro: "See your pages' overall numbers and the posts that got the most comments.",
        steps: ["Open “Insights”.", "Look at the posts with the most comments, and publish more stories like them."],
        link: "Go to Insights",
      },
      team: {
        title: "Team and roles",
        intro: "Invite your colleagues. Each person's role decides what they can do.",
        steps: [
          "“Owner”: everything, including the team and the plan.",
          "“Editor-in-chief”: publishing, replying to comments and messages, and setting up sources and brand.",
          "“Editor”: prepares stories and cards, but can't publish them.",
          "In “Team”, enter an email address and a role, then press “Invite”. The link is sent by email, and you can also copy it and send it yourself.",
          "The invited person must sign in with the same email address. The link works for 7 days.",
          "For another desk, for example an Arabic section, press the desk name at the top and choose “New desk”.",
        ],
        link: "Go to Team",
      },
      faq: {
        title: "Frequently asked questions",
        intro: "Answers to the questions channels ask most.",
        qa: [
          {
            q: "Will anything be published without my knowledge?",
            a: "No. Every post needs your click on the Publish page.",
          },
          {
            q: "Why is the text sometimes rewritten?",
            a: "If the summary is too close to the source's text, it's rewritten automatically, so you don't publish another outlet's words under your name.",
          },
          {
            q: "Are the sources' photos used?",
            a: "No. Only the photos you upload yourself are used.",
          },
          {
            q: "How many stories can I prepare per month?",
            a: "It depends on your plan. This month's count is shown at the bottom of the “News” page.",
          },
          {
            q: "How do I delete my account and data?",
            a: "Read the data deletion page. It explains how.",
          },
        ],
        link: "Data deletion",
      },
    },
  },
};
