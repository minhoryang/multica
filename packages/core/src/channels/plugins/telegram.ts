/**
 * Telegram channel plugin.
 *
 * Uses grammy to connect to Telegram Bot API via long polling.
 * - Private chats: all messages are processed
 * - Group chats: only messages that @mention the bot or reply to the bot
 *
 * @see docs/channels/README.md — Channel system overview
 * @see docs/channels/media-handling.md — Media processing pipeline
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { Bot, GrammyError } from "grammy";
import type { ChannelPlugin, ChannelMessage, ChannelConfigAdapter, ChannelsConfig, DeliveryContext } from "../types.js";
import { markdownToTelegramHtml } from "./telegram-format.js";
import { MEDIA_CACHE_DIR } from "@multica/utils";

/** Telegram account config shape */
interface TelegramAccountConfig {
  botToken: string;
}

/** Keep bot instances per account for outbound use */
const bots = new Map<string, Bot>();

/** Check if a GrammyError is an HTML parse failure */
function isParseError(err: unknown): boolean {
  return err instanceof GrammyError && err.description.includes("can't parse entities");
}

/** Send a message with HTML formatting, fallback to plain text on parse error */
async function sendFormatted(
  bot: Bot,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const html = markdownToTelegramHtml(text);
  try {
    await bot.api.sendMessage(chatId, html, { ...extra, parse_mode: "HTML" });
  } catch (err) {
    if (isParseError(err)) {
      console.warn("[Telegram] HTML parse failed, retrying as plain text");
      await bot.api.sendMessage(chatId, text, extra);
    } else {
      throw err;
    }
  }
}

export const telegramChannel: ChannelPlugin = {
  id: "telegram",
  meta: {
    name: "Telegram",
    description: "Telegram bot integration via long polling",
  },
  chunkerConfig: {
    minChars: 3800, // Buffer the full response; only chunk when approaching platform limit
    maxChars: 4000, // Telegram API limit: 4096; leave room for HTML formatting overhead
    breakPreference: "paragraph",
  },

  config: {
    listAccountIds(config: ChannelsConfig): string[] {
      const section = config["telegram"];
      return section ? Object.keys(section) : [];
    },

    resolveAccount(config: ChannelsConfig, accountId: string): Record<string, unknown> | undefined {
      return config["telegram"]?.[accountId];
    },

    isConfigured(account: Record<string, unknown>): boolean {
      return Boolean((account as unknown as TelegramAccountConfig).botToken);
    },
  } satisfies ChannelConfigAdapter,

  gateway: {
    async start(
      accountId: string,
      config: Record<string, unknown>,
      onMessage: (message: ChannelMessage) => void,
      signal: AbortSignal,
    ): Promise<void> {
      const { botToken } = config as unknown as TelegramAccountConfig;

      const bot = new Bot(botToken);
      bots.set(accountId, bot);

      // Get bot info for mention/reply detection
      const botInfo = await bot.api.getMe();
      const botId = botInfo.id;
      const botUsername = botInfo.username;
      console.log(`[Telegram] Starting bot: @${botUsername} (id=${botId})`);

      // ── Sequentialize middleware ──
      // Ensures updates from the same chat are processed one at a time,
      // preventing race conditions on shared state (e.g. ChannelManager.lastRoute).
      // Grammy processes updates concurrently by default — without this,
      // two messages arriving near-simultaneously could interleave.
      // Lightweight alternative to @grammyjs/runner's sequentialize().
      // @see docs/channel/openclaw-research.md — Grammy middleware pipeline
      const chatQueues = new Map<string, Promise<void>>();
      bot.use(async (ctx, next) => {
        const chatId = ctx.chat?.id;
        if (!chatId) return next();

        const key = String(chatId);
        const prev = chatQueues.get(key) ?? Promise.resolve();

        // Chain this handler onto the per-chat queue
        const current = prev.then(() => next()).catch(() => {});
        chatQueues.set(key, current);
        await current;

        // Clean up resolved entries to prevent memory leak
        if (chatQueues.get(key) === current) {
          chatQueues.delete(key);
        }
      });

      // Handle text messages
      bot.on("message:text", (ctx) => {
        const msg = ctx.message;
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

        // In groups, only respond if bot is mentioned or replied to
        if (isGroup) {
          const isMentioned = msg.entities?.some(
            (e) =>
              e.type === "mention" &&
              msg.text.substring(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername?.toLowerCase()}`,
          );
          const isReplyToBot = msg.reply_to_message?.from?.id === botId;

          if (!isMentioned && !isReplyToBot) {
            return; // Ignore group messages not directed at bot
          }
          console.log(`[Telegram] Received message: chatId=${msg.chat.id} from=${msg.from?.id} type=group text="${msg.text.slice(0, 50)}"`);
        } else {
          console.log(`[Telegram] Received message: chatId=${msg.chat.id} from=${msg.from?.id} type=direct text="${msg.text.slice(0, 50)}"`);
        }

        // Strip @mention from text for cleaner agent input
        let text = msg.text;
        if (botUsername) {
          text = text.replace(new RegExp(`@${botUsername}\\s*`, "gi"), "").trim();
        }
        if (!text) return;

        onMessage({
          messageId: String(msg.message_id),
          conversationId: String(msg.chat.id),
          senderId: String(msg.from?.id ?? "unknown"),
          text,
          chatType: isGroup ? "group" : "direct",
        });
      });

      // Handle media messages (voice, audio, photo, video, document)
      const mediaTypes = [
        { filter: "message:voice" as const, getMedia: (msg: any) => ({
          type: "audio" as const,
          fileId: msg.voice.file_id as string,
          mimeType: msg.voice.mime_type as string | undefined,
          duration: msg.voice.duration as number | undefined,
        })},
        { filter: "message:audio" as const, getMedia: (msg: any) => ({
          type: "audio" as const,
          fileId: msg.audio.file_id as string,
          mimeType: msg.audio.mime_type as string | undefined,
          duration: msg.audio.duration as number | undefined,
        })},
        { filter: "message:photo" as const, getMedia: (msg: any) => {
          // Pick the largest photo size (last in array)
          const photos = msg.photo as Array<{ file_id: string }>;
          const largest = photos[photos.length - 1]!;
          return {
            type: "image" as const,
            fileId: largest.file_id,
            mimeType: "image/jpeg",
          };
        }},
        { filter: "message:video" as const, getMedia: (msg: any) => ({
          type: "video" as const,
          fileId: msg.video.file_id as string,
          mimeType: msg.video.mime_type as string | undefined,
          duration: msg.video.duration as number | undefined,
        })},
        { filter: "message:document" as const, getMedia: (msg: any) => ({
          type: "document" as const,
          fileId: msg.document.file_id as string,
          mimeType: msg.document.mime_type as string | undefined,
        })},
      ] as const;

      for (const { filter, getMedia } of mediaTypes) {
        bot.on(filter, (ctx) => {
          const msg = ctx.message;
          const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

          if (isGroup) {
            const isReplyToBot = msg.reply_to_message?.from?.id === botId;
            const caption = (msg as any).caption as string | undefined;
            const isMentionedInCaption = caption && botUsername
              ? caption.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
              : false;
            if (!isReplyToBot && !isMentionedInCaption) return;
          }

          const media = getMedia(msg);
          const caption = (msg as any).caption as string | undefined;
          console.log(`[Telegram] Received ${media.type}: chatId=${msg.chat.id} from=${msg.from?.id} fileId=${media.fileId}`);

          onMessage({
            messageId: String(msg.message_id),
            conversationId: String(msg.chat.id),
            senderId: String(msg.from?.id ?? "unknown"),
            text: caption ?? "",
            chatType: isGroup ? "group" : "direct",
            media: {
              type: media.type,
              fileId: media.fileId,
              mimeType: media.mimeType,
              duration: (media as any).duration,
              caption,
            },
          });
        });
      }

      // Graceful shutdown on abort
      signal.addEventListener("abort", () => {
        console.log("[Telegram] Bot stopped");
        bot.stop();
        bots.delete(accountId);
      });

      // Start long polling (fire-and-forget, errors are caught here)
      console.log("[Telegram] Bot is polling for messages");
      bot.start({
        onStart: () => {
          // Already logged above
        },
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("409") || msg.includes("Conflict")) {
          console.error(`[Telegram] Bot conflict: another instance is already polling with this token. Stop the other process and restart.`);
        } else {
          console.error(`[Telegram] Bot polling error: ${msg}`);
        }
        bots.delete(accountId);
      });
    },
  },

  outbound: {
    async sendText(ctx: DeliveryContext, text: string): Promise<void> {
      const bot = bots.get(ctx.accountId);
      if (!bot) throw new Error(`No Telegram bot for account ${ctx.accountId}`);

      console.log(`[Telegram] Sending message to chatId=${ctx.conversationId}`);
      await sendFormatted(bot, Number(ctx.conversationId), text);
    },

    async replyText(ctx: DeliveryContext, text: string): Promise<void> {
      const bot = bots.get(ctx.accountId);
      if (!bot) throw new Error(`No Telegram bot for account ${ctx.accountId}`);

      if (ctx.replyToMessageId) {
        console.log(`[Telegram] Sending reply to chatId=${ctx.conversationId} (replyTo=${ctx.replyToMessageId})`);
        await sendFormatted(bot, Number(ctx.conversationId), text, {
          reply_to_message_id: Number(ctx.replyToMessageId),
        });
      } else {
        await telegramChannel.outbound.sendText(ctx, text);
      }
    },

    async sendTyping(ctx: DeliveryContext): Promise<void> {
      const bot = bots.get(ctx.accountId);
      if (!bot) return;

      try {
        await bot.api.sendChatAction(Number(ctx.conversationId), "typing");
      } catch {
        // Best-effort — typing indicator failure is not critical
      }
    },

    async addReaction(ctx: DeliveryContext, emoji: string): Promise<void> {
      const bot = bots.get(ctx.accountId);
      if (!bot || !ctx.replyToMessageId) return;

      try {
        await bot.api.setMessageReaction(
          Number(ctx.conversationId),
          Number(ctx.replyToMessageId),
          // Grammy expects a specific emoji union type; cast since our interface accepts any string
          [{ type: "emoji", emoji } as unknown as { type: "emoji"; emoji: "👀" }],
        );
      } catch {
        // Best-effort — reaction failure is not critical
        // (e.g. bot may lack permission in some groups)
      }
    },

    async removeReaction(ctx: DeliveryContext): Promise<void> {
      const bot = bots.get(ctx.accountId);
      if (!bot || !ctx.replyToMessageId) return;

      try {
        await bot.api.setMessageReaction(
          Number(ctx.conversationId),
          Number(ctx.replyToMessageId),
          [], // Empty array clears all bot reactions
        );
      } catch {
        // Best-effort
      }
    },
  },

  async downloadMedia(fileId: string, accountId: string): Promise<string> {
    const bot = bots.get(accountId);
    if (!bot) throw new Error(`No Telegram bot for account ${accountId}`);

    const file = await bot.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) throw new Error(`Telegram returned no file_path for fileId=${fileId}`);

    const url = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
    const ext = extname(filePath) || ".bin";
    const localPath = join(MEDIA_CACHE_DIR, `${uuidv7()}${ext}`);

    await mkdir(MEDIA_CACHE_DIR, { recursive: true });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download file: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buffer);

    console.log(`[Telegram] Downloaded media: ${filePath} → ${localPath}`);
    return localPath;
  },
};
