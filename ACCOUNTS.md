# Accounts

Anyone can play right away as a guest. A nickname is enough. The server creates a guest profile and remembers that phone with a cookie, so the same phone keeps the same guest, the same name, and (later) the same rank and cosmetics.

Sign in is optional. It claims that guest. The user id does not change, so games already stored on that guest stay with them. There is no password.

## What Bryan can try before any keys are pasted

On the live site, type a nickname and tap **Continue as guest**, **Create room**, or **Play vs computer**. Come back on the same phone and the name should still be there.

**Sign in** opens Google, Apple, and email. Until the keys below are set, Google and Apple answer that they are not configured yet. Email, while score math is still on and Resend is not set, shows a one-time test link in the sheet and prints that same link in the Render log. The link lasts 15 minutes and works once. After Resend is set, the link is only emailed.

**Sign out** ends the account on this phone. It does not kick you out of a hand you already sat down in.

Set `SESSION_SECRET` in Render when you can (a long random string, at least 16 characters). If it is missing, the server saves one on the disk and keeps running. A brand-new disk without that variable signs everyone out and gives them a new guest.

## Env vars

Paste these in the Render service. Do not commit the values.

| Name | Needed for |
| --- | --- |
| `SESSION_SECRET` | Signing the login cookie. Recommended on Render. |
| `GOOGLE_CLIENT_ID` | Sign in with Google |
| `APPLE_CLIENT_ID` | Sign in with Apple (the Services ID) |
| `APPLE_TEAM_ID` | Sign in with Apple |
| `APPLE_KEY_ID` | Sign in with Apple |
| `APPLE_PRIVATE_KEY` | Sign in with Apple (the whole `.p8` PEM, including the BEGIN and END lines) |
| `RESEND_API_KEY` | Emailing the magic link |
| `EMAIL_FROM` | The From address Resend is allowed to send as |

`SHOW_SCORE_MATH` stays as it is. Do not set `NODE_ENV` in `render.yaml`.

## Google

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Under **Authorized JavaScript origins**, add `https://uhoh-dominoes.onrender.com`. When the custom domain is ready, add `https://uhohdominoes.com` as well.
3. Copy the client id into `GOOGLE_CLIENT_ID`.

The server checks Google's signed ID token. It does not need a client secret for this.

## Apple

1. In the Apple Developer account, turn on Sign in with Apple and create a Services ID. That Services ID is `APPLE_CLIENT_ID`.
2. Register the domain and set the return URL to `https://uhoh-dominoes.onrender.com/` (and later `https://uhohdominoes.com/`).
3. Create a Sign in with Apple key. The key id is `APPLE_KEY_ID`. The team id is `APPLE_TEAM_ID`. Download the `.p8` file once and paste its PEM text into `APPLE_PRIVATE_KEY`.

All four values have to be present or the Apple button stays in the "not configured" state. This version checks Apple's ID token with Apple's public keys. The private key is stored so the setup is complete; it is not written to the log.

## Email (Resend)

1. Create a Resend API key and set `RESEND_API_KEY`.
2. Verify the domain you will send from, then set `EMAIL_FROM` to an address on that domain.

Until both are set, production with score math off refuses email sign-in. The live site currently has score math on, so the test link is shown until Resend is filled in. When Resend is set, the link is not returned to the browser and is not printed in the log.

Magic-link requests are limited to 5 per email and 20 per IP address in each 15-minute window.

## Edge cases

**This sign-in already belongs to someone else.** If Google, Apple, or an email is already attached to a different profile (including the same email address on another provider), the phone stays on the current guest and asks before switching. Continue uses the older profile. The guest row is left in place. A hand already in progress keeps the account that sat down; the next table uses the account you continued as. Nothing is overwritten quietly.

**A magic link opened on a different phone.** The link signs in the profile that asked for it. Treat the link like a key and don't forward it.

**Names.** The nickname typed at the table is the display name. Google and Apple do not replace it. The name can be edited later from the profile chip.
