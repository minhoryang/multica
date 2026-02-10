import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";

console.log("[Gateway] Starting bootstrap...");

async function bootstrap(): Promise<void> {
  console.log("[Gateway] Creating NestFactory...");
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false });
    console.log("[Gateway] NestFactory created");

    app.useLogger(app.get(Logger));

    const port = process.env["PORT"] ?? 3000;
    console.log(`[Gateway] Listening on port ${port}...`);
    await app.listen(port);

    const logger = app.get(Logger);
    logger.log(`Gateway is running on http://localhost:${port}`);
    logger.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
  } catch (err) {
    console.error("[Gateway] Error during bootstrap:", err);
    throw err;
  }
}

bootstrap().catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
