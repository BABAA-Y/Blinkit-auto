export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  public constructor(level = "INFO") {
    const levels: Record<string, number> = { INFO: 0, WARN: 1, ERROR: 2 };
    this.threshold = levels[level] ?? 0;
  }

  public info(message: string, fields: Record<string, unknown> = {}): void {
    this.log("INFO", message, fields);
  }

  public warn(message: string, fields: Record<string, unknown> = {}): void { this.log("WARN", message, fields); }
  public error(message: string, fields: Record<string, unknown> = {}): void { this.log("ERROR", message, fields); }

  private log(level: "INFO" | "WARN" | "ERROR", message: string, fields: Record<string, unknown>): void {
    const levels = { INFO: 0, WARN: 1, ERROR: 2 };
    if (levels[level] < this.threshold) return;
    console.info(JSON.stringify({ level, message, ...fields }));
  }
}

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class FileLogger implements Logger {
  private readonly threshold: number;

  public constructor(private readonly path: string, level = "INFO") {
    const levels: Record<string, number> = { INFO: 0, WARN: 1, ERROR: 2 };
    this.threshold = levels[level] ?? 0;
    mkdirSync(dirname(this.path), { recursive: true });
  }

  public info(message: string, fields: Record<string, unknown> = {}): void { this.log("INFO", message, fields); }
  public warn(message: string, fields: Record<string, unknown> = {}): void { this.log("WARN", message, fields); }
  public error(message: string, fields: Record<string, unknown> = {}): void { this.log("ERROR", message, fields); }

  private log(level: "INFO" | "WARN" | "ERROR", message: string, fields: Record<string, unknown>): void {
    const levels = { INFO: 0, WARN: 1, ERROR: 2 };
    if (levels[level] < this.threshold) return;
    appendFileSync(this.path, JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields }) + "\n");
  }
}
