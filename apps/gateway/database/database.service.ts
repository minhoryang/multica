/**
 * MySQL database service for Gateway.
 *
 * Provides a connection pool and query interface.
 * Configuration is read from MYSQL_DSN environment variable.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import mysql from "mysql2/promise";
import type { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from "mysql2/promise";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;

  async onModuleInit(): Promise<void> {
    console.log("[DatabaseService] onModuleInit starting...");
    const dsn = process.env["MYSQL_DSN"];
    if (!dsn) {
      console.log("[DatabaseService] MYSQL_DSN not set");
      this.logger.warn("MYSQL_DSN not set, database features disabled");
      return;
    }

    try {
      console.log("[DatabaseService] Parsing DSN...");
      const config = this.parseDsn(dsn);
      console.log("[DatabaseService] Creating pool...");
      this.pool = mysql.createPool(config);

      // Test connection
      console.log("[DatabaseService] Testing connection...");
      const connection = await this.pool.getConnection();
      connection.release();
      console.log("[DatabaseService] Connected!");
      this.logger.log(`MySQL connected (host=${config.host}, database=${config.database})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[DatabaseService] Error:", message);
      this.logger.error(`Failed to connect to MySQL: ${message}`);
      // Graceful degradation: close broken pool, keep this.pool = null
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log("MySQL connection pool closed");
    }
  }

  /** Check if database is available */
  isAvailable(): boolean {
    return this.pool !== null;
  }

  /** Execute a query and return rows */
  async query<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T> {
    if (!this.pool) {
      throw new Error("Database not available");
    }
    const [rows] = await this.pool.query<T>(sql, params);
    return rows;
  }

  /** Execute an insert/update/delete and return result */
  async execute(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
    if (!this.pool) {
      throw new Error("Database not available");
    }
    const [result] = await this.pool.execute<ResultSetHeader>(sql, params);
    return result;
  }

  /** Parse MySQL DSN string into connection options */
  private parseDsn(dsn: string): PoolOptions {
    // Format: mysql://user:password@host:port/database
    const url = new URL(dsn);

    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading /
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };
  }
}
