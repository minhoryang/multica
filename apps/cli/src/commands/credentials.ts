/**
 * Credentials command - Manage credentials and environment files
 *
 * Usage:
 *   multica credentials init          Create credential files
 *   multica credentials show          Show credential paths
 *   multica credentials edit          Open credentials in editor
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { getCredentialsPath, getSkillsEnvPath } from "@multica/core";
import { cyan, yellow, green, dim, red } from "../colors.js";

type Command = "init" | "show" | "edit" | "help";

interface CredentialsOptions {
  command: Command;
  force: boolean;
  coreOnly: boolean;
  skillsOnly: boolean;
  pathOverride?: string | undefined;
  skillsPathOverride?: string | undefined;
}

function printHelp() {
  console.log(`
${cyan("Usage:")} multica credentials <command> [options]

${cyan("Commands:")}
  ${yellow("init")}                Create credentials.json5 and skills.env.json5
  ${yellow("show")}                Show credential file paths
  ${yellow("edit")}                Open credentials directory in file manager
  ${yellow("help")}                Show this help

${cyan("Options for 'init':")}
  ${yellow("--force")}             Overwrite existing files
  ${yellow("--core-only")}         Only create credentials.json5
  ${yellow("--skills-only")}       Only create skills.env.json5
  ${yellow("--path")} PATH         Override credentials path
  ${yellow("--skills-path")} PATH  Override skills env path

${cyan("Files Created:")}
  ~/.super-multica/credentials.json5     LLM providers + tools config
  ~/.super-multica/skills.env.json5      Skills/plugins/integrations env vars

${cyan("Examples:")}
  ${dim("# Initialize credentials")}
  multica credentials init

  ${dim("# Force overwrite")}
  multica credentials init --force

  ${dim("# Only create core credentials")}
  multica credentials init --core-only
`);
}

function parseArgs(argv: string[]): CredentialsOptions {
  const args = [...argv];
  const opts: CredentialsOptions = {
    command: "help",
    force: false,
    coreOnly: false,
    skillsOnly: false,
  };

  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      opts.command = "help";
      return opts;
    }
    if (arg === "--force" || arg === "-f") {
      opts.force = true;
      continue;
    }
    if (arg === "--core-only") {
      opts.coreOnly = true;
      continue;
    }
    if (arg === "--skills-only") {
      opts.skillsOnly = true;
      continue;
    }
    if (arg === "--path") {
      opts.pathOverride = args.shift();
      continue;
    }
    if (arg === "--skills-path") {
      opts.skillsPathOverride = args.shift();
      continue;
    }
    positional.push(arg);
  }

  opts.command = (positional[0] || "help") as Command;
  return opts;
}

function buildCoreTemplate(): string {
  return `{
  version: 1,
  llm: {
    // provider: "openai",
    providers: {
      // openai: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" }
    }
  },
  tools: {
    // brave: { apiKey: "brv-..." },
    // perplexity: { apiKey: "pplx-...", baseUrl: "https://api.perplexity.ai", model: "perplexity/sonar-pro" }
  }
}
`;
}

function buildSkillsTemplate(): string {
  return `{
  env: {
    // Dynamic keys (skills, plugins, integrations)
    // LINEAR_API_KEY: "lin-..."
  }
}
`;
}

function cmdInit(opts: CredentialsOptions): void {
  const createCore = !opts.skillsOnly;
  const createSkills = !opts.coreOnly;

  if (!createCore && !createSkills) {
    console.error(`${red("Error:")} Both --core-only and --skills-only were provided.`);
    process.exit(1);
  }

  if (createCore) {
    const path = opts.pathOverride ?? getCredentialsPath();
    if (existsSync(path) && !opts.force) {
      console.error(`${red("Error:")} Credentials file already exists at ${path}`);
      console.error("Use --force to overwrite.");
      process.exit(1);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildCoreTemplate(), "utf8");
    chmodSync(path, 0o600);
    console.log(`${green("Created:")} ${path}`);
  }

  if (createSkills) {
    const skillsPath = opts.skillsPathOverride ?? getSkillsEnvPath();
    if (existsSync(skillsPath) && !opts.force) {
      console.error(`${red("Error:")} Skills env file already exists at ${skillsPath}`);
      console.error("Use --force to overwrite.");
      process.exit(1);
    }
    mkdirSync(dirname(skillsPath), { recursive: true });
    writeFileSync(skillsPath, buildSkillsTemplate(), "utf8");
    chmodSync(skillsPath, 0o600);
    console.log(`${green("Created:")} ${skillsPath}`);
  }

  console.log("");
  console.log("Edit these files to add your credentials.");
}

function cmdShow(): void {
  const credentialsPath = getCredentialsPath();
  const skillsEnvPath = getSkillsEnvPath();

  console.log(`\n${cyan("Credential Files:")}\n`);

  console.log(`${yellow("credentials.json5")}`);
  console.log(`  Path: ${credentialsPath}`);
  console.log(`  Exists: ${existsSync(credentialsPath) ? green("Yes") : red("No")}`);
  console.log("");

  console.log(`${yellow("skills.env.json5")}`);
  console.log(`  Path: ${skillsEnvPath}`);
  console.log(`  Exists: ${existsSync(skillsEnvPath) ? green("Yes") : red("No")}`);
  console.log("");

  if (!existsSync(credentialsPath) || !existsSync(skillsEnvPath)) {
    console.log(`${dim("Run 'multica credentials init' to create missing files.")}`);
  }
}

async function cmdEdit(): Promise<void> {
  const credentialsPath = getCredentialsPath();
  const dir = dirname(credentialsPath);

  if (!existsSync(dir)) {
    console.error(`${red("Error:")} Credentials directory does not exist: ${dir}`);
    console.error("Run 'multica credentials init' first.");
    process.exit(1);
  }

  const { spawn } = await import("node:child_process");

  // Open in default file manager
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();

  console.log(`${green("Opened:")} ${dir}`);
}

export async function credentialsCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  switch (opts.command) {
    case "init":
      cmdInit(opts);
      break;
    case "show":
      cmdShow();
      break;
    case "edit":
      await cmdEdit();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
