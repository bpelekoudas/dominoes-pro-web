/// <reference types="vite/client" />

interface UhOhConfig {
  showScoreMath?: boolean;
  publicUrl?: string;
}

interface Window {
  __UHOH__?: UhOhConfig;
}
