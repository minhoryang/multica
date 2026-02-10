/**
 * Dev command - Start development servers
 *
 * Usage:
 *   multica dev                Start desktop app (with embedded Hub)
 *   multica dev gateway        Start gateway only (:3000) - for remote clients
 *   multica dev web            Start web app only (:3001)
 *   multica dev all            Start all services (gateway + web)
 */

import { spawn } from "node:child_process";
import { cyan, yellow, green, dim, red } from "../colors.js";

type Service = "all" | "gateway" | "web" | "desktop" | "help";

function printHelp() {
  console.log(`
${cyan("Usage:")} multica dev [service]

${cyan("Services:")}
  ${yellow("(default)")}           Start Desktop app (with embedded Hub)
  ${yellow("gateway")}             Start Gateway server (:3000) - for remote clients
  ${yellow("web")}                 Start Web app (:3001)
  ${yellow("all")}                 Start all services (gateway + web)
  ${yellow("help")}                Show this help

${cyan("Architecture:")}
  Desktop App (standalone)
    └─ Embedded Hub + Agent Engine
       └─ (Optional) Gateway connection for remote access

  Web App (requires Gateway)
    → Gateway (WebSocket, :3000)
      → Hub + Agent Engine

${cyan("Examples:")}
  ${dim("# Start desktop app (recommended for local development)")}
  multica dev

  ${dim("# Start desktop with remote Gateway for mobile access")}
  GATEWAY_URL=http://localhost:3000 multica dev &
  multica dev gateway

  ${dim("# Start web app with gateway")}
  multica dev gateway &
  multica dev web
`);
}

interface DevOptions {
  service: Service;
  watch: boolean;
}

function parseArgs(argv: string[]): DevOptions {
  const args = [...argv];
  let service: Service = "desktop";
  let watch = true;

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      return { service: "help", watch };
    }
    if (arg === "--no-watch") {
      watch = false;
      continue;
    }

    // Service name
    if (["gateway", "web", "desktop", "all", "help"].includes(arg)) {
      service = arg as Service;
    }
  }

  return { service, watch };
}

function runCommand(command: string, args: string[], options: { name: string; color: string }) {
  console.log(`${options.color}[${options.name}]${"\x1b[0m"} Starting...`);

  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error(`${red(`[${options.name}]`)} Error: ${err.message}`);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${red(`[${options.name}]`)} Exited with code ${code}`);
    }
  });

  return child;
}

async function startGateway(watch: boolean) {
  const watchFlag = watch ? "--watch" : "";
  return runCommand("tsx", [watchFlag, "src/gateway/main.ts"].filter(Boolean), {
    name: "gateway",
    color: "\x1b[34m", // blue
  });
}

async function startWeb() {
  return runCommand("pnpm", ["--filter", "@multica/web", "dev"], {
    name: "web",
    color: "\x1b[32m", // green
  });
}

async function startDesktop() {
  return runCommand("pnpm", ["--filter", "@multica/desktop", "dev"], {
    name: "desktop",
    color: "\x1b[35m", // magenta
  });
}

async function startAll(watch: boolean) {
  console.log(`\n${cyan("Starting all services...")}\n`);
  console.log(`  ${"\x1b[34m"}Gateway${"\x1b[0m"}  → http://localhost:3000`);
  console.log(`  ${"\x1b[32m"}Web${"\x1b[0m"}      → http://localhost:3001`);
  console.log("");

  // Start all services
  const gateway = await startGateway(watch);
  const web = await startWeb();

  // Handle Ctrl+C
  const cleanup = () => {
    console.log(`\n${dim("Stopping all services...")}`);
    gateway.kill();
    web.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for all to exit
  await Promise.all([
    new Promise((resolve) => gateway.on("exit", resolve)),
    new Promise((resolve) => web.on("exit", resolve)),
  ]);
}

export async function devCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  switch (opts.service) {
    case "gateway":
      console.log(`\n${cyan("Starting Gateway...")} → http://localhost:3000\n`);
      await startGateway(opts.watch);
      break;

    case "web":
      console.log(`\n${cyan("Starting Web App...")} → http://localhost:3001\n`);
      await startWeb();
      break;

    case "desktop":
      console.log(`\n${cyan("Starting Desktop App...")}\n`);
      await startDesktop();
      break;

    case "all":
      await startAll(opts.watch);
      break;

    case "help":
    default:
      printHelp();
      break;
  }
}
