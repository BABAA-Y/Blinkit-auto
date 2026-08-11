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

Do not put secrets in configuration. In particular, never provide passwords, OTPs, payment PINs, card PINs, banking credentials, or authentication tokens to this project.

Wishlist commands use only the local SQLite database. `wishlist add` accepts `<id> <product-id> <product-name> <quantity> <max-unit-price> <cooldown-minutes> [enabled|disabled]`; items may then be listed, enabled, disabled, or removed. Prices are decimal currency values with at most two decimal places; quantities and cooldowns are non-negative validated integers (quantity must be greater than zero).

## Next integration step

Each approved result is only a local eligibility decision recorded in SQLite; it never reserves stock or initiates a purchase. `run-once` evaluates the saved wishlist once. `run` evaluates immediately and then at the configured interval; Ctrl+C clears the scheduler before the process exits. `status` reports local wishlist and decision counts. Any future Blinkit integration should implement `BlinkitCatalog` in `src/integrations/blinkit.ts` through a documented, authorized API or user-approved manual handoff. Purchasing and payment execution are intentionally out of scope for this scaffold.

The local workflow is `wishlist → mock catalog → eligibility → OrderService → mock payment → mock order submission`. The mock payment provider only returns an in-memory authorization reference and never charges money; the mock submission provider only stores a record in memory and never contacts Blinkit.
