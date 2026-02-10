/**
 * CLI Credentials Reader
 *
 * Read OAuth credentials from external CLI tools:
 * - Claude Code: ~/.claude/.credentials.json or macOS Keychain
 * - Codex: ~/.codex/auth.json or macOS Keychain
 *
 * Based on OpenClaw's implementation.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================
// Types
// ============================================================

export type OAuthCredential = {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  expires: number;
};

export type TokenCredential = {
  type: "token";
  provider: string;
  token: string;
  expires: number;
};

export type ClaudeCliCredential = (OAuthCredential | TokenCredential) & {
  provider: "anthropic";
};

export type CodexCliCredential = OAuthCredential & {
  provider: "openai-codex";
  accountId?: string;
};

// ============================================================
// Paths
// ============================================================

const CLAUDE_CLI_CREDENTIALS_PATH = ".claude/.credentials.json";
const CLAUDE_CLI_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_CLI_KEYCHAIN_ACCOUNT = "Claude Code";

const CODEX_CLI_AUTH_FILENAME = "auth.json";
const CODEX_CLI_KEYCHAIN_SERVICE = "Codex Auth";

function resolveHomePath(relativePath: string): string {
  const home = os.homedir();
  return path.join(home, relativePath);
}

function resolveCodexHomePath(): string {
  const configured = process.env.CODEX_HOME;
  const home = configured ? configured.replace(/^~/, os.homedir()) : resolveHomePath(".codex");
  try {
    return fs.realpathSync(home);
  } catch {
    return home;
  }
}

function computeCodexKeychainAccount(codexHome: string): string {
  const hash = createHash("sha256").update(codexHome).digest("hex");
  return `cli|${hash.slice(0, 16)}`;
}

// ============================================================
// Claude Code Credentials
// ============================================================

function readClaudeCliKeychainCredentials(): ClaudeCliCredential | null {
  if (process.platform !== "darwin") return null;

  try {
    const result = execSync(
      `security find-generic-password -s "${CLAUDE_CLI_KEYCHAIN_SERVICE}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const data = JSON.parse(result.trim());
    const claudeOauth = data?.claudeAiOauth;
    if (!claudeOauth || typeof claudeOauth !== "object") return null;

    const accessToken = claudeOauth.accessToken;
    const refreshToken = claudeOauth.refreshToken;
    const expiresAt = claudeOauth.expiresAt;

    if (typeof accessToken !== "string" || !accessToken) return null;
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null;

    if (typeof refreshToken === "string" && refreshToken) {
      return {
        type: "oauth",
        provider: "anthropic",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      };
    }

    return {
      type: "token",
      provider: "anthropic",
      token: accessToken,
      expires: expiresAt,
    };
  } catch {
    return null;
  }
}

function readClaudeCliFileCredentials(): ClaudeCliCredential | null {
  const credPath = resolveHomePath(CLAUDE_CLI_CREDENTIALS_PATH);

  try {
    if (!fs.existsSync(credPath)) return null;
    const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;

    const claudeOauth = raw.claudeAiOauth;
    if (!claudeOauth || typeof claudeOauth !== "object") return null;

    const accessToken = claudeOauth.accessToken;
    const refreshToken = claudeOauth.refreshToken;
    const expiresAt = claudeOauth.expiresAt;

    if (typeof accessToken !== "string" || !accessToken) return null;
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null;

    if (typeof refreshToken === "string" && refreshToken) {
      return {
        type: "oauth",
        provider: "anthropic",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      };
    }

    return {
      type: "token",
      provider: "anthropic",
      token: accessToken,
      expires: expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Read Claude Code CLI credentials.
 * Priority: macOS Keychain > File (~/.claude/.credentials.json)
 */
export function readClaudeCliCredentials(): ClaudeCliCredential | null {
  // Try keychain first (macOS only)
  const keychainCreds = readClaudeCliKeychainCredentials();
  if (keychainCreds) return keychainCreds;

  // Fall back to file
  return readClaudeCliFileCredentials();
}

/**
 * Check if Claude Code credentials exist and are valid.
 */
export function hasValidClaudeCliCredentials(): boolean {
  const creds = readClaudeCliCredentials();
  if (!creds) return false;
  // Check if not expired (with 5 minute buffer)
  return creds.expires > Date.now() + 5 * 60 * 1000;
}

/**
 * Get the access token from Claude Code credentials.
 */
export function getClaudeCliAccessToken(): string | null {
  const creds = readClaudeCliCredentials();
  if (!creds) return null;
  if (creds.type === "oauth") return creds.access;
  if (creds.type === "token") return creds.token;
  return null;
}

// ============================================================
// Codex CLI Credentials
// ============================================================

function readCodexKeychainCredentials(): CodexCliCredential | null {
  if (process.platform !== "darwin") return null;

  const codexHome = resolveCodexHomePath();
  const account = computeCodexKeychainAccount(codexHome);

  try {
    const secret = execSync(
      `security find-generic-password -s "${CODEX_CLI_KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    const parsed = JSON.parse(secret);
    const tokens = parsed.tokens;
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;
    if (typeof accessToken !== "string" || !accessToken) return null;
    if (typeof refreshToken !== "string" || !refreshToken) return null;

    const lastRefreshRaw = parsed.last_refresh;
    const lastRefresh =
      typeof lastRefreshRaw === "string" || typeof lastRefreshRaw === "number"
        ? new Date(lastRefreshRaw).getTime()
        : Date.now();
    const expires = Number.isFinite(lastRefresh)
      ? lastRefresh + 60 * 60 * 1000
      : Date.now() + 60 * 60 * 1000;

    return {
      type: "oauth",
      provider: "openai-codex",
      access: accessToken,
      refresh: refreshToken,
      expires,
      accountId: typeof tokens?.account_id === "string" ? tokens.account_id : undefined,
    };
  } catch {
    return null;
  }
}

function readCodexFileCredentials(): CodexCliCredential | null {
  const authPath = path.join(resolveCodexHomePath(), CODEX_CLI_AUTH_FILENAME);

  try {
    if (!fs.existsSync(authPath)) return null;
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;

    const tokens = raw.tokens;
    if (!tokens || typeof tokens !== "object") return null;

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    if (typeof accessToken !== "string" || !accessToken) return null;
    if (typeof refreshToken !== "string" || !refreshToken) return null;

    let expires: number;
    try {
      const stat = fs.statSync(authPath);
      expires = stat.mtimeMs + 60 * 60 * 1000;
    } catch {
      expires = Date.now() + 60 * 60 * 1000;
    }

    return {
      type: "oauth",
      provider: "openai-codex",
      access: accessToken,
      refresh: refreshToken,
      expires,
      accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Read Codex CLI credentials.
 * Priority: macOS Keychain > File (~/.codex/auth.json)
 */
export function readCodexCliCredentials(): CodexCliCredential | null {
  // Try keychain first (macOS only)
  const keychainCreds = readCodexKeychainCredentials();
  if (keychainCreds) return keychainCreds;

  // Fall back to file
  return readCodexFileCredentials();
}

/**
 * Check if Codex credentials exist and are valid.
 */
export function hasValidCodexCliCredentials(): boolean {
  const creds = readCodexCliCredentials();
  if (!creds) return false;
  return creds.expires > Date.now() + 5 * 60 * 1000;
}

/**
 * Get the access token from Codex credentials.
 */
export function getCodexCliAccessToken(): string | null {
  const creds = readCodexCliCredentials();
  if (!creds) return null;
  return creds.access;
}

// ============================================================
// Unified Interface
// ============================================================

export type CliCredentialSource = "claude-code" | "codex";

export interface CliCredentialStatus {
  source: CliCredentialSource;
  available: boolean;
  expires?: number;
  expiresIn?: string;
}

/**
 * Get status of all CLI credential sources.
 */
export function getCliCredentialStatus(): CliCredentialStatus[] {
  const results: CliCredentialStatus[] = [];

  // Claude Code
  const claudeCreds = readClaudeCliCredentials();
  if (claudeCreds) {
    const expiresIn = claudeCreds.expires - Date.now();
    results.push({
      source: "claude-code",
      available: expiresIn > 0,
      expires: claudeCreds.expires,
      expiresIn: formatDuration(expiresIn),
    });
  } else {
    results.push({ source: "claude-code", available: false });
  }

  // Codex
  const codexCreds = readCodexCliCredentials();
  if (codexCreds) {
    const expiresIn = codexCreds.expires - Date.now();
    results.push({
      source: "codex",
      available: expiresIn > 0,
      expires: codexCreds.expires,
      expiresIn: formatDuration(expiresIn),
    });
  } else {
    results.push({ source: "codex", available: false });
  }

  return results;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
