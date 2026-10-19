import { useEffect, useRef, useState } from "react";

export interface AccountUser {
  id: string;
  displayName: string;
  avatarId: string | null;
  guest: boolean;
  providers: string[];
}

interface ClaimConflict {
  current: AccountUser | null;
  existing: AccountUser;
}

type PendingSignIn =
  | { kind: "google" | "apple"; idToken: string }
  | { kind: "email"; token: string };

const USER_KEY = "uhoh.user";
const startedEmailTokens = new Set<string>();

export interface AccountController {
  user: AccountUser | null;
  ready: boolean;
  sheetOpen: boolean;
  notice: string | null;
  error: string | null;
  devLink: string | null;
  conflict: ClaimConflict | null;
  busy: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  ensureGuest: (displayName: string) => Promise<AccountUser | null>;
  saveName: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInGoogle: (idToken: string, confirm: boolean) => Promise<void>;
  signInApple: (idToken: string, confirm: boolean) => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  confirmSwitch: () => Promise<void>;
  stay: () => void;
}

export function useAccount(): AccountController {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ClaimConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<PendingSignIn | null>(null);

  const remember = (next: AccountUser) => {
    setUser(next);
    localStorage.setItem(USER_KEY, next.id);
  };

  const applyAuth = async (response: Response): Promise<boolean> => {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      outcome?: string;
      user?: AccountUser;
      current?: AccountUser | null;
      existing?: AccountUser;
    };
    if (response.status === 409 && body.outcome === "already-claimed" && body.existing) {
      setConflict({ current: body.current ?? null, existing: body.existing });
      setSheetOpen(true);
      setNotice(null);
      return false;
    }
    if (!response.ok) {
      setNotice(body.error ?? "That sign-in did not work.");
      setSheetOpen(true);
      return false;
    }
    if (body.user) remember(body.user);
    setConflict(null);
    pending.current = null;
    setNotice(null);
    setError(null);
    return true;
  };

  const signInGoogle = async (idToken: string, confirm: boolean) => {
    pending.current = { kind: "google", idToken };
    setBusy(true);
    try {
      const response = await postJson("/api/auth/google", { idToken, confirm });
      const ok = await applyAuth(response);
      if (ok) setSheetOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const signInApple = async (idToken: string, confirm: boolean) => {
    pending.current = { kind: "apple", idToken };
    setBusy(true);
    try {
      const response = await postJson("/api/auth/apple", { idToken, confirm });
      const ok = await applyAuth(response);
      if (ok) setSheetOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const consumeEmail = async (token: string, confirm: boolean) => {
    pending.current = { kind: "email", token };
    setBusy(true);
    try {
      const response = await postJson("/api/auth/email/consume", { token, confirm });
      const ok = await applyAuth(response);
      if (ok) setSheetOpen(false);
      else setSheetOpen(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const params = new URLSearchParams(location.search);
      const emailToken = params.get("email-token");
      if (emailToken) {
        params.delete("email-token");
        const query = params.toString();
        history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
        if (!startedEmailTokens.has(emailToken)) {
          startedEmailTokens.add(emailToken);
          await consumeEmail(emailToken, false);
        }
      }
      if (stopped) return;
      const response = await fetch("/api/me", { credentials: "same-origin" });
      if (stopped) return;
      if (response.ok) {
        const body = (await response.json()) as { user?: AccountUser };
        if (body.user) remember(body.user);
      } else if (!emailToken) {
        localStorage.removeItem(USER_KEY);
        setUser(null);
      }
      if (!stopped) setReady(true);
    };
    void load();
    return () => {
      stopped = true;
    };
    // consumeEmail is stable enough for the first paint; the token guard stops a second send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    user,
    ready,
    sheetOpen,
    notice,
    error,
    devLink,
    conflict,
    busy,
    openSheet: () => {
      setNotice(null);
      setSheetOpen(true);
    },
    closeSheet: () => setSheetOpen(false),
    ensureGuest: async (displayName) => {
      setError(null);
      const response = await postJson("/api/guest", { displayName });
      const body = (await response.json().catch(() => ({}))) as { error?: string; user?: AccountUser };
      if (!response.ok || !body.user) {
        setError(body.error ?? "Use a name, up to 16 letters.");
        return null;
      }
      remember(body.user);
      return body.user;
    },
    saveName: async (displayName) => {
      setBusy(true);
      setNotice(null);
      try {
        const response = await postJson("/api/profile", { displayName });
        const ok = await applyAuth(response);
        if (ok) setNotice("Name saved.");
      } finally {
        setBusy(false);
      }
    },
    signOut: async () => {
      setBusy(true);
      try {
        await postJson("/api/logout", {});
        localStorage.removeItem(USER_KEY);
        setUser(null);
        setConflict(null);
        pending.current = null;
        setDevLink(null);
        setNotice(null);
        setSheetOpen(false);
      } finally {
        setBusy(false);
      }
    },
    signInGoogle,
    signInApple,
    requestMagicLink: async (email) => {
      setBusy(true);
      setNotice(null);
      setDevLink(null);
      try {
        const response = await postJson("/api/auth/email", { email });
        const body = (await response.json().catch(() => ({}))) as { error?: string; devLink?: string; ok?: boolean };
        if (!response.ok) {
          setNotice(body.error ?? "That email could not be sent.");
          return;
        }
        if (body.devLink) {
          setDevLink(body.devLink);
          setNotice("Email is not hooked up yet. Use this test link. It works once.");
          return;
        }
        setNotice("Check your email for a sign-in link. It works once and lasts 15 minutes.");
      } finally {
        setBusy(false);
      }
    },
    confirmSwitch: async () => {
      const next = pending.current;
      if (!next) return;
      if (next.kind === "email") await consumeEmail(next.token, true);
      else if (next.kind === "google") await signInGoogle(next.idToken, true);
      else await signInApple(next.idToken, true);
    },
    stay: () => {
      setConflict(null);
      pending.current = null;
    },
  };
}

export function AccountChip({
  user,
  compact,
  onOpen,
}: {
  user: AccountUser;
  compact?: boolean;
  onOpen: () => void;
}) {
  const letter = user.displayName.trim().charAt(0).toUpperCase() || "?";
  return (
    <button type="button" className={`profile-chip${compact ? " compact" : ""}`} onClick={onOpen}>
      <span className="avatar" aria-hidden="true">
        {letter}
      </span>
      <span className="profile-name">{user.displayName}</span>
    </button>
  );
}

export function AccountLayer({ account }: { account: AccountController }) {
  const googleHost = useRef<HTMLDivElement | null>(null);
  const signInGoogle = useRef(account.signInGoogle);
  signInGoogle.current = account.signInGoogle;
  const [draft, setDraft] = useState(account.user?.displayName ?? "");
  const [email, setEmail] = useState("");
  const [googleFailed, setGoogleFailed] = useState(false);
  const googleClientId = window.__UHOH__?.googleClientId || null;
  const appleClientId = window.__UHOH__?.appleClientId || null;

  useEffect(() => {
    if (account.user) setDraft(account.user.displayName);
  }, [account.user]);

  useEffect(() => {
    if (!account.sheetOpen || !googleClientId) return;
    const parent = googleHost.current;
    if (!parent) return;
    let cancel = false;
    parent.replaceChildren();
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        if (cancel || !parent || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) void signInGoogle.current(response.credential, false);
          },
        });
        window.google.accounts.id.renderButton(parent, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
          width: Math.min(parent.clientWidth || 320, 360),
        });
      })
      .catch(() => {
        if (!cancel) setGoogleFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [account.sheetOpen, googleClientId]);

  if (!account.sheetOpen) return null;

  const startApple = async () => {
    if (!appleClientId) {
      await account.signInApple("", false);
      return;
    }
    try {
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      if (!window.AppleID) throw new Error("Apple sign-in did not load.");
      window.AppleID.auth.init({
        clientId: appleClientId,
        scope: "name email",
        redirectURI: `${location.origin}/`,
        usePopup: true,
      });
      const result = await window.AppleID.auth.signIn();
      await account.signInApple(result.authorization?.id_token ?? "", false);
    } catch {
      // A cancelled Apple popup throws. Leave the sheet open.
    }
  };

  return (
    <>
      <button type="button" className="chat-scrim account-scrim" aria-label="Close account" onClick={account.closeSheet} />
      <section className="account-sheet" role="dialog" aria-label="Your account">
        <header>
          <h2>{account.user ? "Your profile" : "Sign in"}</h2>
          <button type="button" className="text-button" onClick={account.closeSheet}>
            Close
          </button>
        </header>
        {account.user?.guest ? (
          <p className="hint">Signing in keeps this name and the games on this phone.</p>
        ) : null}
        {account.conflict ? (
          <div className="banner" data-account-conflict="true">
            <p>
              {account.conflict.existing.displayName} already uses that sign-in. Continue as{" "}
              {account.conflict.existing.displayName}?
            </p>
            <div className="account-row">
              <button type="button" className="secondary" onClick={account.stay} disabled={account.busy}>
                Stay
              </button>
              <button type="button" className="primary" onClick={() => void account.confirmSwitch()} disabled={account.busy}>
                Continue
              </button>
            </div>
          </div>
        ) : null}
        {account.notice ? <p className="banner">{account.notice}</p> : null}
        {account.devLink ? (
          <p className="dev-link">
            <a href={account.devLink}>Open the test link</a>
          </p>
        ) : null}
        {account.user ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void account.saveName(draft);
            }}
          >
            <label>
              Display name
              <input value={draft} maxLength={16} autoComplete="nickname" onChange={(event) => setDraft(event.target.value)} />
            </label>
            <button className="primary" type="submit" disabled={account.busy || !draft.trim()}>
              Save name
            </button>
          </form>
        ) : null}
        <div className="provider-list">
          {googleClientId && !googleFailed ? <div className="google-host" ref={googleHost} /> : null}
          <button
            type="button"
            className="provider-button google"
            hidden={Boolean(googleClientId) && !googleFailed}
            onClick={() => void account.signInGoogle("", false)}
          >
            Sign in with Google
          </button>
          <button type="button" className="provider-button apple" onClick={() => void startApple()} disabled={account.busy}>
            Sign in with Apple
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void account.requestMagicLink(email);
            }}
          >
            <label>
              Email
              <input
                type="email"
                value={email}
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button className="primary" type="submit" disabled={account.busy || !email.trim()}>
              Email me a link
            </button>
          </form>
        </div>
        {account.user ? (
          <button type="button" className="text-button sign-out" onClick={() => void account.signOut()} disabled={account.busy}>
            Sign out
          </button>
        ) : null}
      </section>
    </>
  );
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function loadScript(src: string): Promise<void> {
  const found = document.querySelector(`script[src="${src}"]`);
  if (found) {
    if (found.getAttribute("data-loaded") === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      found.addEventListener("load", () => resolve(), { once: true });
      found.addEventListener("error", () => reject(new Error("script")), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.setAttribute("data-loaded", "1");
      resolve();
    };
    script.onerror = () => reject(new Error("script"));
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
        signIn: () => Promise<{ authorization?: { id_token?: string } }>;
      };
    };
  }
}
