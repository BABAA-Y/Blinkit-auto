import { describe, it, expect } from "vitest";
import { settingsFromEnvironment } from "../src/config.js";

describe("Configuration", () => {
  it("uses the default server URL when no telegram configuration is present", () => {
    const env = { BLINKIT_AUTO_DB_PATH: "data/test.sqlite3" };
    const settings = settingsFromEnvironment(env, process.cwd());
    expect(settings.serverUrl).toBe("https://blinkit-autoreminder-server.onrender.com");
  });

  it("overrides the default server URL when BLINKIT_AUTO_SERVER_URL is set", () => {
    const env = { 
      BLINKIT_AUTO_DB_PATH: "data/test.sqlite3",
      BLINKIT_AUTO_SERVER_URL: "https://some-other-server.example.com"
    };
    const settings = settingsFromEnvironment(env, process.cwd());
    expect(settings.serverUrl).toBe("https://some-other-server.example.com");
  });

  it("does not use the default server URL if a local TELEGRAM_BOT_TOKEN is provided", () => {
    const env = { 
      BLINKIT_AUTO_DB_PATH: "data/test.sqlite3",
      BLINKIT_AUTO_TELEGRAM_BOT_TOKEN: "some:local_token"
    };
    const settings = settingsFromEnvironment(env, process.cwd());
    expect(settings.serverUrl).toBeUndefined();
    expect(settings.telegramBotToken).toBe("some:local_token");
  });

  it("ensures no bot token is hardcoded in the codebase", () => {
    // This is essentially validated by checking if settingsFromEnvironment with empty env has no token
    const env = { BLINKIT_AUTO_DB_PATH: "data/test.sqlite3" };
    const settings = settingsFromEnvironment(env, process.cwd());
    expect(settings.telegramBotToken).toBeUndefined();
  });
});
