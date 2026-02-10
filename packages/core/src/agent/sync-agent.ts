import { Agent } from "./runner.js";
import type { AgentOptions, AgentRunResult } from "./types.js";

export class SyncAgent {
  private readonly agent: Agent;
  readonly sessionId: string;

  constructor(options?: AgentOptions) {
    this.agent = new Agent(options);
    this.sessionId = this.agent.sessionId;
  }

  async run(prompt: string): Promise<AgentRunResult> {
    return this.agent.run(prompt);
  }
}
