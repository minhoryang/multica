/**
 * Channel plugin system types.
 *
 * Each messaging platform (Telegram, Discord, Feishu, etc.) implements the
 * ChannelPlugin interface with three adapters: config, gateway, outbound.
 *
 * @see docs/channels/README.md — Channel system overview and plugin guide
 */

import type { BlockChunkerConfig } from "../hub/block-chunker.js";

// ─── Media Attachment ───

/** Media type for incoming channel attachments */
export type ChannelMediaType = "audio" | "image" | "video" | "document";

/** Media attachment from a channel message */
export interface ChannelMediaAttachment {
  /** Media type */
  type: ChannelMediaType;
  /** Platform-specific file ID (used for download) */
  fileId: string;
  /** MIME type if known (e.g. "audio/ogg", "image/jpeg") */
  mimeType?: string | undefined;
  /** Duration in seconds (for audio/video) */
  duration?: number | undefined;
  /** Caption text attached to the media */
  caption?: string | undefined;
}

// ─── Normalized Incoming Message ───

/** Platform-agnostic incoming message */
export interface ChannelMessage {
  /** Unique message ID from the platform */
  messageId: string;
  /** Conversation ID (group ID or DM chat ID) */
  conversationId: string;
  /** Sender identifier on the platform */
  senderId: string;
  /** Plain text content */
  text: string;
  /** Chat type: "direct" (1:1) or "group" */
  chatType: "direct" | "group";
  /** Optional media attachment (voice, image, video, document) */
  media?: ChannelMediaAttachment | undefined;
}

// ─── Delivery Context ───

/** Context for sending a reply back to a specific conversation */
export interface DeliveryContext {
  /** Channel plugin ID (e.g. "telegram", "discord") */
  channel: string;
  /** Account identifier (supports multi-account per channel) */
  accountId: string;
  /** Target conversation ID */
  conversationId: string;
  /** Original message ID (for reply-style responses) */
  replyToMessageId?: string | undefined;
}

// ─── Config Adapter ───

/** Resolves and validates channel credentials from the config file */
export interface ChannelConfigAdapter<TAccount = Record<string, unknown>> {
  /** List all configured account IDs for this channel */
  listAccountIds(config: ChannelsConfig): string[];
  /** Resolve a specific account's config */
  resolveAccount(config: ChannelsConfig, accountId: string): TAccount | undefined;
  /** Check if a given account config has all required credentials */
  isConfigured(account: TAccount): boolean;
}

// ─── Gateway Adapter ───

/** Manages the lifecycle of a channel account connection (receiving messages) */
export interface ChannelGatewayAdapter {
  /**
   * Start receiving messages for an account.
   * Must respect the AbortSignal for graceful shutdown.
   */
  start(
    accountId: string,
    config: Record<string, unknown>,
    onMessage: (message: ChannelMessage) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

// ─── Outbound Adapter ───

/** Sends messages back to the platform */
export interface ChannelOutboundAdapter {
  /** Send a text message to a conversation */
  sendText(ctx: DeliveryContext, text: string): Promise<void>;
  /** Reply to a specific message */
  replyText(ctx: DeliveryContext, text: string): Promise<void>;
  /** Send "typing" indicator (optional, not all platforms support it) */
  sendTyping?(ctx: DeliveryContext): Promise<void>;
  /**
   * Add a reaction emoji to the incoming message (optional).
   * Used for ACK feedback — e.g. 👀 to signal "processing started".
   */
  addReaction?(ctx: DeliveryContext, emoji: string): Promise<void>;
  /**
   * Remove reaction from the incoming message (optional).
   * Called when processing completes to clear the ACK indicator.
   */
  removeReaction?(ctx: DeliveryContext): Promise<void>;
}

// ─── Channel Plugin ───

/** The main plugin interface. Each channel implements this. */
export interface ChannelPlugin {
  /** Unique channel identifier (e.g. "telegram", "discord", "feishu") */
  readonly id: string;
  /** Display metadata */
  readonly meta: {
    name: string;
    description: string;
  };
  /** Optional chunker config override per channel */
  readonly chunkerConfig?: BlockChunkerConfig | undefined;
  /** Config resolution adapter */
  readonly config: ChannelConfigAdapter;
  /** Connection lifecycle adapter (receive messages) */
  readonly gateway: ChannelGatewayAdapter;
  /** Message sending adapter */
  readonly outbound: ChannelOutboundAdapter;
  /** Download a media file to local disk (optional, platform-specific) */
  downloadMedia?(fileId: string, accountId: string): Promise<string>;
}

// ─── Channels Config File Shape ───

/**
 * Shape of ~/.super-multica/channels.json5
 *
 * Each top-level key is a channel ID. Under it, each key is an account ID.
 * Example:
 * {
 *   telegram: { default: { botToken: "xxx" } },
 *   discord: { default: { botToken: "xxx" } },
 * }
 */
export interface ChannelsConfig {
  [channelId: string]: {
    [accountId: string]: Record<string, unknown>;
  } | undefined;
}

// ─── Account State ───

export type ChannelAccountStatus = "stopped" | "starting" | "running" | "error";

export interface ChannelAccountState {
  channelId: string;
  accountId: string;
  status: ChannelAccountStatus;
  error?: string | undefined;
}
