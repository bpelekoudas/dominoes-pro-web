/// <reference types="vite/client" />

interface UhOhConfig {
  showScoreMath?: boolean;
  publicUrl?: string;
  googleClientId?: string | null;
  appleClientId?: string | null;
}

interface Window {
  __UHOH__?: UhOhConfig;
}
