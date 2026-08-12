# Blinkit-Auto

A safe, local-first TypeScript/Node.js automation foundation. It deliberately contains **no Blinkit purchasing integration**, login flow, checkout flow, credential handling, or payment execution. The supplied adapters are mocks so workflow behavior can be tested without contacting Blinkit or a payment provider.

## Architecture

```text
application (workflow orchestration)
├── ai/             decision interface and deterministic local decision maker
├── automation/     rules and workflow guardrails
├── integrations/   Blinkit port plus local/mock catalog adapter
├── payments/       payment port plus rejection-only local adapter
├── storage/        SQLite repository
├── logging_config  safe application logging
└── config          environment-based settings
```

The local worker loads wishlist items from SQLite, obtains mock catalog results, applies deterministic rules, and records every decision in SQLite. It never purchases an item.

## Quick start

Requires Node.js 24+ and npm. SQLite persistence uses Node's built-in `node:sqlite`; the only npm dependencies are TypeScript tooling and Vitest.

```powershell
$env:BLINKIT_AUTO_DB_PATH = "data/blinkit_auto.sqlite3"
npm run build
npm test
npm start -- run-once
npm start -- run
npm start -- status
npm start -- wishlist list
npm start -- wishlist add milk mock-milk-1 "Milk (1 L)" 1 70.00 60 enabled
npm start -- wishlist disable milk
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BLINKIT_AUTO_DB_PATH` | `data/blinkit_auto.sqlite3` | SQLite database location, relative to project root unless absolute. |
| `BLINKIT_AUTO_LOG_LEVEL` | `INFO` | Application log level. |
| `BLINKIT_AUTO_MAX_ORDER_VALUE` | `500.00` | Maximum value for one locally approved wishlist item. |
| `BLINKIT_AUTO_DAILY_SPENDING_LIMIT` | `1000.00` | Maximum total value of locally approved decisions per UTC day. |
| `BLINKIT_AUTO_MONTHLY_SPENDING_LIMIT` | `10000.00` | Maximum total value of locally approved decisions per UTC month. |
| `BLINKIT_AUTO_DUPLICATE_WINDOW_MINUTES` | `60` | Minimum interval before a product can receive another local approval. |
| `BLINKIT_AUTO_SCHEDULER_INTERVAL_MS` | `300000` | Interval in milliseconds for continuous local worker runs. |
| `BLINKIT_AUTO_NOTIFICATION_PROVIDER` | `mock` | Can be set to `telegram` for real notifications. |
| `BLINKIT_AUTO_SERVER_URL` | | URL for the Telegram linking backend server (used by CLI). |
| `TELEGRAM_BOT_TOKEN` | | Server-side only: Telegram bot token. |
| `PORT` | `3000` | Server-side only: Port to listen on. |
| `DATABASE_PATH` | `data/blinkit_auto.sqlite3` | Server-side only: Path to server database. |

You can place your local environment configuration in a `.env` file at the root of the project (this file is ignored by Git). See `.env.example` for placeholder values. Existing environment variables will take precedence over `.env` values.

Do not put secrets in the repository. In particular, never provide passwords, OTPs, payment PINs, card PINs, banking credentials, or authentication tokens to this project.

Wishlist commands use only the local SQLite database. `wishlist add` accepts `<id> <product-id> <product-name> <quantity> <max-unit-price> <cooldown-minutes> [enabled|disabled]`; items may then be listed, enabled, disabled, or removed. Prices are decimal currency values with at most two decimal places; quantities and cooldowns are non-negative validated integers (quantity must be greater than zero).

## Telegram User Linking

Blinkit-Auto CLI allows you to connect your Telegram account easily, without managing bot tokens directly!

**Connecting Telegram via the CLI:**
1. Launch the interactive UI using `blinkit-auto` (or `npm start`).
2. Go to **7. Settings** -> **Connect Telegram**.
3. The CLI will request a short-lived linking session from the backend (`BLINKIT_AUTO_SERVER_URL`) and display a unique deep link, such as:
   `https://t.me/BlinkitAutoBot?start=A1B2C3`
4. Open the link in Telegram and press the **START** button.
5. The CLI will automatically detect the completed link, connect your account, and enable Telegram notifications.

*Note for Developers:* To run your own linking backend, you must configure `BLINKIT_AUTO_SERVER_URL` pointing to your local `src/server` instance and set `BLINKIT_AUTO_TELEGRAM_BOT_TOKEN` server-side. Do not document or reveal any real bot tokens or API credentials here.

## Next integration step

Each approved result is only a local eligibility decision recorded in SQLite; it never reserves stock or initiates a purchase. `run-once` evaluates the saved wishlist once. `run` evaluates immediately and then at the configured interval; Ctrl+C clears the scheduler before the process exits. `status` reports local wishlist and decision counts. Any future Blinkit integration should implement `BlinkitCatalog` in `src/integrations/blinkit.ts` through a documented, authorized API or user-approved manual handoff. Purchasing and payment execution are intentionally out of scope for this scaffold.

The local workflow is `wishlist → mock catalog → eligibility → OrderService → mock payment → mock order submission`. The mock payment provider only returns an in-memory authorization reference and never charges money; the mock submission provider only stores a record in memory and never contacts Blinkit.
