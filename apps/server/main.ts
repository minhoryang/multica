import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors();
  app.useLogger(app.get(Logger));

  const port = process.env["PORT"] ?? 4000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Console is running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error("Failed to start console:", err);
  process.exit(1);
});
