import type { NotificationProvider } from "../integrations/providers.js";

export class TelegramNotificationProvider implements NotificationProvider {
  public constructor(
    private readonly botToken?: string,
    private readonly chatId?: string,
    private readonly serverUrl?: string,
    private readonly userToken?: string
  ) {}

  public async notify(message: string): Promise<void> {
    if (this.botToken && this.chatId) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: this.chatId, text: message }),
        });
        if (!response.ok) {
          throw new Error(`Telegram API responded with status ${response.status}`);
        }
      } catch (error) {
        throw new Error(`Failed to send Telegram notification: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (this.serverUrl && this.userToken) {
      try {
        const url = this.serverUrl.endsWith("/") ? this.serverUrl.slice(0, -1) : this.serverUrl;
        const response = await fetch(`${url}/api/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userToken: this.userToken, message }),
        });
        if (!response.ok) {
          throw new Error(`Backend server responded with status ${response.status}`);
        }
      } catch (error) {
        throw new Error(`Failed to send Telegram notification via backend: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
