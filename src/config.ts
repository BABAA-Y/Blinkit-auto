import { resolve } from "node:path";
import type { EligibilityLimits } from "./models.js";

export interface Settings {
  databasePath: string;
  logLevel: string;
  schedulerIntervalMs: number;
  eligibilityLimits: EligibilityLimits;
  notificationProvider: "mock" | "telegram";
  telegramBotToken?: string;
  telegramChatId?: string;
}

export function settingsFromEnvironment(environment: NodeJS.ProcessEnv = process.env, projectDirectory = process.cwd()): Settings {
  const databasePath = resolve(projectDirectory, environment.BLINKIT_AUTO_DB_PATH ?? "data/blinkit_auto.sqlite3");
  const normalizedProjectDirectory = resolve(projectDirectory);
  const isInsideProject = databasePath === normalizedProjectDirectory || databasePath.startsWith(`${normalizedProjectDirectory}${process.platform === "win32" ? "\\" : "/"}`);
  if (!isInsideProject && environment.BLINKIT_AUTO_ALLOW_EXTERNAL_DB_PATH !== "true") {
    throw new Error("BLINKIT_AUTO_DB_PATH must stay inside the project directory; set BLINKIT_AUTO_ALLOW_EXTERNAL_DB_PATH=true to explicitly override");
  }
  return {
    databasePath,
    logLevel: logLevel(environment.BLINKIT_AUTO_LOG_LEVEL ?? "INFO"),
    schedulerIntervalMs: positiveInteger(environment.BLINKIT_AUTO_SCHEDULER_INTERVAL_MS ?? "300000", "BLINKIT_AUTO_SCHEDULER_INTERVAL_MS"),
    eligibilityLimits: {
      maximumOrderValuePaise: parseNonNegativeMoneyToPaise(environment.BLINKIT_AUTO_MAX_ORDER_VALUE ?? "500.00", "BLINKIT_AUTO_MAX_ORDER_VALUE"),
      dailySpendingLimitPaise: parseNonNegativeMoneyToPaise(environment.BLINKIT_AUTO_DAILY_SPENDING_LIMIT ?? "1000.00", "BLINKIT_AUTO_DAILY_SPENDING_LIMIT"),
      monthlySpendingLimitPaise: parseNonNegativeMoneyToPaise(environment.BLINKIT_AUTO_MONTHLY_SPENDING_LIMIT ?? "10000.00", "BLINKIT_AUTO_MONTHLY_SPENDING_LIMIT"),
      duplicateOrderWindowMinutes: nonNegativeInteger(environment.BLINKIT_AUTO_DUPLICATE_WINDOW_MINUTES ?? "60", "BLINKIT_AUTO_DUPLICATE_WINDOW_MINUTES"),
    },
    notificationProvider: (environment.BLINKIT_AUTO_NOTIFICATION_PROVIDER as "mock" | "telegram") ?? "mock",
    telegramBotToken: environment.BLINKIT_AUTO_TELEGRAM_BOT_TOKEN,
    telegramChatId: environment.BLINKIT_AUTO_TELEGRAM_CHAT_ID,
  };
}

function logLevel(value: string): string {
  const normalized = value.toUpperCase();
  if (normalized !== "INFO" && normalized !== "WARN" && normalized !== "ERROR") throw new Error("BLINKIT_AUTO_LOG_LEVEL must be INFO, WARN, or ERROR");
  return normalized;
}

export function parseNonNegativeMoneyToPaise(value: string, variableName: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`${variableName} must be a non-negative decimal number with at most two decimal places`);
  const [whole, fraction = ""] = value.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) throw new Error(`${variableName} is too large`);
  return paise;
}

function nonNegativeInteger(value: string, variableName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${variableName} must be a non-negative integer`);
  return parsed;
}

function positiveInteger(value: string, variableName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${variableName} must be a positive integer`);
  return parsed;
}
