/**
 * Chat command - Interactive REPL mode
 *
 * Usage:
 *   multica chat [options]
 *   multica [options]  (default command)
 */

import * as readline from "readline";
import { Agent } from "@multica/core";
import type { AgentOptions } from "@multica/core";
import { SkillManager } from "@multica/core";
import { autocompleteInput, type AutocompleteOption } from "../autocomplete.js";
import { colors, dim, cyan, brightCyan, yellow, green, gray, red } from "../colors.js";
import {
  getProviderList,
  getCurrentProvider,
  getLoginInstructions,
  getProviderMeta,
  type ProviderInfo,
} from "@multica/core";

type ChatOptions = {
  profile?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  system?: string | undefined;
  thinking?: string | undefined;
  cwd?: string | undefined;
  session?: string | undefined;
  help?: boolean;
};

const COMMANDS = {
  help: "Show this help message",
  exit: "Exit the CLI (aliases: quit, q)",
  clear: "Clear the current session and start fresh",
  session: "Show current session ID",
  new: "Start a new session",
  multiline: "Toggle multi-line input mode (end with a line containing only '.')",
  provider: "Show current provider and available options",
  model: "Show or switch model (usage: /model [model-name])",
};

function printHelp() {
  console.log(`
${cyan("Usage:")} multica chat [options]
       multica [options]

${cyan("Options:")}
  ${yellow("--profile")} ID        Load agent profile
  ${yellow("--provider")} NAME     LLM provider (openai, anthropic, kimi, etc.)
  ${yellow("--model")} NAME        Model name
  ${yellow("--system")} TEXT       System prompt (ignored if --profile set)
  ${yellow("--thinking")} LEVEL    Thinking level
  ${yellow("--cwd")} DIR           Working directory
  ${yellow("--session")} ID        Session ID to resume
  ${yellow("--help")}, -h          Show this help

${cyan("Interactive Commands:")}
`);
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${yellow(`/${cmd}`.padEnd(14))} ${dim(desc)}`);
  }
  console.log();
}

function parseArgs(argv: string[]): ChatOptions {
  const args = [...argv];
  const opts: ChatOptions = {};

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      break;
    }
    if (arg === "--profile") {
      opts.profile = args.shift();
      continue;
    }
    if (arg === "--provider") {
      opts.provider = args.shift();
      continue;
    }
    if (arg === "--model") {
      opts.model = args.shift();
      continue;
    }
    if (arg === "--system") {
      opts.system = args.shift();
      continue;
    }
    if (arg === "--thinking") {
      opts.thinking = args.shift();
      continue;
    }
    if (arg === "--cwd") {
      opts.cwd = args.shift();
      continue;
    }
    if (arg === "--session") {
      opts.session = args.shift();
      continue;
    }
  }

  return opts;
}

function printWelcome(sessionId: string, opts: ChatOptions) {
  const border = cyan("│");
  const topBorder = cyan("╭─────────────────────────────────────────╮");
  const bottomBorder = cyan("╰─────────────────────────────────────────╯");

  console.log(topBorder);
  console.log(`${border}     ${brightCyan("Super Multica Interactive CLI")}       ${border}`);
  console.log(bottomBorder);

  // Show configuration
  const configLines: string[] = [];
  configLines.push(`${dim("Session:")} ${gray(sessionId.slice(0, 8))}...`);
  if (opts.profile) {
    configLines.push(`${dim("Profile:")} ${yellow(opts.profile)}`);
  }
  if (opts.provider) {
    configLines.push(`${dim("Provider:")} ${green(opts.provider)}`);
  }
  if (opts.model) {
    configLines.push(`${dim("Model:")} ${green(opts.model)}`);
  }

  console.log(configLines.join("  "));
  console.log(`${dim("Type")} ${cyan("/help")} ${dim("for commands,")} ${cyan("/exit")} ${dim("to quit.")}`);
  console.log("");
}

function printCommandHelp(skillManager?: SkillManager) {
  console.log(`\n${cyan("Built-in commands:")}`);
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${yellow(`/${cmd}`.padEnd(14))} ${dim(desc)}`);
  }

  // Show skill commands if available
  if (skillManager) {
    const reservedNames = new Set(Object.keys(COMMANDS));
    const skillCommands = skillManager.getSkillCommands({ reservedNames });
    if (skillCommands.length > 0) {
      console.log(`\n${cyan("Skill commands:")}`);
      for (const cmd of skillCommands) {
        console.log(`  ${yellow(`/${cmd.name}`.padEnd(14))} ${dim(cmd.description)}`);
      }
    }
  }

  console.log(`\n${dim("Just type your message and press Enter to chat with the agent.")}`);
  console.log("");
}

/**
 * Status Bar - renders a persistent status line at the bottom of the terminal
 */
class StatusBar {
  private enabled: boolean;
  private currentStatus: string = "";
  private stream: NodeJS.WriteStream;

  constructor(stream: NodeJS.WriteStream = process.stdout) {
    this.stream = stream;
    this.enabled = stream.isTTY === true;
  }

  update(parts: { session?: string; provider?: string; model?: string; tokens?: number }) {
    if (!this.enabled) return;

    const segments: string[] = [];

    if (parts.session) {
      segments.push(`${dim("session:")}${gray(parts.session.slice(0, 8))}`);
    }
    if (parts.provider) {
      segments.push(`${dim("provider:")}${green(parts.provider)}`);
    }
    if (parts.model) {
      segments.push(`${dim("model:")}${yellow(parts.model)}`);
    }
    if (parts.tokens !== undefined) {
      segments.push(`${dim("tokens:")}${cyan(String(parts.tokens))}`);
    }

    this.currentStatus = segments.join("  ");
    this.render();
  }

  private render() {
    if (!this.enabled || !this.currentStatus) return;

    const termWidth = this.stream.columns || 80;
    const termHeight = this.stream.rows || 24;

    const statusLine = ` ${this.currentStatus} `.slice(0, termWidth);

    this.stream.write(
      `\x1b[s` + // Save cursor
      `\x1b[${termHeight};1H` + // Move to last row
      `\x1b[7m` + // Inverse video
      `\x1b[2K` + // Clear line
      statusLine.padEnd(termWidth) +
      `\x1b[0m` + // Reset
      `\x1b[u` // Restore cursor
    );
  }

  clear() {
    if (!this.enabled) return;

    const termHeight = this.stream.rows || 24;

    this.stream.write(
      `\x1b[s` +
      `\x1b[${termHeight};1H` +
      `\x1b[2K` +
      `\x1b[u`
    );
    this.currentStatus = "";
  }

  hide() {
    this.clear();
  }

  show() {
    this.render();
  }
}

class InteractiveCLI {
  private agent: Agent;
  private opts: ChatOptions;
  private rl: readline.Interface | null = null;
  private multilineMode = false;
  private multilineBuffer: string[] = [];
  private running = true;
  private skillManager: SkillManager;
  private reservedNames: Set<string>;
  private statusBar: StatusBar;

  constructor(opts: ChatOptions) {
    this.opts = opts;
    this.agent = this.createAgent(opts.session);
    this.statusBar = new StatusBar();

    this.skillManager = new SkillManager({
      profileId: opts.profile,
    });

    this.reservedNames = new Set(Object.keys(COMMANDS));

    process.on("SIGINT", () => {
      this.statusBar.clear();
      console.log(`\n${dim("Goodbye!")}`);
      process.exit(0);
    });
  }

  private getReadline(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      this.rl.on("close", () => {
        this.running = false;
        this.statusBar.clear();
        console.log(`\n${dim("Goodbye!")}`);
        process.exit(0);
      });
    }
    return this.rl;
  }

  private closeReadline() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private getSuggestions(input: string): AutocompleteOption[] {
    if (!input.startsWith("/")) {
      return [];
    }

    const prefix = input.slice(1).toLowerCase();
    const suggestions: AutocompleteOption[] = [];

    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      if (cmd.toLowerCase().startsWith(prefix)) {
        suggestions.push({
          value: `/${cmd}`,
          label: desc.slice(0, 40),
        });
      }
    }

    const skillCommands = this.skillManager.getSkillCommands({ reservedNames: this.reservedNames });
    for (const cmd of skillCommands) {
      if (cmd.name.toLowerCase().startsWith(prefix)) {
        suggestions.push({
          value: `/${cmd.name}`,
          label: cmd.description.slice(0, 40),
        });
      }
    }

    suggestions.sort((a, b) => {
      if (a.value.length !== b.value.length) return a.value.length - b.value.length;
      return a.value.localeCompare(b.value);
    });

    return suggestions;
  }

  private createAgent(sessionId?: string): Agent {
    return new Agent({
      profileId: this.opts.profile,
      provider: this.opts.provider,
      model: this.opts.model,
      systemPrompt: this.opts.system,
      thinkingLevel: this.opts.thinking as AgentOptions["thinkingLevel"],
      cwd: this.opts.cwd,
      sessionId,
    });
  }

  private prompt(): string {
    if (this.multilineMode) {
      return this.multilineBuffer.length === 0 ? cyan(">>> ") : cyan("... ");
    }
    return `${brightCyan("You:")} `;
  }

  private updateStatusBar() {
    const statusUpdate: { session?: string; provider?: string; model?: string; tokens?: number } = {
      session: this.agent.sessionId,
      provider: this.opts.provider ?? "default",
    };
    if (this.opts.model) {
      statusUpdate.model = this.opts.model;
    }
    this.statusBar.update(statusUpdate);
  }

  async run() {
    printWelcome(this.agent.sessionId, this.opts);
    this.updateStatusBar();
    await this.loop();
  }

  private async loop() {
    while (this.running) {
      let input: string;

      if (this.multilineMode) {
        const lineInput = await this.readline(this.prompt());
        if (lineInput === null) break;
        input = lineInput;

        if (input === ".") {
          const fullInput = this.multilineBuffer.join("\n");
          this.multilineBuffer = [];
          this.multilineMode = false;
          this.closeReadline();
          if (fullInput.trim()) {
            await this.handleInput(fullInput);
          }
        } else {
          this.multilineBuffer.push(input);
        }
        continue;
      }

      try {
        this.statusBar.hide();
        input = await autocompleteInput({
          prompt: this.prompt(),
          getSuggestions: (text) => this.getSuggestions(text),
          maxSuggestions: 8,
        });
        this.statusBar.show();
      } catch {
        break;
      }

      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("/")) {
        const handled = await this.handleCommand(trimmed);
        if (!handled) {
          await this.handleInput(trimmed);
        }
      } else {
        await this.handleInput(trimmed);
      }
    }
  }

  private readline(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.getReadline().question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  private async handleCommand(input: string): Promise<boolean> {
    const cmd = input.slice(1).toLowerCase().split(/\s+/)[0];

    switch (cmd) {
      case "help":
        printCommandHelp(this.skillManager);
        return true;

      case "exit":
      case "quit":
      case "q":
        this.statusBar.clear();
        console.log(dim("Goodbye!"));
        this.running = false;
        this.closeReadline();
        process.exit(0);
        return true;

      case "clear":
        this.agent = this.createAgent();
        this.updateStatusBar();
        console.log(`${green("Session cleared.")} ${dim("New session:")} ${gray(this.agent.sessionId.slice(0, 8))}...\n`);
        return true;

      case "session":
        console.log(`${dim("Current session:")} ${cyan(this.agent.sessionId)}\n`);
        return true;

      case "new":
        this.agent = this.createAgent();
        this.updateStatusBar();
        console.log(`${green("Started new session:")} ${gray(this.agent.sessionId.slice(0, 8))}...\n`);
        return true;

      case "multiline":
        this.multilineMode = !this.multilineMode;
        if (this.multilineMode) {
          console.log(`${green("Multi-line mode enabled.")} ${dim("End input with a line containing only '.'")}`);
          this.multilineBuffer = [];
        } else {
          console.log(dim("Multi-line mode disabled."));
          this.multilineBuffer = [];
          this.closeReadline();
        }
        return true;

      case "provider":
        this.showProviderStatus();
        return true;

      case "model":
        this.handleModelCommand(input);
        return true;

      default:
        const invocation = this.skillManager.resolveCommand(input);
        if (invocation) {
          const skillPrompt = invocation.args
            ? `[Skill: ${invocation.command.name}]\n\n${invocation.instructions}\n\nUser request: ${invocation.args}`
            : `[Skill: ${invocation.command.name}]\n\n${invocation.instructions}`;
          await this.handleInput(skillPrompt);
          return true;
        }
        return false;
    }
  }

  private handleModelCommand(input: string) {
    const parts = input.trim().split(/\s+/);
    const modelArg = parts.slice(1).join(" ").trim();
    const currentProvider = this.opts.provider ?? getCurrentProvider();
    const providerMeta = getProviderMeta(currentProvider);

    if (!providerMeta) {
      console.log(`${red("Error:")} Unknown provider: ${currentProvider}\n`);
      return;
    }

    // No argument - show current model and available models
    if (!modelArg) {
      console.log(`\n${cyan("🎯 Model Status")}\n`);
      console.log(`${dim("Provider:")} ${green(currentProvider)}`);
      console.log(`${dim("Current model:")} ${yellow(this.opts.model ?? providerMeta.defaultModel)}`);
      console.log(`${dim("Default model:")} ${gray(providerMeta.defaultModel)}`);

      console.log(`\n${dim("Available models for")} ${green(currentProvider)}${dim(":")}`);
      for (const model of providerMeta.models) {
        const isCurrent = model === (this.opts.model ?? providerMeta.defaultModel);
        const marker = isCurrent ? yellow(" (current)") : "";
        const modelDisplay = isCurrent ? yellow(model) : model;
        console.log(`  • ${modelDisplay}${marker}`);
      }

      console.log(`\n${dim("Switch model:")} ${yellow(`/model <model-name>`)}`);
      console.log(`${dim("Example:")} ${yellow(`/model ${providerMeta.models[0]}`)}`);
      console.log("");
      return;
    }

    // Check if model is valid for current provider
    const normalizedModel = modelArg.toLowerCase();
    const matchedModel = providerMeta.models.find(
      (m) => m.toLowerCase() === normalizedModel
    );

    if (!matchedModel) {
      console.log(`${red("Error:")} Model "${modelArg}" is not available for provider "${currentProvider}".`);
      console.log(`\n${dim("Available models:")}`);
      for (const model of providerMeta.models) {
        console.log(`  • ${model}`);
      }
      console.log("");
      return;
    }

    // Switch model
    const oldModel = this.opts.model ?? providerMeta.defaultModel;
    this.opts.model = matchedModel;

    // Recreate agent with new model
    this.agent = this.createAgent(this.agent.sessionId);
    this.updateStatusBar();

    console.log(`${green("✓")} Model switched: ${gray(oldModel)} → ${yellow(matchedModel)}`);
    console.log(`${dim("Session preserved:")} ${gray(this.agent.sessionId.slice(0, 8))}...\n`);
  }

  private showProviderStatus() {
    const providers = getProviderList();
    const currentProvider = this.opts.provider ?? getCurrentProvider();

    console.log(`\n${cyan("🔌 Provider Status")}\n`);
    console.log(`${dim("Current:")} ${green(currentProvider)}`);
    if (this.opts.model) {
      console.log(`${dim("Model:")} ${yellow(this.opts.model)}`);
    }

    console.log(`\n${dim("Available Providers:")}`);
    console.log(`  ${dim("ID".padEnd(16))} ${dim("Name".padEnd(20))} ${dim("Auth".padEnd(12))} ${dim("Status")}`);
    console.log(`  ${dim("─".repeat(70))}`);

    // Group by auth method
    const apiKeyProviders = providers.filter(p => p.authMethod === "api-key");
    const oauthProviders = providers.filter(p => p.authMethod === "oauth");

    // OAuth providers first (more interesting)
    for (const p of oauthProviders) {
      const status = p.available ? green("✓") : red("✗");
      const isCurrent = p.id === currentProvider || (p.id === "claude-code" && currentProvider === "anthropic" && p.available);
      const current = isCurrent ? yellow(" (current)") : "";
      const idDisplay = isCurrent ? yellow(p.id.padEnd(16)) : p.id.padEnd(16);
      const authLabel = cyan("OAuth");
      const statusLabel = p.available ? green("ready") : dim("not logged in");
      console.log(`  ${status} ${idDisplay} ${p.name.padEnd(20)} ${authLabel.padEnd(12)} ${statusLabel}${current}`);
    }

    // API Key providers
    for (const p of apiKeyProviders) {
      const status = p.available ? green("✓") : red("✗");
      const isCurrent = p.id === currentProvider;
      const current = isCurrent ? yellow(" (current)") : "";
      const idDisplay = isCurrent ? yellow(p.id.padEnd(16)) : p.id.padEnd(16);
      const authLabel = dim("API Key");
      const statusLabel = p.available ? green("configured") : dim("not configured");
      console.log(`  ${status} ${idDisplay} ${p.name.padEnd(20)} ${authLabel.padEnd(12)} ${statusLabel}${current}`);
    }

    console.log(`\n${dim("Usage:")}`);
    console.log(`  ${yellow("multica --provider <id>")}       ${dim("Start chat with specific provider")}`);
    console.log(`  ${yellow("multica --provider <id> --model <model>")}  ${dim("Specify model too")}`);

    console.log(`\n${dim("Examples:")}`);
    console.log(`  ${yellow("multica --provider claude-code")}  ${dim("Use Claude Code OAuth")}`);
    console.log(`  ${yellow("multica --provider openai")}       ${dim("Use OpenAI with API Key")}`);

    // If user hasn't logged into Claude Code, show instructions
    const claudeCode = providers.find(p => p.id === "claude-code");
    if (claudeCode && !claudeCode.available) {
      console.log(`\n${cyan("💡 Tip:")} To use Claude Code (free with Claude subscription):`);
      console.log(`  1. Install: ${yellow("npm install -g @anthropic-ai/claude-code")}`);
      console.log(`  2. Login:   ${yellow("claude login")}`);
      console.log(`  3. Use:     ${yellow("multica --provider claude-code")}`);
    }

    console.log("");
  }

  private async handleInput(input: string) {
    try {
      console.log("");
      this.statusBar.hide();
      const result = await this.agent.run(input);
      this.statusBar.show();
      if (result.error) {
        console.error(`\n${colors.error(`Error: ${result.error}`)}`);
      }
      console.log("");
    } catch (err) {
      console.error(`\n${colors.error(`Error: ${err instanceof Error ? err.message : String(err)}`)}`);
      console.log("");
    }
  }
}

export async function chatCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (opts.help) {
    printHelp();
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(colors.error("Error: Interactive mode requires a TTY. Use 'multica run' for non-interactive mode."));
    process.exit(1);
  }

  const cli = new InteractiveCLI(opts);
  await cli.run();
}
