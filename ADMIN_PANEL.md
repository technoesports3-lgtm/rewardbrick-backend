# RewardBrick Admin Panel

The admin panel is served by the backend at `/admin` and does not require a separate hosting service.

## Configure and deploy

1. Set `ADMIN_PANEL_PASSWORD` in the backend's local environment and deployment provider. Use a unique password with at least 20 random characters; do not commit it or put it in Flutter.
2. Keep `DATABASE_URL` configured for the PostgreSQL database.
3. Set the provider postback secrets (`ADMANTUM_POSTBACK_SECRET`, `CPX_RESEARCH_POSTBACK_SECRET`) to the exact secrets configured with those providers. The admin panel can also update these without displaying saved secret values.
4. Deploy/restart the backend so the database adds the admin tables, dashboard cards, and `users.is_active` / `provider_configs.reward_coins` columns.
5. Open `https://<your-backend-host>/admin` over HTTPS and sign in with `ADMIN_PANEL_PASSWORD`.

For local development, copy `.env.example` to `.env`, replace every placeholder with development-only values, then run `npm run dev`. Never commit `.env`.

## Available controls

- Overview: account, outstanding coin, payout, task and ledger totals.
- Users: search, suspend/reactivate accounts and make reasoned coin adjustments. Adjustments write both a wallet transaction and an admin audit record. Suspended accounts are blocked by user APIs and offer listing.
- Tasks & rewards: create/edit/pause admin-managed HTTPS offers, and activate/pause legacy database tasks or edit their display rewards. Displayed rewards do not by themselves credit coins; a provider postback must verify completion. Provider-level fixed rewards are controlled separately.
- Dashboard cards: add, edit, reorder, pause, or delete home carousel cards. The Flutter app reads active cards from `/api/v1/dashboard/banners`; the existing built-in carousel remains visible while the request is loading or the backend is unavailable.
- Withdrawals: mark a pending request paid only after sending it, or mark it failed to refund the user's coins.
- Providers: set offer URLs, per-completion coin rewards and callback secrets. A blank reward keeps the existing provider-specific fallback; AdMantum defaults to 4,000 coins.
- Audit log: inspect recent admin changes.

The login uses an HttpOnly, SameSite=Strict session cookie, expires after 30 minutes of inactivity, and temporarily blocks an IP after repeated failed passwords. Sessions are in memory, so deploying/restarting the backend signs admins out. Configure a single backend instance unless session storage is moved to a shared store.

## Production requirements still needed

- Configure HTTPS, database backups, provider postback URLs/secrets, and the production AdMob IDs.
- Validate the payout/reward terms with each provider before enabling offers; conversion policy is 100 coins = ₹1.
- The Flutter ad gate protects the normal UI flow. Server-verified AdMob rewarded-ad callbacks are not yet connected to the daily-bonus endpoint, so that reward must not be treated as fraud-proof until server-side verification is implemented.
- Current admin access is a single shared owner password, not multi-user admin accounts or role-based approvals.
