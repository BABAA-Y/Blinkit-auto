import type { Logger } from "./logging.js";

export interface RunnableWorker {
  runOnce(): unknown;
}

/** Local interval scheduler. It owns no database connection, so stopping it is safe. */
export class WishlistScheduler {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly worker: RunnableWorker,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  public get isRunning(): boolean { return this.timer !== undefined; }

  public start(): void {
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) throw new Error("Scheduler interval must be a positive integer");
    if (this.timer !== undefined) return;
    this.runWorker();
    this.timer = setInterval(() => this.runWorker(), this.intervalMs);
    this.logger.info("Wishlist scheduler started", { intervalMs: this.intervalMs });
  }

  public stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.info("Wishlist scheduler stopped");
  }

  private runWorker(): void {
    try {
      this.worker.runOnce();
    } catch (error) {
      this.logger.error("Scheduled worker run failed", { error: diagnosticMessage(error) });
    }
  }
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
