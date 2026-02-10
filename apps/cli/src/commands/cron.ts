/**
 * Cron command - Manage scheduled tasks
 *
 * Usage:
 *   multica cron status           Show cron service status
 *   multica cron list             List all jobs
 *   multica cron add <options>    Add a new job
 *   multica cron run <id>         Run a job immediately
 *   multica cron enable <id>      Enable a job
 *   multica cron disable <id>     Disable a job
 *   multica cron remove <id>      Remove a job
 *   multica cron logs <id>        Show job run logs
 */

import { cyan, yellow, green, dim, red, brightCyan } from "../colors.js";
import {
  getCronService,
  formatSchedule,
  formatDuration,
  parseTimeInput,
  parseIntervalInput,
  isValidCronExpr,
  type CronSchedule,
  type CronJobInput,
} from "@multica/core";

type Command = "status" | "list" | "add" | "run" | "enable" | "disable" | "remove" | "logs" | "help";

function printHelp() {
  console.log(`
${brightCyan("Cron")} - Scheduled Task Management

${cyan("Usage:")} multica cron <command> [options]

${cyan("Commands:")}
  ${yellow("status")}                Show cron service status
  ${yellow("list")}                  List all scheduled jobs
  ${yellow("add")} [options]         Create a new scheduled job
  ${yellow("run")} <id>              Run a job immediately
  ${yellow("enable")} <id>           Enable a disabled job
  ${yellow("disable")} <id>          Disable a job (keeps schedule)
  ${yellow("remove")} <id>           Delete a job
  ${yellow("logs")} <id>             Show run history for a job
  ${yellow("help")}                  Show this help

${cyan("Add Options:")}
  ${yellow("-n, --name")} <name>     Job name (required)
  ${yellow("--at")} <time>           One-time at ISO timestamp or relative (e.g., "10m", "2h")
  ${yellow("--every")} <interval>    Repeat interval (e.g., "30m", "1h", "1d")
  ${yellow("--cron")} <expr>         Cron expression (5-field, e.g., "0 9 * * *")
  ${yellow("--tz")} <timezone>       Timezone for cron expression (e.g., "Asia/Shanghai")
  ${yellow("--message")} <text>      Message to inject or prompt for agent
  ${yellow("--isolated")}            Run in isolated session (default: main)
  ${yellow("--delete-after-run")}    Delete after one-time run completes

${cyan("Examples:")}
  ${dim("# Show service status")}
  multica cron status

  ${dim("# 10 minutes from now (one-shot)")}
  multica cron add -n "Reminder" --at "10m" --message "Time to take a break!"

  ${dim("# Every day at 9am Beijing time")}
  multica cron add -n "Morning check" --cron "0 9 * * *" --tz "Asia/Shanghai" \\
    --message "Good morning! Check your tasks."

  ${dim("# Every 30 minutes")}
  multica cron add -n "Health check" --every "30m" --message "System health check"

  ${dim("# Run a job now")}
  multica cron run abc12345

  ${dim("# View job logs")}
  multica cron logs abc12345
`);
}

function cmdStatus() {
  const service = getCronService();
  const status = service.status();

  console.log(`\n${brightCyan("Cron Service Status")}\n`);
  console.log(`  ${cyan("Running:")}      ${status.running ? green("Yes") : red("No")}`);
  console.log(`  ${cyan("Enabled:")}      ${status.enabled ? green("Yes") : red("No")}`);
  console.log(`  ${cyan("Jobs:")}         ${status.jobCount} total, ${status.enabledJobCount} enabled`);
  if (status.nextWakeAtMs) {
    const nextWake = new Date(status.nextWakeAtMs);
    const relativeMs = status.nextWakeAtMs - Date.now();
    console.log(`  ${cyan("Next wake:")}    ${nextWake.toLocaleString()} (in ${formatDuration(relativeMs)})`);
  } else {
    console.log(`  ${cyan("Next wake:")}    ${dim("none scheduled")}`);
  }
  console.log(`  ${cyan("Store:")}        ${dim(status.storePath)}`);
  console.log("");
}

function cmdList(args: string[]) {
  const service = getCronService();
  const showEnabled = args.includes("--enabled");
  const showDisabled = args.includes("--disabled");

  let filter: { enabled?: boolean } | undefined;
  if (showEnabled) filter = { enabled: true };
  else if (showDisabled) filter = { enabled: false };

  const jobs = service.list(filter);

  if (jobs.length === 0) {
    console.log("\nNo cron jobs found.");
    console.log(`${dim("Create one with:")} multica cron add -n "Name" --at "10m" --message "Hello"`);
    return;
  }

  console.log(`\n${brightCyan("Scheduled Jobs")}\n`);

  for (const job of jobs) {
    const statusIcon = job.enabled ? green("✓") : red("✗");
    const shortId = job.id.slice(0, 8);

    console.log(`${statusIcon} ${yellow(job.name)} ${dim(`(${shortId})`)}`);
    console.log(`    ${cyan("Schedule:")} ${formatSchedule(job.schedule)}`);
    console.log(`    ${cyan("Target:")}   ${job.sessionTarget}`);

    if (job.state.nextRunAtMs) {
      const nextRun = new Date(job.state.nextRunAtMs);
      const relativeMs = job.state.nextRunAtMs - Date.now();
      if (relativeMs > 0) {
        console.log(`    ${cyan("Next run:")} ${nextRun.toLocaleString()} ${dim(`(in ${formatDuration(relativeMs)})`)}`);
      } else {
        console.log(`    ${cyan("Next run:")} ${dim("pending execution")}`);
      }
    }

    if (job.state.lastRunAtMs) {
      const lastRun = new Date(job.state.lastRunAtMs);
      const statusColor = job.state.lastStatus === "ok" ? green : job.state.lastStatus === "error" ? red : yellow;
      console.log(`    ${cyan("Last run:")} ${lastRun.toLocaleString()} ${statusColor(`[${job.state.lastStatus}]`)} ${dim(`(${formatDuration(job.state.lastDurationMs ?? 0)})`)}`);
      if (job.state.lastError) {
        console.log(`    ${red("Error:")}    ${job.state.lastError}`);
      }
    }

    console.log("");
  }

  console.log(dim(`Total: ${jobs.length} job(s)`));
}

function cmdAdd(args: string[]) {
  const service = getCronService();

  // Parse arguments
  let name: string | undefined;
  let at: string | undefined;
  let every: string | undefined;
  let cronExpr: string | undefined;
  let tz: string | undefined;
  let message: string | undefined;
  let isolated = false;
  let deleteAfterRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-n":
      case "--name":
        name = args[++i];
        break;
      case "--at":
        at = args[++i];
        break;
      case "--every":
        every = args[++i];
        break;
      case "--cron":
        cronExpr = args[++i];
        break;
      case "--tz":
        tz = args[++i];
        break;
      case "--message":
        message = args[++i];
        break;
      case "--isolated":
        isolated = true;
        break;
      case "--delete-after-run":
        deleteAfterRun = true;
        break;
    }
  }

  // Validate
  if (!name) {
    console.error(`${red("Error:")} --name is required`);
    console.error(`${dim("Usage:")} multica cron add -n "Job name" --at "10m" --message "Hello"`);
    process.exit(1);
  }

  if (!message) {
    console.error(`${red("Error:")} --message is required`);
    process.exit(1);
  }

  // Parse schedule
  let schedule: CronSchedule;
  if (at) {
    const atMs = parseTimeInput(at);
    if (!atMs) {
      console.error(`${red("Error:")} Invalid time format: ${at}`);
      console.error(`${dim("Examples:")} "10m", "2h", "2024-12-31T23:59:00Z"`);
      process.exit(1);
    }
    schedule = { kind: "at", atMs };
  } else if (every) {
    const everyMs = parseIntervalInput(every);
    if (!everyMs) {
      console.error(`${red("Error:")} Invalid interval format: ${every}`);
      console.error(`${dim("Examples:")} "30s", "5m", "2h", "1d"`);
      process.exit(1);
    }
    schedule = { kind: "every", everyMs };
  } else if (cronExpr) {
    if (!isValidCronExpr(cronExpr, tz)) {
      console.error(`${red("Error:")} Invalid cron expression: ${cronExpr}`);
      console.error(`${dim("Format:")} "minute hour day month weekday" (e.g., "0 9 * * *")`);
      process.exit(1);
    }
    // Only include tz if it's defined (exactOptionalPropertyTypes)
    schedule = tz ? { kind: "cron", expr: cronExpr, tz } : { kind: "cron", expr: cronExpr };
  } else {
    console.error(`${red("Error:")} Must specify --at, --every, or --cron`);
    process.exit(1);
  }

  // Create job
  const input: CronJobInput = {
    name,
    enabled: true,
    deleteAfterRun,
    schedule,
    sessionTarget: isolated ? "isolated" : "main",
    wakeMode: "now",
    payload: {
      kind: "system-event",
      text: message,
    },
  };

  const job = service.add(input);

  console.log(`\n${green("Created job:")} ${job.name} ${dim(`(${job.id.slice(0, 8)})`)}`);
  console.log(`  ${cyan("Schedule:")} ${formatSchedule(job.schedule)}`);
  if (job.state.nextRunAtMs) {
    const nextRun = new Date(job.state.nextRunAtMs);
    console.log(`  ${cyan("Next run:")} ${nextRun.toLocaleString()}`);
  }
  console.log("");
}

async function cmdRun(args: string[]) {
  const service = getCronService();
  const jobId = args[0];
  const force = args.includes("--force");

  if (!jobId) {
    console.error(`${red("Error:")} Job ID is required`);
    console.error(`${dim("Usage:")} multica cron run <id> [--force]`);
    process.exit(1);
  }

  // Find job by partial ID
  const jobs = service.list();
  const matches = jobs.filter((j) => j.id.startsWith(jobId));

  if (matches.length === 0) {
    console.error(`${red("Error:")} Job not found: ${jobId}`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`${red("Error:")} Multiple jobs match "${jobId}":`);
    for (const j of matches) {
      console.error(`  ${j.id.slice(0, 8)} - ${j.name}`);
    }
    console.error("Please provide a more specific ID.");
    process.exit(1);
  }

  const job = matches[0]!;
  console.log(`Running job: ${job.name} (${job.id.slice(0, 8)})...`);

  const result = await service.run(job.id, force);
  if (result.ok) {
    console.log(`${green("Success:")} Job executed`);
  } else {
    console.error(`${red("Error:")} ${result.reason}`);
    process.exit(1);
  }
}

function cmdEnableDisable(args: string[], enabled: boolean) {
  const service = getCronService();
  const jobId = args[0];

  if (!jobId) {
    console.error(`${red("Error:")} Job ID is required`);
    process.exit(1);
  }

  // Find job by partial ID
  const jobs = service.list();
  const matches = jobs.filter((j) => j.id.startsWith(jobId));

  if (matches.length === 0) {
    console.error(`${red("Error:")} Job not found: ${jobId}`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`${red("Error:")} Multiple jobs match "${jobId}":`);
    for (const j of matches) {
      console.error(`  ${j.id.slice(0, 8)} - ${j.name}`);
    }
    process.exit(1);
  }

  const job = matches[0]!;
  service.update(job.id, { enabled });

  const action = enabled ? "Enabled" : "Disabled";
  console.log(`${green(action + ":")} ${job.name} (${job.id.slice(0, 8)})`);
}

function cmdRemove(args: string[]) {
  const service = getCronService();
  const jobId = args[0];

  if (!jobId) {
    console.error(`${red("Error:")} Job ID is required`);
    process.exit(1);
  }

  // Find job by partial ID
  const jobs = service.list();
  const matches = jobs.filter((j) => j.id.startsWith(jobId));

  if (matches.length === 0) {
    console.error(`${red("Error:")} Job not found: ${jobId}`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`${red("Error:")} Multiple jobs match "${jobId}":`);
    for (const j of matches) {
      console.error(`  ${j.id.slice(0, 8)} - ${j.name}`);
    }
    process.exit(1);
  }

  const job = matches[0]!;
  service.remove(job.id);
  console.log(`${green("Removed:")} ${job.name} (${job.id.slice(0, 8)})`);
}

function cmdLogs(args: string[]) {
  const service = getCronService();
  const jobId = args[0];
  const limitArg = args.indexOf("--limit");
  const limitStr = limitArg !== -1 ? args[limitArg + 1] : undefined;
  const limit = limitStr ? parseInt(limitStr, 10) : 20;

  if (!jobId) {
    console.error(`${red("Error:")} Job ID is required`);
    console.error(`${dim("Usage:")} multica cron logs <id> [--limit N]`);
    process.exit(1);
  }

  // Find job by partial ID
  const jobs = service.list();
  const matches = jobs.filter((j) => j.id.startsWith(jobId));

  if (matches.length === 0) {
    console.error(`${red("Error:")} Job not found: ${jobId}`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`${red("Error:")} Multiple jobs match "${jobId}":`);
    for (const j of matches) {
      console.error(`  ${j.id.slice(0, 8)} - ${j.name}`);
    }
    process.exit(1);
  }

  const job = matches[0]!;
  const logs = service.getRunLogs(job.id, limit);

  console.log(`\n${brightCyan("Run Logs:")} ${job.name} ${dim(`(${job.id.slice(0, 8)})`)}\n`);

  if (logs.length === 0) {
    console.log(dim("No run logs found."));
    return;
  }

  for (const log of logs) {
    const timestamp = new Date(log.ts).toLocaleString();
    const statusColor = log.status === "ok" ? green : log.status === "error" ? red : yellow;
    const duration = log.durationMs ? formatDuration(log.durationMs) : "-";

    console.log(`  ${dim(timestamp)} ${statusColor(`[${log.status}]`)} ${dim(`(${duration})`)}`);
    if (log.error) {
      console.log(`    ${red("Error:")} ${log.error}`);
    }
    if (log.summary) {
      console.log(`    ${dim(log.summary)}`);
    }
  }

  console.log(`\n${dim(`Showing ${logs.length} most recent entries`)}`);
}

export async function cronCommand(args: string[]): Promise<void> {
  const command = (args[0] || "help") as Command;
  const restArgs = args.slice(1);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  // Ensure service is started
  const service = getCronService();
  await service.start();

  switch (command) {
    case "status":
      cmdStatus();
      break;
    case "list":
      cmdList(restArgs);
      break;
    case "add":
      cmdAdd(restArgs);
      break;
    case "run":
      await cmdRun(restArgs);
      break;
    case "enable":
      cmdEnableDisable(restArgs, true);
      break;
    case "disable":
      cmdEnableDisable(restArgs, false);
      break;
    case "remove":
      cmdRemove(restArgs);
      break;
    case "logs":
      cmdLogs(restArgs);
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
