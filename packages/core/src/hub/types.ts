export interface Message {
  readonly id: string;
  readonly content: string;
}

export interface HubOptions {
  /** Remote Gateway WebSocket address, e.g. "http://localhost:3000" */
  url: string;
  /** WebSocket path, defaults to "/ws" */
  path?: string | undefined;
}
