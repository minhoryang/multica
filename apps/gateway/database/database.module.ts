/**
 * Database module for Gateway.
 *
 * Global module that provides DatabaseService to all other modules.
 */

import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
