import type { NotificationProvider } from "../integrations/providers.js";
import type { Logger } from "../logging.js";

export class MockNotificationProvider implements NotificationProvider {
  public messages: string[] = [];
  public shouldFail = false;

  public constructor(private readonly logger?: Logger) {}

  public notify(message: string): void {
    if (this.shouldFail) throw new Error("Mock notification failure");
    this.messages.push(message);
    if (this.logger) {
      this.logger.info(`[MOCK NOTIFICATION]\n🚨 Blinkit Wishlist Update\n${message}`);
    }
  }
}
