import { CANONICAL_ORIGIN } from "./public-url.js";
import { LEGAL_ENTITY, PUBLIC_NAME, SUPPORT_EMAIL } from "./coins.js";

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
    body { margin: 0; background: #1c1412; color: #f6f1e7; font: 18px/1.45 Georgia, "Times New Roman", serif; }
    main { max-width: 40rem; margin: 0 auto; padding: 28px 18px 48px; }
    h1 { font-size: 2rem; line-height: 1.1; margin: 0 0 16px; }
    p { margin: 0 0 14px; }
    a { color: #f6f1e7; }
    nav { display: flex; gap: 16px; margin-top: 28px; }
    nav a { min-height: 44px; display: inline-flex; align-items: center; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
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

function termsBody(): string {
  return `
    <p>${escapeHtml(LEGAL_ENTITY)}, a Nevada limited liability company, does business as ${escapeHtml(PUBLIC_NAME)}.</p>
    <p>${escapeHtml(PUBLIC_NAME)} is a dominoes game. Gold Bones and other items in the store are optional digital goods. They have no cash value and are not redeemable for money.</p>
    <p>All sales are final. If a purchase was accidental or failed, email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a> and we will refund it within 14 days.</p>
    <p>You need to be 13 or older to play.</p>
  `;
}

function privacyBody(): string {
  return `
    <p>${escapeHtml(LEGAL_ENTITY)}, a Nevada limited liability company, does business as ${escapeHtml(PUBLIC_NAME)}.</p>
    <p>We collect the email address on your account if you sign in with one, your nickname, and game stats such as wins and rating.</p>
    <p>Purchases are handled by Stripe. We never see your card number.</p>
    <p>You need to be 13 or older. Settings asks for that before an account is created.</p>
    <p>Settings can delete the account. That removes the nickname, the email, and the sign-in. Wins and rating stay, under the name Deleted.</p>
    <p>Questions: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></p>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
