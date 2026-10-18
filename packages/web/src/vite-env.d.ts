/// <reference types="vite/client" />

interface UhOhConfig {
  showScoreMath?: boolean;
}

interface Window {
  __UHOH__?: UhOhConfig;
}
