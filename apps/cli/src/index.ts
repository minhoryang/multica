#!/usr/bin/env node
/**
 * Multica CLI - Unified command-line interface
 *
 * Usage:
 *   multica                    Interactive mode (default)
 *   multica run <prompt>       Run a single prompt
 *   multica chat               Interactive mode (explicit)
 *   multica session <cmd>      Session management
 *   multica profile <cmd>      Profile management
 *   multica skills <cmd>       Skills management
 *   multica tools <cmd>        Tool policy inspection
 *   multica credentials <cmd>  Credentials management
 *   multica cron <cmd>         Scheduled task management
 *   multica dev [service]      Development servers
 *   multica help               Show help
 */

import { cyan, yellow, green, dim, brightCyan } from "./colors.js";

// Subcommand handlers (lazy imports for faster startup)
type SubcommandHandler = (args: string[]) => Promise<void>;

const subcommands: Record<string, () => Promise<SubcommandHandler>> = {
  run: async () => (await import("./commands/run.js")).runCommand,
  chat: async () => (await import("./commands/chat.js")).chatCommand,
  session: async () => (await import("./commands/session.js")).sessionCommand,
  profile: async () => (await import("./commands/profile.js")).profileCommand,
  skills: async () => (await import("./commands/skills.js")).skillsCommand,
  tools: async () => (await import("./commands/tools.js")).toolsCommand,
  credentials: async () => (await import("./commands/credentials.js")).credentialsCommand,
  dev: async () => (await import("./commands/dev.js")).devCommand,
  cron: async () => (await import("./commands/cron.js")).cronCommand,
};

function printHelp() {
  console.log(`
${brightCyan("Multica CLI")} - AI Agent Framework

${cyan("Usage:")}
  ${yellow("multica")}                         Start interactive mode (default)
  ${yellow("multica run")} <prompt>            Run a single prompt
  ${yellow("multica chat")} [options]          Start interactive mode
  ${yellow("multica session")} <command>       Manage sessions
  ${yellow("multica profile")} <command>       Manage agent profiles
  ${yellow("multica skills")} <command>        Manage skills
  ${yellow("multica tools")} <command>         Inspect tool policies
  ${yellow("multica credentials")} <command>   Manage credentials
  ${yellow("multica cron")} <command>          Manage scheduled tasks
  ${yellow("multica dev")} [service]           Start development servers
  ${yellow("multica help")}                    Show this help

${cyan("Agent Options:")} ${dim("(for run/chat)")}
  ${yellow("--profile")} ID        Load agent profile
  ${yellow("--provider")} NAME     LLM provider (openai, anthropic, kimi, etc.)
  ${yellow("--model")} NAME        Model name
  ${yellow("--system")} TEXT       System prompt
  ${yellow("--session")} ID        Resume session
  ${yellow("--cwd")} DIR           Working directory

${cyan("Commands:")}
  ${green("session")}
    list                    List all sessions
    show <id>               Show session details
    delete <id>             Delete a session

  ${green("profile")}
    list                    List all profiles
    new <id>                Create a new profile
    show <id>               Show profile contents
    edit <id>               Open profile in file manager
    delete <id>             Delete a profile

  ${green("skills")}
    list                    List all skills
    status [id]             Show skill status
    install <id>            Install skill dependencies
    add <source>            Add skill from GitHub
    remove <name>           Remove a skill

  ${green("tools")}
    list [--profile P]      List tools (with optional filter)
    groups                  Show tool groups
    profiles                Show tool profiles

  ${green("credentials")}
    init [--force]          Create credential files
    show                    Show credential paths
    edit                    Open credentials in editor

  ${green("cron")}
    status                  Show cron service status
    list                    List all scheduled jobs
    add [options]           Create a new scheduled job
    run <id>                Run a job immediately
    enable <id>             Enable a job
    disable <id>            Disable a job
    remove <id>             Delete a job
    logs <id>               Show job run logs

  ${green("dev")}
    ${dim("(default)")}              Start all services (gateway + console + web)
    gateway                 Start gateway only (:3000)
    console                 Start console only (:4000)
    web                     Start web app only (:3001)
    desktop                 Start desktop app

${cyan("Examples:")}
  ${dim("# Start interactive mode")}
  multica

  ${dim("# Run a single prompt")}
  multica run "What files are in this directory?"

  ${dim("# Use a specific profile")}
  multica chat --profile coder

  ${dim("# Resume a session")}
  multica --session abc123

  ${dim("# Start development servers")}
  multica dev
  multica dev gateway
`);
}

function printVersion() {
  // Read version from package.json would be ideal, but for now just print a placeholder
  console.log("multica 1.0.0");
}

async function main() {
  const args = process.argv.slice(2);

  // Handle global flags
  if (args.includes("--help") || args.includes("-h")) {
    // If help is requested with a subcommand, delegate to that subcommand
    const firstArg = args[0];
    if (firstArg && !firstArg.startsWith("-") && subcommands[firstArg]) {
      const handler = await subcommands[firstArg]();
      await handler(["--help"]);
      return;
    }
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    printVersion();
    return;
  }

  // Determine command
  const firstArg = args[0];

  // No args or starts with -- means interactive mode
  if (!firstArg || firstArg.startsWith("-")) {
    const chatHandler = await subcommands.chat!();
    await chatHandler(args);
    return;
  }

  // Check if it's "help" command
  if (firstArg === "help") {
    const subcommand = args[1];
    if (subcommand && subcommands[subcommand]) {
      const handler = await subcommands[subcommand]();
      await handler(["--help"]);
      return;
    }
    printHelp();
    return;
  }

  // Check if it's a known subcommand
  if (subcommands[firstArg]) {
    const handler = await subcommands[firstArg]();
    await handler(args.slice(1));
    return;
  }

  // Unknown command - show error and help
  console.error(`Unknown command: ${firstArg}`);
  console.error(`Run 'multica help' for usage information.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
