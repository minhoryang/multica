import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "@multica/utils";

const AUTH_FILE_PATH = join(DATA_DIR, "auth.json");
const DEV_AUTH_FILE_PATH = join(homedir(), ".super-multica-dev", "auth.json");

export type LocalAuthData = { sid: string; deviceId: string };

function tryReadAuth(filePath: string): LocalAuthData | null {
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.sid !== "string" ||
      !data.sid ||
      typeof data.deviceId !== "string" ||
      !data.deviceId
    ) {
      return null;
    }

    return { sid: data.sid, deviceId: data.deviceId };
  } catch {
    return null;
  }
}

/**
 * Read sid and deviceId from auth.json.
 *
 * Lookup order:
 * 1. {DATA_DIR}/auth.json (current data dir, respects SMC_DATA_DIR)
 * 2. ~/.super-multica-dev/auth.json (dev environment fallback —
 *    allows E2E tests and other custom SMC_DATA_DIR setups to
 *    share the dev auth created by `pnpm dev:local`)
 *
 * Returns null if no valid auth is found.
 */
export function getLocalAuth(): LocalAuthData | null {
  const primary = tryReadAuth(AUTH_FILE_PATH);
  if (primary) return primary;

  // Fallback to dev auth when using a custom data dir (e.g. E2E tests)
  if (AUTH_FILE_PATH !== DEV_AUTH_FILE_PATH) {
    return tryReadAuth(DEV_AUTH_FILE_PATH);
  }

  return null;
}
