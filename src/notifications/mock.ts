import type { NotificationProvider } from "../integrations/providers.js";

export class MockNotificationProvider implements NotificationProvider {
  public messages: string[] = [];
  public shouldFail = false;

  public notify(message: string): void {
    if (this.shouldFail) throw new Error("Mock notification failure");
    this.messages.push(message);
  }
}
