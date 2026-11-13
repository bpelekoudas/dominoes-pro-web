import { BUILD_SHA_PATTERN } from "./build-stamp";

declare const __BUILD_SHA__: string;

function readBuildSha(): string {
  const raw = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
  return BUILD_SHA_PATTERN.test(raw) ? raw : "dev0000";
}

/** The commit this page was built from. Seven characters, or dev0000 before a stamped build. */
export const BUILD_SHA = readBuildSha();
