/**
 * Gateway types.
 */

/** Virtual device handler for non-socket devices (e.g., Telegram) */
export interface VirtualDeviceHandler {
  sendCallback: (event: string, data: unknown) => void | Promise<void>;
}
