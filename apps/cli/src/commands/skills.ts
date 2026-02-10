/**
 * Skills command - Manage agent skills
 *
 * Usage:
 *   multica skills list              List all skills
 *   multica skills status [id]       Show skill status
 *   multica skills install <id>      Install skill dependencies
 *   multica skills add <source>      Add skill from GitHub
 *   multica skills remove <name>     Remove a skill
 */

import {
  SkillManager,
  installSkill,
  getInstallOptions,
  addSkill,
  removeSkill,
  listInstalledSkills,
  checkEligibilityDetailed,
  type DiagnosticItem,
} from "@multica/core";
import { credentialManager } from "@multica/core";
import { cyan, yellow, green, dim, red } from "../colors.js";

type Command = "list" | "status" | "install" | "add" | "remove" | "help";

interface ParsedArgs {
  command: Command;
  args: string[];
  verbose: boolean;
  force: boolean;
  profile?: string | undefined;
}

function printHelp() {
  console.log(`
${cyan("Usage:")} multica skills <command> [options]

${cyan("Commands:")}
  ${yellow("list")}                List all available skills
  ${yellow("status")} [id]         Show skill status (detailed diagnostics)
  ${yellow("install")} <id>        Install dependencies for a skill
  ${yellow("add")} <source>        Add skill from GitHub
  ${yellow("remove")} <name>       Remove an installed skill
  ${yellow("help")}                Show this help

${cyan("Options:")}
  ${yellow("-v, --verbose")}       Show more details
  ${yellow("-f, --force")}         Force overwrite existing skill
  ${yellow("-p, --profile")} <id>  Install to specific profile's skills directory

${cyan("Source Formats:")} ${dim("(for add command)")}
  owner/repo              Clone entire repository
  owner/repo/skill-name   Clone single skill directory
  owner/repo@branch       Clone specific branch/tag

${cyan("Examples:")}
  ${dim("# List all skills")}
  multica skills list

  ${dim("# Check skill status")}
  multica skills status commit

  ${dim("# Install skill dependencies")}
  multica skills install nano-pdf

  ${dim("# Add skills from GitHub")}
  multica skills add vercel-labs/agent-skills
  multica skills add vercel-labs/agent-skills/perplexity

  ${dim("# Remove a skill")}
  multica skills remove agent-skills

  ${dim("# Add skill to a specific profile")}
  multica skills add owner/repo --profile my-agent
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let verbose = false;
  let force = false;
  let profile: string | undefined;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }

    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }

    if (arg === "--profile" || arg === "-p") {
      profile = args.shift();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { command: "help", args: [], verbose, force, profile };
    }

    positional.push(arg);
  }

  const command = (positional[0] ?? "help") as Command;
  const commandArgs = positional.slice(1);

  return { command, args: commandArgs, verbose, force, profile };
}

function cmdList(manager: SkillManager, verbose: boolean): void {
  const skills = manager.listAllSkillsWithStatus();

  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  console.log(`\n${cyan("Available Skills:")}\n`);

  for (const skill of skills) {
    const status = skill.eligible ? "✓" : "✗";
    const statusColor = skill.eligible ? green : red;

    console.log(`  ${statusColor(status)} ${skill.emoji} ${skill.name} (${skill.id})`);
    console.log(`    ${dim(skill.description)}`);
    console.log(`    ${dim(`Source: ${skill.source}`)}`);

    if (!skill.eligible && skill.reasons) {
      for (const reason of skill.reasons) {
        console.log(`    ${red(`└ ${reason}`)}`);
      }
    }

    if (verbose) {
      console.log();
    }
  }

  console.log();
  const eligibleCount = skills.filter((s) => s.eligible).length;
  console.log(`${dim(`Total: ${skills.length} skills (${eligibleCount} eligible)`)}`);
}

function cmdStatus(manager: SkillManager, skillId?: string, verbose?: boolean): void {
  if (!skillId) {
    cmdStatusSummary(manager, verbose);
    return;
  }
  cmdStatusDetail(manager, skillId, verbose);
}

function cmdStatusSummary(manager: SkillManager, verbose?: boolean): void {
  const skills = manager.listAllSkillsWithStatus();
  const eligible = skills.filter((s) => s.eligible);
  const ineligible = skills.filter((s) => !s.eligible);

  console.log(`\n${cyan("Skills Status Summary:")}\n`);
  console.log(`  Total:      ${skills.length}`);
  console.log(`  ${green(`Eligible:   ${eligible.length}`)}`);
  console.log(`  ${red(`Ineligible: ${ineligible.length}`)}`);

  if (ineligible.length > 0) {
    console.log("\n" + dim("─".repeat(45)));
    console.log("Ineligible Skills:");

    const byIssue: Map<string, string[]> = new Map();
    for (const s of ineligible) {
      const skill = manager.getSkillFromAll(s.id);
      if (skill) {
        const detailed = checkEligibilityDetailed(skill);
        const mainIssue = detailed.diagnostics?.[0]?.type ?? "unknown";
        const existing = byIssue.get(mainIssue) ?? [];
        existing.push(s.id);
        byIssue.set(mainIssue, existing);
      }
    }

    const issueLabels: Record<string, string> = {
      disabled: "Disabled in config",
      not_in_allowlist: "Not in allowlist",
      platform: "Platform mismatch",
      binary: "Missing binaries",
      any_binary: "Missing binaries (any)",
      env: "Missing environment variables",
      config: "Missing config values",
      unknown: "Unknown issues",
    };

    for (const [issue, skillIds] of byIssue) {
      const label = issueLabels[issue] ?? issue;
      console.log(`\n  ${yellow(label + ":")}`);
      for (const id of skillIds) {
        const skill = manager.getSkillFromAll(id);
        if (skill && verbose) {
          const detailed = checkEligibilityDetailed(skill);
          const diag = detailed.diagnostics?.[0];
          console.log(`    - ${id}`);
          if (diag?.hint) {
            console.log(`      ${cyan(`Hint: ${diag.hint}`)}`);
          }
        } else {
          console.log(`    - ${id}`);
        }
      }
    }

    console.log("\n" + dim("─".repeat(45)));
    console.log(`${cyan("Tip:")} Run 'multica skills status <skill-id>' for detailed diagnostics`);
  }
}

function cmdStatusDetail(manager: SkillManager, skillId: string, verbose?: boolean): void {
  const skill = manager.getSkillFromAll(skillId);
  if (!skill) {
    console.error(`${red("Error:")} Skill not found: ${skillId}`);
    process.exit(1);
  }

  const detailed = checkEligibilityDetailed(skill);
  const metadata = skill.frontmatter.metadata;

  console.log(`\n${metadata?.emoji ?? "🔧"} ${skill.frontmatter.name}`);
  console.log("═".repeat(50));
  console.log(`ID:          ${skill.id}`);
  console.log(`Description: ${skill.frontmatter.description ?? "N/A"}`);
  console.log(`Version:     ${skill.frontmatter.version ?? "N/A"}`);
  console.log(`Source:      ${skill.source}`);
  console.log(`Path:        ${skill.filePath}`);
  console.log(`Homepage:    ${skill.frontmatter.homepage ?? metadata?.homepage ?? "N/A"}`);

  console.log();
  console.log("─".repeat(50));
  console.log(`Status: ${detailed.eligible ? green("✓ ELIGIBLE") : red("✗ NOT ELIGIBLE")}`);

  if (!detailed.eligible && detailed.diagnostics) {
    console.log("\nDiagnostics:");
    for (const diag of detailed.diagnostics) {
      printDiagnostic(diag);
    }
  }

  const requirements = metadata?.requires;
  const hasBins = requirements?.bins?.length ?? metadata?.requiresBinaries?.length ?? 0;
  const hasAnyBins = requirements?.anyBins?.length ?? 0;
  const hasEnvs = requirements?.env?.length ?? metadata?.requiresEnv?.length ?? 0;

  if (hasBins > 0 || hasAnyBins > 0 || hasEnvs > 0) {
    console.log("\n" + "─".repeat(50));
    console.log("Requirements:");

    if (hasBins > 0) {
      const bins = requirements?.bins ?? metadata?.requiresBinaries ?? [];
      printRequirementStatus("Binaries (all required)", bins, checkBinaries);
    }

    if (hasAnyBins > 0) {
      const anyBins = requirements?.anyBins ?? [];
      printRequirementStatus("Binaries (any one)", anyBins, checkBinaries, true);
    }

    if (hasEnvs > 0) {
      const envs = requirements?.env ?? metadata?.requiresEnv ?? [];
      printRequirementStatus("Environment vars", envs, checkEnvVars);
    }
  }

  const installOptions = getInstallOptions(skill);
  if (installOptions.length > 0) {
    console.log("\n" + "─".repeat(50));
    console.log("Install Options:");
    for (const opt of installOptions) {
      const status = opt.available ? green("✓") : red("✗");
      console.log(`  ${status} [${opt.id}] ${opt.label}`);
      if (!opt.available && opt.reason) {
        console.log(`    └ ${opt.reason}`);
      }
    }
  }

  if (!detailed.eligible) {
    console.log("\n" + "─".repeat(50));
    console.log(`${yellow("Quick Actions:")}`);

    for (const diag of detailed.diagnostics ?? []) {
      if (diag.hint) {
        console.log(`  → ${diag.hint}`);
      }
    }

    if (installOptions.length > 0) {
      console.log(`  → multica skills install ${skillId}`);
    }
  }
}

function printDiagnostic(diag: DiagnosticItem): void {
  const typeColors: Record<string, (s: string) => string> = {
    disabled: yellow,
    not_in_allowlist: yellow,
    platform: dim,
    binary: red,
    any_binary: red,
    env: cyan,
    config: cyan,
  };

  const color = typeColors[diag.type] ?? dim;

  console.log(`\n  ${color(`[${diag.type.toUpperCase()}]`)}`);
  console.log(`  ${diag.message}`);

  if (diag.values && diag.values.length > 0) {
    console.log(`  Values: ${diag.values.join(", ")}`);
  }

  if (diag.hint) {
    console.log(`  ${cyan(`💡 ${diag.hint}`)}`);
  }
}

function printRequirementStatus(
  label: string,
  items: string[],
  checker: (items: string[]) => Map<string, boolean>,
  anyMode: boolean = false,
): void {
  const status = checker(items);
  const found = Array.from(status.entries()).filter(([, ok]) => ok).map(([name]) => name);
  const missing = Array.from(status.entries()).filter(([, ok]) => !ok).map(([name]) => name);

  const allOk = anyMode ? found.length > 0 : missing.length === 0;
  const statusIcon = allOk ? green("✓") : red("✗");

  console.log(`\n  ${statusIcon} ${label}:`);
  for (const [name, ok] of status) {
    const icon = ok ? green("✓") : red("✗");
    console.log(`      ${icon} ${name}`);
  }
}

function checkBinaries(bins: string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const bin of bins) {
    try {
      const cmd = process.platform === "win32" ? `where ${bin}` : `which ${bin}`;
      require("child_process").execSync(cmd, { stdio: "ignore" });
      result.set(bin, true);
    } catch {
      result.set(bin, false);
    }
  }
  return result;
}

function checkEnvVars(envs: string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const env of envs) {
    result.set(env, credentialManager.hasEnv(env));
  }
  return result;
}

async function cmdInstall(manager: SkillManager, skillId: string, installId?: string): Promise<void> {
  const skill = manager.getSkillFromAll(skillId);
  if (!skill) {
    console.error(`${red("Error:")} Skill not found: ${skillId}`);
    process.exit(1);
  }

  const installOptions = getInstallOptions(skill);
  if (installOptions.length === 0) {
    console.error(`${red("Error:")} Skill '${skillId}' has no install specifications.`);
    process.exit(1);
  }

  if (!installId && installOptions.length > 1) {
    console.log(`\nMultiple install options available for '${skillId}':\n`);
    for (const opt of installOptions) {
      const status = opt.available ? "available" : `unavailable: ${opt.reason}`;
      console.log(`  [${opt.id}] ${opt.label} (${status})`);
    }
    console.log(`\nUse: multica skills install ${skillId} <install-id>`);
    return;
  }

  console.log(`\nInstalling dependencies for '${skillId}'...`);

  const result = await installSkill({
    skill,
    installId,
  });

  if (result.ok) {
    console.log(`\n${green(`✓ ${result.message}`)}`);
  } else {
    console.error(`\n${red(`✗ ${result.message}`)}`);
    if (result.stderr) {
      console.error("\nError output:");
      console.error(result.stderr);
    }
    process.exit(1);
  }
}

async function cmdAdd(source: string, force: boolean, profileId?: string): Promise<void> {
  const destination = profileId ? `profile '${profileId}'` : "global skills";
  console.log(`\nAdding skill from '${source}' to ${destination}...`);

  const result = await addSkill({
    source,
    force,
    profileId,
  });

  if (result.ok) {
    console.log(`\n${green(`✓ ${result.message}`)}`);
    if (result.skills && result.skills.length > 1) {
      console.log("\nSkills found:");
      for (const name of result.skills) {
        console.log(`  - ${name}`);
      }
    }
    if (result.path) {
      console.log(`\nInstalled to: ${result.path}`);
    }
  } else {
    console.error(`\n${red(`✗ ${result.message}`)}`);
    process.exit(1);
  }
}

async function cmdRemove(name: string): Promise<void> {
  console.log(`\nRemoving skill '${name}'...`);

  const result = await removeSkill(name);

  if (result.ok) {
    console.log(`\n${green(`✓ ${result.message}`)}`);
  } else {
    console.error(`\n${red(`✗ ${result.message}`)}`);
    process.exit(1);
  }
}

async function cmdListInstalled(): Promise<void> {
  const skills = await listInstalledSkills();

  if (skills.length === 0) {
    console.log("\nNo skills installed in ~/.super-multica/skills/");
    console.log("Use 'multica skills add <source>' to add skills.");
    return;
  }

  console.log("\nInstalled skills (~/.super-multica/skills/):\n");
  for (const name of skills) {
    console.log(`  - ${name}`);
  }
  console.log(`\n${dim(`Total: ${skills.length} installed`)}`);
}

export async function skillsCommand(args: string[]): Promise<void> {
  const { command, args: cmdArgs, verbose, force, profile } = parseArgs(args);

  if (command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "add":
      if (!cmdArgs[0]) {
        console.error("Usage: multica skills add <source> [--force] [--profile <id>]");
        console.error("\nSource formats:");
        console.error("  owner/repo              Clone entire repository");
        console.error("  owner/repo/skill-name   Clone single skill directory");
        console.error("  owner/repo@branch       Clone specific branch/tag");
        console.error("\nOptions:");
        console.error("  --force, -f             Overwrite existing skill");
        console.error("  --profile, -p <id>      Install to profile's skills directory");
        process.exit(1);
      }
      await cmdAdd(cmdArgs[0], force, profile);
      return;

    case "remove":
      if (!cmdArgs[0]) {
        console.error("Usage: multica skills remove <skill-name>");
        await cmdListInstalled();
        process.exit(1);
      }
      await cmdRemove(cmdArgs[0]);
      return;
  }

  const manager = new SkillManager();

  switch (command) {
    case "list":
      cmdList(manager, verbose);
      break;

    case "status":
      cmdStatus(manager, cmdArgs[0], verbose);
      break;

    case "install":
      if (!cmdArgs[0]) {
        console.error("Usage: multica skills install <skill-id> [install-id]");
        process.exit(1);
      }
      await cmdInstall(manager, cmdArgs[0], cmdArgs[1]);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}
