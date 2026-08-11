import type { NotificationProvider } from "../integrations/providers.js";
import type { TerminalUI } from "../ui/output.js";

export class MockNotificationProvider implements NotificationProvider {
  public messages: string[] = [];
  public shouldFail = false;

  public constructor(private readonly ui?: TerminalUI) {}

  public notify(message: string): void {
    if (this.shouldFail) throw new Error("Mock notification failure");
    this.messages.push(message);
    if (this.ui) {
      this.ui.header("Mock Notification");
      this.ui.message(`🚨 Blinkit Wishlist Update\n${message}`);
    }
  }
}
