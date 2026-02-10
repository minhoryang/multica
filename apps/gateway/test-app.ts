import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { DatabaseModule } from "./database/database.module.js";
import { GatewayModule } from "./gateway.module.js";
import { TelegramModule } from "./telegram/telegram.module.js";

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { level: "debug" } }),
    DatabaseModule,
    GatewayModule,
    TelegramModule,
  ],
})
class TestAppModule {}

console.log("Creating test app...");
NestFactory.create(TestAppModule, { abortOnError: true })
  .then(async (app) => {
    console.log("Test app created!");
    await app.listen(3000);
    console.log("Listening on 3000!");
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
