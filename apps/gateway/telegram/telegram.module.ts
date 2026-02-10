/**
 * Telegram module for Gateway.
 *
 * Provides Telegram webhook functionality.
 */

import { Module } from "@nestjs/common";
import { TelegramController } from "./telegram.controller.js";
import { TelegramService } from "./telegram.service.js";
import { TelegramUserStore } from "./telegram-user.store.js";

@Module({
  controllers: [TelegramController],
  providers: [TelegramService, TelegramUserStore],
  exports: [TelegramService],
})
export class TelegramModule {}
