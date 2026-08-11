import type { NotificationProvider } from "../integrations/providers.js";

export class TelegramNotificationProvider implements NotificationProvider {
  public constructor(
    private readonly botToken: string,
    private readonly chatId: string
  ) {}

  public async notify(message: string): Promise<void> {
    if (!this.botToken || !this.chatId) return;
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
  }
}
