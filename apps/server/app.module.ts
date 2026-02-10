import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { LoggerModule } from "nestjs-pino";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppController } from "./app.controller.js";
import { Hub } from "@multica/core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = process.env["NODE_ENV"] !== "production";

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "public"),
      serveRoot: "/",
      exclude: ["/api/(.*)"],
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
            level: process.env["LOG_LEVEL"] ?? "debug",
          }
        : {
            level: process.env["LOG_LEVEL"] ?? "info",
          },
    }),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: "HUB",
      useFactory: () => {
        const gatewayUrl =
          process.env["GATEWAY_URL"] ?? "http://localhost:3000";
        return new Hub(gatewayUrl);
      },
    },
  ],
})
export class AppModule {}
