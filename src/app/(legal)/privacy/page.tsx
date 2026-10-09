import type { Metadata } from "next";
import { Updated, Lead, H2, P, UL, LI, Strong, InLink, ExtLink } from "../prose";

export const metadata: Metadata = {
  title: "Privacy Policy · Gituas",
  description: "How Gituas and Hawalnoos collect, use, store, and delete your data.",
};

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-display text-4xl md:text-5xl leading-tight">Privacy Policy</h1>
      <Updated date="October 10, 2026" />

      <Lead>
        This policy covers Gituas (gituas.com), a tool for shops and creators to publish to their own
        social accounts and answer their buyers, and Hawalnoos (hawalnoos.com), our newsroom service
        for news outlets. Both are run by the same team (&ldquo;Gituas,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;). It explains what data we collect, why, who processes it, and how you can
        delete it.
      </Lead>

      <H2>1. Who we are</H2>
      <P>
        Gituas lets a business connect its Facebook Pages, Instagram, TikTok and YouTube accounts and
        its WhatsApp Business number, publish posts and videos to them, and answer comments and
        messages from buyers, by hand or automatically. Hawalnoos lets a news outlet turn news stories
        into drafts, image cards and short videos and publish them to its own pages. We are the data
        controller for the information described below. For any privacy question, contact us at{" "}
        <ExtLink href="mailto:hello@gituas.com">hello@gituas.com</ExtLink>.
      </P>

      <H2>2. Information we collect</H2>
      <UL>
        <LI>
          <Strong>Account data.</Strong> Your name, email address and profile picture. You can sign in
          with an email and password (we store only a one-way scrypt hash of the password), with Google,
          or with GitHub, in which case we receive the name, email, picture and account ID that provider
          shares. Sign-in codes are sent to your email.
        </LI>
        <LI>
          <Strong>Connected-account credentials.</Strong> When you connect an account (Facebook Page,
          Instagram, TikTok, YouTube, WhatsApp Business, and on older plans X, LinkedIn or Reddit), we
          receive and store the access and refresh tokens that platform issues. They are encrypted at
          rest (see &sect;6).
        </LI>
        <LI>
          <Strong>Connected-account profile data.</Strong> The account&rsquo;s name, ID and picture, used
          to show you which account is connected and to publish to the right one.
        </LI>
        <LI>
          <Strong>Shop data.</Strong> The products, prices, photos and settings you enter, and the orders
          your buyers place, including the name, phone number and delivery address a buyer gives.
        </LI>
        <LI>
          <Strong>Buyer comments and messages.</Strong> When you turn on comments, messages or shop
          automation, we receive the comments on your posts and the direct messages and WhatsApp
          messages people send to your accounts: the text, any media they attach, and the sender&rsquo;s
          name, handle or phone number and ID. We use them to show you the conversation and to send the
          replies you or your automations authorize.
        </LI>
        <LI>
          <Strong>Content you create.</Strong> Drafts, captions, images, videos, news cards, schedules
          and the photo and video libraries you upload.
        </LI>
        <LI>
          <Strong>Insights.</Strong> Performance figures for your own accounts and posts (such as reach,
          views, likes and follower counts), read from the platform to show you your results.
        </LI>
        <LI>
          <Strong>Billing data.</Strong> Your plan and invoices. Payments are made through Wayl; we never
          see or store card details.
        </LI>
        <LI>
          <Strong>Usage and device data.</Strong> Log data such as IP address, browser type and actions
          taken, used for security and reliability.
        </LI>
      </UL>

      <H2>3. How we use your information</H2>
      <UL>
        <LI>To provide the service: draft, schedule and publish the content you choose.</LI>
        <LI>To publish to your connected accounts strictly within the permissions you grant.</LI>
        <LI>
          To answer your buyers when you turn on shop automation: we read each new comment or message,
          work out what the buyer is asking (for example a price or an order), and send the reply your
          settings call for.
        </LI>
        <LI>To operate, secure, debug and improve the service.</LI>
        <LI>To communicate with you about your account and changes to the service.</LI>
      </UL>
      <P>
        We do <Strong>not</Strong> sell personal information, and we never use platform data or buyer
        messages for advertising, profiling, or any purpose other than operating the features you
        turn on.
      </P>

      <H2>4. TikTok</H2>
      <P>
        When you connect TikTok, we access your data through the TikTok API only to (a) show which
        account is connected and (b) upload and publish the videos and photo posts you start yourself.
        TikTok is never posted to automatically. We request only the scopes these features need (
        <code className="text-fg">user.info.basic</code> and{" "}
        <code className="text-fg">video.publish</code>). Our use and transfer of information received
        from TikTok adheres to the{" "}
        <ExtLink href="https://developers.tiktok.com/doc/tiktok-api-platform-terms">
          TikTok Developer Terms of Service
        </ExtLink>{" "}
        and applicable platform policies.
      </P>

      <H2>4a. Facebook, Instagram and Meta</H2>
      <P>
        When you connect a Facebook Page through Facebook Login, or an Instagram professional account
        through Instagram Login, we access your data through the Meta Platform only to (a) confirm the
        connected account, (b) publish the posts, Reels and stories you or your automations authorize,
        (c) read and reply to comments and direct messages, and (d) read Page, account and media
        insights. We request only the permissions these features need: for Pages,{" "}
        <code className="text-fg">pages_show_list</code>,{" "}
        <code className="text-fg">pages_read_engagement</code>,{" "}
        <code className="text-fg">pages_manage_posts</code>,{" "}
        <code className="text-fg">pages_manage_engagement</code>,{" "}
        <code className="text-fg">pages_manage_metadata</code>,{" "}
        <code className="text-fg">pages_messaging</code> and{" "}
        <code className="text-fg">read_insights</code>; for Instagram,{" "}
        <code className="text-fg">instagram_business_basic</code>,{" "}
        <code className="text-fg">instagram_business_content_publish</code>,{" "}
        <code className="text-fg">instagram_business_manage_comments</code>,{" "}
        <code className="text-fg">instagram_business_manage_messages</code> and{" "}
        <code className="text-fg">instagram_business_manage_insights</code>. Direct messages are used{" "}
        <Strong>only</Strong> to respond to people who message you first or comment on your posts,
        within the platform&rsquo;s permitted messaging window; we never send unsolicited messages. Our
        use of information received from the Meta Platforms adheres to the{" "}
        <ExtLink href="https://developers.facebook.com/terms/">Meta Platform Terms</ExtLink> and{" "}
        <ExtLink href="https://developers.facebook.com/devpolicy/">Developer Policies</ExtLink>.
      </P>

      <H2>4b. Google and YouTube</H2>
      <P>
        When you connect a YouTube channel, Gituas uses YouTube API Services. We request only{" "}
        <code className="text-fg">youtube.upload</code> (to publish the videos you authorize, each with
        the title, description, privacy and audience you choose) and{" "}
        <code className="text-fg">youtube.readonly</code> (to confirm which channel is connected and to
        read public statistics such as view, like, and comment counts for your own videos). We do not
        read your subscriptions, watch history, or private playlists, and we never post to a channel
        without an action you authorized.
      </P>
      <P>
        By connecting a channel you also agree to the{" "}
        <ExtLink href="https://www.youtube.com/t/terms">YouTube Terms of Service</ExtLink>. Information
        Gituas receives from Google APIs is handled in accordance with the{" "}
        <ExtLink href="https://policies.google.com/privacy">Google Privacy Policy</ExtLink>.
      </P>
      <P>
        <Strong>Limited Use.</Strong> Gituas&rsquo; use and transfer of information received from Google
        APIs adheres to the{" "}
        <ExtLink href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </ExtLink>
        , including its Limited Use requirements. Specifically, we use this data only to provide and
        improve the features you enabled; we do not transfer it to third parties except as necessary
        to provide those features, to comply with applicable law, or as part of a merger or
        acquisition; we do not use it for advertising or to build advertising profiles; and we do not
        allow humans to read it, except with your explicit consent, to resolve a support issue you
        raised, for security purposes, or where required by law.
      </P>
      <P>
        You can revoke Gituas&rsquo; access to your Google account at any time from{" "}
        <ExtLink href="https://myaccount.google.com/permissions">
          your Google account permissions page
        </ExtLink>{" "}
        (also reachable through the{" "}
        <ExtLink href="https://security.google.com/settings/security/permissions">Google security settings page</ExtLink>
        ), or by disconnecting the channel in Settings, which deletes the stored tokens.
        Information obtained through YouTube API Services is handled as follows: statistics of your own
        videos are read live and never stored; your channel id, title and picture are kept only while the
        channel is connected, and are checked and refreshed with YouTube every day; links to and ids of
        videos Gituas uploaded for you are kept for at most 30 days. Every day we also confirm that you
        still authorize Gituas, and if you removed its access in your Google Account the connection and
        its data are deleted. When you disconnect a channel in Gituas or ask us to delete your data
        (see <InLink href="/data-deletion">Data Deletion</InLink>), that channel&rsquo;s data is deleted
        within 7 days.
      </P>

      <H2>4c. WhatsApp</H2>
      <P>
        When you connect a WhatsApp Business number, Gituas receives the messages people send to that
        number, their WhatsApp phone number and profile name, and the delivery status of replies. We use
        them <Strong>only</Strong> to show the conversation to you and to send the replies you or your
        automations authorize, within WhatsApp&rsquo;s customer-service window. Message templates can only
        be sent to a person who has messaged your number first, and never while their latest message
        asks you to stop (for example &ldquo;STOP&rdquo;). We never send bulk or unsolicited messages,
        never sell or share message content, and never use it for advertising or profiling. Messages are
        kept while the number stays connected and are deleted when you disconnect it, or within 30 days
        of a deletion request. Use of WhatsApp is also subject to the{" "}
        <ExtLink href="https://www.whatsapp.com/legal/business-terms">WhatsApp Business Terms of Service</ExtLink>{" "}
        and the{" "}
        <ExtLink href="https://business.whatsapp.com/policy">WhatsApp Business Messaging Policy</ExtLink>.
      </P>

      <H2>5. Who processes your information</H2>
      <P>We share data only with the service providers that run Gituas and Hawalnoos for us:</P>
      <UL>
        <LI>
          <Strong>AI processing.</Strong> kurd.gg (Pawan.Krd), an AI gateway that passes requests to
          model providers such as Anthropic, with DeepSeek and Google (Gemini) as fallbacks. We send
          them: the text of buyer comments, direct messages and WhatsApp messages, with your product
          names and prices, so they can tell what the buyer is asking and help word the reply; the
          content you are drafting; and, for news, the public headline and summary of a story. Sender
          phone numbers and account tokens are never sent to them; we send only what each task needs.
        </LI>
        <LI>
          <Strong>Voice-over.</Strong> Pawan.Krd text-to-speech reads the script of a news video aloud.
        </LI>
        <LI>
          <Strong>Hosting and storage.</Strong> Vercel (the application and uploaded files, through
          Vercel Blob) and Neon (the database).
        </LI>
        <LI>
          <Strong>Video rendering.</Strong> GitHub Actions builds news videos from the story text, card
          images and the outlet&rsquo;s own clips.
        </LI>
        <LI>
          <Strong>Scheduling and domains.</Strong> Cloudflare runs our domain names and a timer that
          starts background jobs; no personal data passes through it.
        </LI>
        <LI><Strong>Email.</Strong> Resend sends sign-in codes and account emails.</LI>
        <LI><Strong>Payments.</Strong> Wayl processes plan payments.</LI>
        <LI>
          <Strong>Connected platforms.</Strong> Meta (Facebook, Instagram, WhatsApp), TikTok, YouTube,
          and where connected X, LinkedIn and Reddit, to which we send the content and requests you
          authorize.
        </LI>
      </UL>
      <P>
        We may also disclose information if required by law or to protect the rights, safety, and
        security of our users and the service. We never sell personal data.
      </P>

      <H2>6. Where data is stored, and security</H2>
      <P>
        Our database and files are stored on managed infrastructure in the United States and the
        European Union. AI providers may process the text we send them in other countries, including
        China (DeepSeek). All third-party access tokens are encrypted at rest using AES-256-GCM before
        being written to the database, and are decrypted only in memory at the moment an action you
        authorized is performed. Access to production systems is restricted and logged.
      </P>

      <H2>7. Data retention</H2>
      <P>
        We keep your data for as long as your account is active. When you disconnect an account, we
        delete its access tokens at once, together with the comments and messages we stored from it,
        and YouTube data as described in &sect;4b. When you ask us to delete your account, we delete
        your personal data and connected-account data within 30 days (7 days for YouTube data), except
        limited records we must keep by law, such as invoices.
      </P>

      <H2>8. Your rights and choices</H2>
      <UL>
        <LI>Access, correct, or export your personal data.</LI>
        <LI>Disconnect any account at any time in Settings, which deletes our stored tokens.</LI>
        <LI>Delete your account and all associated data &mdash; see <InLink href="/data-deletion">Data Deletion</InLink>.</LI>
      </UL>
      <P>
        Wherever you live, including Iraq and the Kurdistan Region, you can exercise these rights by
        emailing <ExtLink href="mailto:hello@gituas.com">hello@gituas.com</ExtLink>. You may have
        additional rights under laws such as the GDPR or CCPA.
      </P>

      <H2>9. Cookies</H2>
      <P>
        We use only essential cookies, to keep you signed in and to secure your session. We do not use
        advertising or tracking cookies. One exception: the page where you connect a WhatsApp number
        loads Meta&rsquo;s Facebook SDK to run Meta&rsquo;s sign-up window, and Meta may set its own
        cookies there under the{" "}
        <ExtLink href="https://www.facebook.com/privacy/policies/cookies/">Meta Cookies Policy</ExtLink>.
      </P>

      <H2>10. Children</H2>
      <P>
        Gituas and Hawalnoos are not directed to anyone under 16, and we do not knowingly collect data
        from children. If you believe a child has provided us data, contact us and we will delete it.
      </P>

      <H2>11. Changes to this policy</H2>
      <P>
        We may update this policy as the service evolves. We will revise the &ldquo;Last
        updated&rdquo; date above and, for material changes, notify you in-app or by email.
      </P>

      <H2>12. Contact</H2>
      <P>
        Questions or requests: <ExtLink href="mailto:hello@gituas.com">hello@gituas.com</ExtLink>.
        See also our <InLink href="/terms">Terms of Service</InLink> and{" "}
        <InLink href="/data-deletion">Data Deletion</InLink> instructions.
      </P>
    </article>
  );
}
