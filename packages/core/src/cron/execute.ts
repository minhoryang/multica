/**
 * Cron Job Execution
 *
 * Handles the actual execution of cron job payloads.
 * Based on OpenClaw's implementation (MIT License)
 */

import type { CronJob } from "./types.js";
import { getHub, isHubInitialized } from "../hub/hub-singleton.js";

/** Execution result */
export type ExecutionResult = {
  summary?: string;
  error?: string;
};

/**
 * Execute a cron job payload.
 *
 * For system-event: Injects text into the main session
 * For agent-turn: Creates an isolated agent turn
 */
export async function executeCronJob(job: CronJob): Promise<ExecutionResult> {
  const { payload } = job;

  switch (payload.kind) {
    case "system-event":
      return executeSystemEvent(job);
    case "agent-turn":
      return executeAgentTurn(job);
    default:
      return { error: `Unknown payload kind: ${(payload as { kind: string }).kind}` };
  }
}

/**
 * Execute a system-event payload.
 * Injects the text into the main session as a system message.
 */
async function executeSystemEvent(job: CronJob): Promise<ExecutionResult> {
  if (!isHubInitialized()) {
    return { error: "Hub not available" };
  }
  const hub = getHub();

  const payload = job.payload as { kind: "system-event"; text: string };
  const text = payload.text.trim();
  if (!text) {
    return { error: "system-event payload requires non-empty text" };
  }

  // Get the list of active agents
  const agentIds = hub.listAgents();
  if (agentIds.length === 0) {
    return { error: "No active agents" };
  }

  // For now, inject into the first (main) agent
  // TODO: Support targeting specific agent by ID
  const agentId = agentIds[0]!;
  const cronMessage = `[CRON] ${job.name}: ${text}`;

  hub.enqueueSystemEvent(cronMessage, { agentId });

  if (job.wakeMode === "now") {
    const result = await hub.runHeartbeatOnce({ reason: `cron:${job.id}` });
    if (result.status === "failed") {
      return { error: result.reason };
    }
    if (result.status === "skipped") {
      return {
        summary: `Enqueued cron event for agent ${agentId.slice(0, 8)} (wake skipped: ${result.reason})`,
      };
    }
    return {
      summary: `Enqueued cron event and triggered immediate heartbeat for agent ${agentId.slice(0, 8)}`,
    };
  }

  hub.requestHeartbeatNow({ reason: `cron:${job.id}` });
  return {
    summary: `Enqueued cron event for agent ${agentId.slice(0, 8)} (wakeMode: next-heartbeat)`,
  };
}

/**
 * Execute an agent-turn payload.
 * Creates an isolated subagent to run the task.
 */
async function executeAgentTurn(job: CronJob): Promise<ExecutionResult> {
  if (!isHubInitialized()) {
    return { error: "Hub not available" };
  }
  const hub = getHub();

  const payload = job.payload as {
    kind: "agent-turn";
    message: string;
    model?: string;
    thinkingLevel?: string;
    timeoutSeconds?: number;
  };

  // Generate a unique session ID for this isolated run
  const sessionId = `cron-${job.id}-${Date.now()}`;

  try {
    // Create isolated subagent
    // TODO: Support model/thinkingLevel override
    const agent = hub.createSubagent(sessionId, {
      profileId: "default",
    });

    // Set up timeout if specified
    const timeoutMs = (payload.timeoutSeconds ?? 300) * 1000; // default 5 minutes
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<ExecutionResult>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Cron job timed out after ${payload.timeoutSeconds}s`));
      }, timeoutMs);
    });

    // Execute the agent turn
    const executePromise = (async (): Promise<ExecutionResult> => {
      const cronMessage = `[CRON Job: ${job.name}]\n\n${payload.message}`;
      agent.write(cronMessage);
      await agent.waitForIdle();
      return { summary: `Completed agent turn in isolated session ${sessionId.slice(0, 16)}` };
    })();

    // Race between execution and timeout
    const result = await Promise.race([executePromise, timeoutPromise]);

    // Clear timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    // Close the subagent
    agent.close();

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
