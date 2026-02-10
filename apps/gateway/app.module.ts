import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { LoggerModule } from "nestjs-pino";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppController } from "./app.controller.js";
import { DatabaseModule } from "./database/database.module.js";
import { GatewayModule } from "./gateway.module.js";
import { TelegramModule } from "./telegram/telegram.module.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "public"),
      serveRoot: "/client",
    }),
    LoggerModule.forRoot({
      pinoHttp: isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                singleLine: true,
              },
            },
            level: process.env.LOG_LEVEL ?? "debug",
          }
        : {
            level: process.env.LOG_LEVEL ?? "info",
          },
    }),
    DatabaseModule,
    GatewayModule,
    TelegramModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
