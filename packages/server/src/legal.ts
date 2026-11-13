import { CANONICAL_ORIGIN } from "./public-url.js";
import { PUBLIC_NAME, SUPPORT_EMAIL } from "./coins.js";

/** Printed in full once. Later sentences use the company name alone. */
const ENTITY = "Ironwood Hills, LLC dba Uh-Oh Dominoes";
const ENTITY_SHORT = "Ironwood Hills, LLC";
/**
 * The pages are static HTML, so they cannot learn the merge date on their own.
 * November 2026 is the month this draft is meant to go live.
 */
const EFFECTIVE = "November 2026";

export type LegalPage = "terms" | "privacy";

export function legalHtml(page: LegalPage): string {
  const title = page === "terms" ? "Terms" : "Privacy";
  const body = page === "terms" ? termsBody() : privacyBody();
  const canonical = `${CANONICAL_ORIGIN}/${page}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · ${escapeHtml(PUBLIC_NAME)}</title>
  <link rel="canonical" href="${canonical}">
  <style>
    body { margin: 0; background: #1c1412; color: #f6f1e7; font: 17px/1.5 system-ui, sans-serif; }
    main { max-width: 40rem; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 1.7rem; line-height: 1.15; margin: 0 0 12px; }
    h2 { font-size: 1.15rem; line-height: 1.3; margin: 22px 0 8px; }
    p, li { margin: 0 0 12px; overflow-wrap: anywhere; }
    ul { margin: 0 0 12px; padding-left: 1.2rem; }
    a { color: #f6f1e7; }
    .draft { background: #3a2a18; border: 1px solid #d5a336; border-radius: 12px; padding: 12px 14px; margin: 0 0 16px; }
    nav { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 28px; }
    nav a { min-height: 44px; display: inline-flex; align-items: center; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="draft">Draft for review. This is not legal advice.</p>
    ${body}
    <nav>
      <a href="/">Back to the table</a>
      <a href="${page === "terms" ? "/privacy" : "/terms"}">${page === "terms" ? "Privacy" : "Terms"}</a>
    </nav>
  </main>
</body>
</html>
`;
}

function mailLink(): string {
  const email = escapeHtml(SUPPORT_EMAIL);
  return `<a href="mailto:${email}">${email}</a>`;
}

function termsBody(): string {
  return `
    <p>These terms are between you and ${escapeHtml(ENTITY)}. They start in ${escapeHtml(EFFECTIVE)}.</p>
    <h2>The game</h2>
    <p>${escapeHtml(PUBLIC_NAME)} is a dominoes game you play in a browser. You need to be 13 or older.</p>
    <h2>Bones and Gold Bones</h2>
    <p>Bones are earned by playing. Gold Bones can be bought with a card through Stripe. Neither can be transferred to another player, sold, or cashed out. They have no cash value and are not redeemable for money.</p>
    <p>If a Gold Bones purchase was accidental or the payment went through and the bones did not arrive, email ${mailLink()} within 14 days.</p>
    <h2>Table talk</h2>
    <p>Chat is for the people at your table. Do not harass anyone, post anyone's private information, or try to break the game. We can remove a message or an account that does.</p>
    <h2>Your account</h2>
    <p>You can play as a guest, or sign in with Google, Apple, or an email link. There is no password. Signing in from a guest seat keeps that guest's name and games on the account you join, unless that sign-in already belongs to someone else. You choose before switching.</p>
    <p>Settings can delete the account. That removes the nickname, the email, and the sign-in. Wins and rating stay, under the name Deleted. To ask about your data, email ${mailLink()}.</p>
    <h2>The service</h2>
    <p>The game is provided as it is. It can stop, change, or lose a hand when a phone drops. ${escapeHtml(ENTITY_SHORT)} is not liable for that beyond what the law already requires.</p>
    <p>These terms follow the laws of Utah, without regard to conflict-of-law rules.</p>
    <p>Questions: ${mailLink()}</p>
  `;
}

function privacyBody(): string {
  return `
    <p>This notice is from ${escapeHtml(ENTITY)}. It starts in ${escapeHtml(EFFECTIVE)}. Questions go to ${mailLink()}.</p>
    <h2>What we store</h2>
    <ul>
      <li>A nickname you choose, up to 16 letters. A Google or Apple profile name and picture are not saved. A new email account may start from the part of the address before the @.</li>
      <li>An email address if you use Google, Apple, or an email link, and the provider's account id.</li>
      <li>A player id, guest or signed-in, plus game stats: rating, wins, losses, season points, and accuracy.</li>
      <li>Table talk: the preset lines and the text you type, with the room and the seat.</li>
      <li>A bug report you choose to send: what you wrote, an optional screenshot, the build, room, seat, hand, player id, device and user agent, viewport, and recent error lines. Other players do not see it.</li>
      <li>Short error notes from the page and the server, with the build and the room when we have one. An email address in that text is removed before it is stored.</li>
      <li>Counts of visits, texted invites, and play-again taps. Those counts have no nickname and no email.</li>
      <li>A sign-in cookie on this site, and a few values in local storage on your phone: the seat token, whether you said you are 13 or older, and sound settings.</li>
      <li>If you buy Gold Bones, Stripe handles the card. We store the pack and that the payment completed. We never see your card number.</li>
    </ul>
    <p>We do not use a third-party tracker, an ads pixel, or an analytics vendor.</p>
    <h2>Age</h2>
    <p>You need to be 13 or older. The game asks you to confirm that before an account is created.</p>
    <h2>Deletion and requests</h2>
    <p>Settings can delete the account. That removes the nickname, the email, and the sign-in. Wins and rating stay, under the name Deleted. Bug reports tied to that account are deleted. Email ${mailLink()} to ask for a copy or a correction.</p>
    <h2>Where it lives</h2>
    <p>The game file is a SQLite database on the server's disk at Render. Hosting is in the United States.</p>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
