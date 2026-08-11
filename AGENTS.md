# Blinkit-Auto Development Rules

## Scope and safety

- Keep all project code, tests, documentation, and local data within this repository.
- This project must not store, log, request, or process passwords, OTPs, UPI PINs, card PINs, CVVs, banking credentials, session secrets, or authentication tokens.
- Do not implement or attempt to bypass authentication, CAPTCHAs, rate limits, access restrictions, or other security controls.
- Do not add purchasing, checkout, payment execution, or account-login behavior without explicit review and a compliant, documented integration path.
- Use mock/local adapters by default. Real external integrations require explicit approval, documented terms compliance, and tests that avoid real transactions.

## Architecture

- Keep business decisions in `ai/`, deterministic policy enforcement in `automation/`, external adapters in `integrations/`, and payment interfaces in `payments/`.
- Depend inward: adapters may call domain models; domain and rules code must not depend on vendor SDKs or transport details.
- Treat payment providers as abstractions. The included local implementation must always reject execution.
- Prefer Node.js built-ins unless an npm dependency has a clear, documented need.

## Quality

- Read configuration only from environment variables through `src/config.ts`; never commit secrets or `.env` files.
- Use structured, non-sensitive logging. Redact or avoid user-provided data when it could be sensitive.
- Add or update tests for behavior changes. Tests must remain offline and deterministic.
- Use type hints, small focused modules, and descriptive docstrings for public interfaces.
