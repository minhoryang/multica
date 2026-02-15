import { getLocalAuth } from "./auth-store.js";

export function getApiBaseUrl(): string {
  if (!process.env.MULTICA_API_URL) {
    throw new Error("MULTICA_API_URL is required");
  }
  return process.env.MULTICA_API_URL;
}

/**
 * Return auth headers for the proxy API.
 * Throws if the user is not logged in.
 *
 * @param context - Optional feature name appended to the error message
 *                  (e.g. "to use web search").
 */
export function getAuthHeaders(context?: string): Record<string, string> {
  const auth = getLocalAuth();
  if (!auth) {
    const suffix = context ? ` ${context}` : "";
    throw new Error(
      `Not logged in${suffix}. Sign in via the Desktop app, or run pnpm dev:local and log in there.`,
    );
  }
  return {
    sid: auth.sid,
    "device-id": auth.deviceId,
    "os-type": "3",
  };
}
