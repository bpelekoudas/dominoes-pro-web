import { useEffect, useRef, useState } from "react";
import { CATALOG } from "../../rules/src/catalog.js";
import { BUILD_SHA } from "./build-sha";
import { Leaderboard, ProfileStats, RankLine, type RankFacts } from "./rank";
import { AvatarFace, AvatarPicker } from "./avatars";
import { prefersRedirectSignInNow } from "./auth-surface";
import { readRememberedAge, rememberAge } from "./home-model";

export interface AccountUser extends RankFacts {
  id: string;
  displayName: string;
  avatarId: string | null;
  guest: boolean;
  providers: string[];
  ageOk?: boolean;
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
  page: "profile" | "board" | "look";
  openSheet: (page?: "profile" | "board" | "look") => void;
  closeSheet: () => void;
  showBoard: (board: "rating" | "season") => void;
  board: "rating" | "season";
  refresh: () => Promise<void>;
  ensureGuest: (displayName: string) => Promise<AccountUser | null>;
  saveName: (displayName: string) => Promise<void>;
  saveAvatar: (avatarId: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInGoogle: (idToken: string, confirm: boolean) => Promise<void>;
  signInApple: (idToken: string, confirm: boolean) => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  confirmSwitch: () => Promise<void>;
  stay: () => void;
  ageChecked: boolean;
  setAgeChecked: (checked: boolean) => void;
  askAge: () => void;
  deleteAccount: () => Promise<void>;
  tell: (message: string) => void;
}

const EMAIL_SIGNIN_UNAVAILABLE = "Email sign-in is temporarily unavailable, try Google or play as guest";

/** What the player reads when a magic-link request is refused. */
export function magicLinkNotice(status: number, error: string | undefined): string {
  if (status === 400 || status === 429) return error || "That email could not be sent.";
  // 502 was the old send failure. 503 is the clean one. An empty body
  // (a proxy page, or the old gateway text) still gets the friendly line.
  if (status === 502 || status === 503) {
    if (error && error !== "The email could not be sent. Try again in a minute.") return error;
    return EMAIL_SIGNIN_UNAVAILABLE;
  }
  return error || "That email could not be sent.";
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
  const [page, setPage] = useState<"profile" | "board" | "look">("profile");
  const [board, setBoard] = useState<"rating" | "season">("rating");
  const [ageChecked, setAgeCheckedState] = useState(readRememberedAge);
  const ageRef = useRef(readRememberedAge());
  const pending = useRef<PendingSignIn | null>(null);
  const setAgeChecked = (checked: boolean) => {
    ageRef.current = checked;
    setAgeCheckedState(checked);
    rememberAge(checked);
    if (checked) {
      void postJson("/api/account/age", { age13: true }).then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json().catch(() => ({}))) as { user?: AccountUser };
        if (body.user) remember(body.user);
      });
    }
  };
  const ageOkNow = () => Boolean(user?.ageOk) || ageRef.current;

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
      if (!ageOkNow()) {
        setNotice("Confirm you are 13 or older.");
        setSheetOpen(true);
        return;
      }
      const response = await postJson("/api/auth/google", { idToken, confirm, age13: true });
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
      if (!ageOkNow()) {
        setNotice("Confirm you are 13 or older.");
        setSheetOpen(true);
        return;
      }
      const response = await postJson("/api/auth/apple", { idToken, confirm, age13: true });
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
      const response = await postJson("/api/auth/email/consume", { token, confirm, age13: ageOkNow() });
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
      const auth = params.get("auth");
      if (auth === "claimed") {
        setNotice("That sign-in already belongs to another profile. Stay here, or sign in again and choose Continue.");
        setSheetOpen(true);
      } else if (auth === "error") {
        setNotice(params.get("message") || "That sign-in did not work.");
        setSheetOpen(true);
      }
      if (auth) params.delete("auth");
      params.delete("message");
      const emailToken = params.get("email-token");
      if (emailToken) params.delete("email-token");
      if (auth || emailToken) {
        const query = params.toString();
        history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
      }
      if (emailToken) {
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
    page,
    board,
    openSheet: (next?: "profile" | "board" | "look") => {
      setNotice(null);
      setPage(next ?? "profile");
      setSheetOpen(true);
    },
    closeSheet: () => setSheetOpen(false),
    showBoard: (next: "rating" | "season") => {
      setBoard(next);
      setPage("board");
      setSheetOpen(true);
    },
    refresh: async () => {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = (await response.json()) as { user?: AccountUser };
      if (body.user) remember(body.user);
    },
    askAge: () => {
      setError("Confirm you are 13 or older.");
      document.querySelector("[data-action=age-13]")?.scrollIntoView({ block: "center" });
    },
    setAgeChecked,
    ageChecked,
    tell: (message: string) => {
      setNotice(message);
      setSheetOpen(true);
    },
    deleteAccount: async () => {
      setBusy(true);
      setError(null);
      try {
        const response = await postJson("/api/account/delete", { confirm: true });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setError(body.error ?? "The account could not be deleted.");
          return;
        }
        localStorage.removeItem(USER_KEY);
        setUser(null);
        setConflict(null);
        pending.current = null;
        setSheetOpen(false);
        setNotice("Account deleted.");
      } finally {
        setBusy(false);
      }
    },
    ensureGuest: async (displayName) => {
      setError(null);
      if (!ageOkNow()) {
        setError("Confirm you are 13 or older.");
        document.querySelector("[data-action=age-13]")?.scrollIntoView({ block: "center" });
        return null;
      }
      const response = await postJson("/api/guest", { displayName, age13: true });
      const body = (await response.json().catch(() => ({}))) as { error?: string; user?: AccountUser };
      if (!response.ok || !body.user) {
        setError(body.error ?? "Use a name, up to 16 letters.");
        return null;
      }
      remember(body.user);
      return body.user;
    },
    saveAvatar: async (avatarId) => {
      setBusy(true);
      setNotice(null);
      try {
        const response = await postJson("/api/profile", { avatarId });
        const ok = await applyAuth(response);
        if (ok) setNotice("Look saved.");
      } finally {
        setBusy(false);
      }
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
        if (!ageOkNow()) {
          setNotice("Confirm you are 13 or older.");
          return;
        }
        const response = await postJson("/api/auth/email", { email, age13: true });
        const body = (await response.json().catch(() => ({}))) as { error?: string; devLink?: string; ok?: boolean };
        if (!response.ok) {
          setNotice(magicLinkNotice(response.status, body.error));
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
  return (
    <button type="button" className={`profile-chip${compact ? " compact" : ""}`} onClick={onOpen}>
      <AvatarFace id={user.avatarId} />
      <span className="profile-copy">
        {compact ? null : <span className="profile-name">{user.displayName}</span>}
        {typeof user.rating === "number" ? (
          <RankLine
            tierId={user.tierId}
            tierName={user.tierName}
            step={user.tierStep}
            rating={user.rating}
            provisional={user.provisional}
            compact
          />
        ) : (
          <span className="profile-name">{user.displayName}</span>
        )}
      </span>
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
  const [googleReady, setGoogleReady] = useState(false);
  const googleClientId = window.__UHOH__?.googleClientId || null;
  const appleClientId = window.__UHOH__?.appleClientId || null;
  const redirectSignIn = prefersRedirectSignInNow();
  const [appleState, setAppleState] = useState("");

  useEffect(() => {
    if (account.user) setDraft(account.user.displayName);
  }, [account.user]);

  useEffect(() => {
    if (!account.sheetOpen || !redirectSignIn) return;
    let cancel = false;
    void fetch("/api/auth/prepare-redirect", { method: "POST", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { appleState?: string } | null) => {
        if (!cancel && body?.appleState) setAppleState(body.appleState);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account.sheetOpen, redirectSignIn]);

  useEffect(() => {
    setGoogleReady(false);
    setGoogleFailed(false);
    if (!account.sheetOpen || !googleClientId || (!account.user?.ageOk && !account.ageChecked)) return;
    const parent = googleHost.current;
    if (!parent) return;
    let cancel = false;
    let watch = 0;
    let giveUp = 0;
    parent.replaceChildren();
    const painted = () => parent.querySelector("iframe") != null && parent.getBoundingClientRect().height > 20;
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        if (cancel || !parent.isConnected || !window.google?.accounts?.id) {
          if (!cancel) setGoogleFailed(true);
          return;
        }
        const redirect = prefersRedirectSignInNow();
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) void signInGoogle.current(response.credential, false);
          },
          ...(redirect ? { ux_mode: "redirect" as const, login_uri: `${location.origin}/api/auth/google/redirect` } : {}),
        });
        window.google.accounts.id.renderButton(parent, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
          width: Math.min(parent.clientWidth || 320, 360),
        });
        watch = window.setInterval(() => {
          if (cancel || !painted()) return;
          window.clearInterval(watch);
          window.clearTimeout(giveUp);
          setGoogleReady(true);
        }, 100);
        giveUp = window.setTimeout(() => {
          window.clearInterval(watch);
          if (!cancel && !painted()) setGoogleFailed(true);
        }, 4_000);
      })
      .catch(() => {
        if (!cancel) setGoogleFailed(true);
      });
    return () => {
      cancel = true;
      window.clearInterval(watch);
      window.clearTimeout(giveUp);
    };
  }, [account.sheetOpen, googleClientId, account.ageChecked, account.user?.ageOk]);

  if (!account.sheetOpen) return null;

  const startApple = async () => {
    if (!appleClientId) {
      await account.signInApple("", false);
      return;
    }
    try {
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      if (!window.AppleID) throw new Error("Apple sign-in did not load.");
      const redirect = prefersRedirectSignInNow();
      window.AppleID.auth.init({
        clientId: appleClientId,
        scope: "name email",
        redirectURI: redirect ? `${location.origin}/api/auth/apple/redirect` : `${location.origin}/`,
        usePopup: !redirect,
        state: appleState || undefined,
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
          <h2>{account.page === "board" ? "Leaderboard" : account.page === "look" ? "Your look" : account.user ? "Your profile" : "Sign in"}</h2>
          <button type="button" className="text-button" onClick={account.closeSheet}>
            Close
          </button>
        </header>
        <div className="board-switch">
          <button type="button" className={account.page === "profile" ? "primary" : "secondary"} onClick={() => account.openSheet("profile")}>
            Profile
          </button>
          <button type="button" className={account.page === "board" ? "primary" : "secondary"} onClick={() => account.showBoard(account.board)}>
            Leaderboard
          </button>
        </div>
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
        {account.page === "board" ? (
          <Leaderboard board={account.board} onBoard={account.showBoard} />
        ) : null}
        {account.page === "look" && account.user ? (
          <LookPicker selected={account.user.avatarId} onPick={(id) => void account.saveAvatar(id)} />
        ) : null}
        {account.page === "profile" && account.user ? (
          <>
            <ProfileStats user={account.user} avatarId={account.user.avatarId} />
            <button type="button" className="secondary" onClick={() => account.openSheet("look")}>
              Change look
            </button>
          </>
        ) : null}
        {account.page === "profile" && account.user ? (
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
        {account.page === "profile" && !account.user?.ageOk ? (
          <label className="age-gate">
            <input type="checkbox" checked={account.ageChecked} onChange={(event) => account.setAgeChecked(event.target.checked)} />
            I am 13 or older
          </label>
        ) : null}
        {account.page === "profile" ? (
          <div className="provider-list" data-auth-ux={redirectSignIn ? "redirect" : "popup"} data-google={googleFailed ? "failed" : googleReady ? "ready" : googleClientId ? "waiting" : "off"}>
            {googleClientId && !googleFailed && (account.user?.ageOk || account.ageChecked) ? (
              <div className="google-host" ref={googleHost} />
            ) : null}
            <button
              type="button"
              className="provider-button google"
              hidden={googleReady && !googleFailed}
              onClick={() => {
                if (googleFailed || (googleClientId && !googleReady)) {
                  account.tell("Google could not open here. Use the email link, or open this site in Safari or Chrome.");
                  return;
                }
                void account.signInGoogle("", false);
              }}
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
        ) : null}
        {account.page === "profile" && account.user ? (
          <button type="button" className="text-button sign-out" onClick={() => void account.signOut()} disabled={account.busy}>
            Sign out
          </button>
        ) : null}
        <nav className="account-legal" aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
        <p className="build-sha" data-build={BUILD_SHA}>
          {BUILD_SHA}
        </p>
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

function LookPicker({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  const starter = CATALOG.filter((item) => item.category === "character" && item.obtain === "free" && item.avatarId).map(
    (item) => item.avatarId as string,
  );
  const [allowed, setAllowed] = useState<string[]>(selected ? [...new Set([...starter, selected])] : starter);
  useEffect(() => {
    let stopped = false;
    void fetch("/api/store")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { owned?: string[]; items?: Array<{ id: string; avatarId: string | null; category: string }> } | null) => {
        if (stopped || !body) return;
        const ids = new Set(starter);
        if (selected) ids.add(selected);
        for (const item of body.items ?? []) {
          if (item.category === "character" && item.avatarId && body.owned?.includes(item.id)) ids.add(item.avatarId);
        }
        setAllowed([...ids]);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [selected]);
  return <AvatarPicker selected={selected} onPick={onPick} allowed={allowed} />;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback?: (response: { credential?: string }) => void;
            ux_mode?: "popup" | "redirect";
            login_uri?: string;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup?: boolean; state?: string }) => void;
        signIn: () => Promise<{ authorization?: { id_token?: string } }>;
      };
    };
  }
}
