/**
 * Session command - Manage conversation sessions
 *
 * Usage:
 *   multica session list              List all sessions
 *   multica session show <id>         Show session details
 *   multica session delete <id>       Delete a session
 */

import { existsSync, readdirSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "@multica/utils";
import { cyan, yellow, green, dim, red } from "../colors.js";

const SESSIONS_DIR = join(DATA_DIR, "sessions");

type Command = "list" | "show" | "delete" | "help";

function printHelp() {
  console.log(`
${cyan("Usage:")} multica session <command> [options]

${cyan("Commands:")}
  ${yellow("list")}                List all sessions
  ${yellow("show")} <id>           Show session details (use --show-internal to include internal messages)
  ${yellow("delete")} <id>         Delete a session
  ${yellow("help")}                Show this help

${cyan("Examples:")}
  ${dim("# List all sessions")}
  multica session list

  ${dim("# Show session details")}
  multica session show abc12345

  ${dim("# Delete a session")}
  multica session delete abc12345

  ${dim("# Resume a session")}
  multica --session abc12345
  multica chat --session abc12345
`);
}

function formatDate(date: Date): string {
  return date.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SessionInfo {
  id: string;
  path: string;
  size: number;
  mtime: Date;
  messageCount: number;
}

function getSessionInfo(sessionId: string): SessionInfo | null {
  const sessionPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(sessionPath)) {
    return null;
  }

  const stat = statSync(sessionPath);
  const content = readFileSync(sessionPath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);

  return {
    id: sessionId,
    path: sessionPath,
    size: stat.size,
    mtime: stat.mtime,
    messageCount: lines.length,
  };
}

function listSessions(): SessionInfo[] {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const files = readdirSync(SESSIONS_DIR);
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(".jsonl", "");
    const info = getSessionInfo(sessionId);
    if (info) {
      sessions.push(info);
    }
  }

  // Sort by modification time, newest first
  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return sessions;
}

function cmdList() {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
    console.log(`${dim("Sessions are stored in:")} ${SESSIONS_DIR}`);
    return;
  }

  console.log(`\n${cyan("Sessions:")}\n`);

  for (const session of sessions) {
    const shortId = session.id.slice(0, 8);
    console.log(`  ${yellow(shortId)}  ${dim(formatDate(session.mtime))}  ${dim(`${session.messageCount} msgs`)}  ${dim(formatSize(session.size))}`);
  }

  console.log(`\n${dim(`Total: ${sessions.length} session(s)`)}`);
  console.log(`${dim("Resume with:")} multica --session <id>`);
}

function cmdShow(sessionId: string | undefined, showInternal = false) {
  if (!sessionId) {
    console.error("Error: Session ID is required");
    console.error("Usage: multica session show <id>");
    process.exit(1);
  }

  // Support partial ID matching
  const sessions = listSessions();
  const matches = sessions.filter((s) => s.id.startsWith(sessionId));

  if (matches.length === 0) {
    console.error(`Error: Session "${sessionId}" not found`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`Error: Multiple sessions match "${sessionId}":`);
    for (const s of matches) {
      console.error(`  ${s.id.slice(0, 8)}`);
    }
    console.error("Please provide a more specific ID.");
    process.exit(1);
  }

  const session = matches[0]!;
  const content = readFileSync(session.path, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);

  console.log(`\n${cyan("Session:")} ${yellow(session.id)}`);
  console.log(`${dim("Path:")} ${session.path}`);
  console.log(`${dim("Size:")} ${formatSize(session.size)}`);
  console.log(`${dim("Modified:")} ${formatDate(session.mtime)}`);
  console.log(`${dim("Messages:")} ${session.messageCount}`);
  console.log("");
  console.log(cyan("─".repeat(60)));
  console.log("");

  // Parse and display messages as SessionEntry objects
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Only display message entries
      if (entry.type !== "message") continue;

      // Skip internal messages unless --show-internal
      if (entry.internal && !showInternal) continue;

      const msg = entry.message;
      if (!msg) continue;

      const role = msg.role || "unknown";
      const roleColor = role === "user" ? green : role === "assistant" ? cyan : dim;
      const internalTag = entry.internal ? dim(" [internal]") : "";

      console.log(`${roleColor(`[${role}]`)}${internalTag}`);

      if (typeof msg.content === "string") {
        // Truncate long content
        const preview = msg.content.length > 500
          ? msg.content.slice(0, 500) + "..."
          : msg.content;
        console.log(preview);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            const preview = part.text.length > 500
              ? part.text.slice(0, 500) + "..."
              : part.text;
            console.log(preview);
          } else if (part.type === "tool_use") {
            console.log(`${dim(`[Tool: ${part.name}]`)}`);
          } else if (part.type === "tool_result") {
            console.log(`${dim(`[Tool Result]`)}`);
          }
        }
      }
      console.log("");
    } catch {
      // Skip invalid JSON lines
    }
  }

  console.log(cyan("─".repeat(60)));
  console.log(`\n${dim("Resume with:")} multica --session ${session.id.slice(0, 8)}`);
}

function cmdDelete(sessionId: string | undefined) {
  if (!sessionId) {
    console.error("Error: Session ID is required");
    console.error("Usage: multica session delete <id>");
    process.exit(1);
  }

  // Support partial ID matching
  const sessions = listSessions();
  const matches = sessions.filter((s) => s.id.startsWith(sessionId));

  if (matches.length === 0) {
    console.error(`Error: Session "${sessionId}" not found`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`Error: Multiple sessions match "${sessionId}":`);
    for (const s of matches) {
      console.error(`  ${s.id.slice(0, 8)}`);
    }
    console.error("Please provide a more specific ID.");
    process.exit(1);
  }

  const session = matches[0]!;

  try {
    unlinkSync(session.path);
    console.log(`${green("Deleted:")} ${session.id}`);
  } catch (err) {
    console.error(`${red("Error:")} Failed to delete session: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export async function sessionCommand(args: string[]): Promise<void> {
  const command = (args[0] || "help") as Command;
  const arg1 = args[1];
  const showInternal = args.includes("--show-internal");

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  switch (command) {
    case "list":
      cmdList();
      break;
    case "show":
      cmdShow(arg1, showInternal);
      break;
    case "delete":
      cmdDelete(arg1);
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
