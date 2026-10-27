# RewardBrick Admin Panel

The admin panel is served by the backend at `/admin` and does not require a separate hosting service.

## Configure and deploy

1. Set `ADMIN_PANEL_PASSWORD` in the backend's local environment and deployment provider. Use a unique password with at least 20 random characters; do not commit it or put it in Flutter.
2. Keep `DATABASE_URL` configured for the PostgreSQL database.
3. Set the provider postback secrets (`ADMANTUM_POSTBACK_SECRET`, `CPX_RESEARCH_POSTBACK_SECRET`) to the exact secrets configured with those providers. The admin panel can also update these without displaying saved secret values.
4. Deploy/restart the backend so the database adds the admin tables, app posters, affiliate posts, redemption catalog, and required columns.
5. Open `https://<your-backend-host>/admin` over HTTPS and sign in with `ADMIN_PANEL_PASSWORD`.

For local development, copy `.env.example` to `.env`, replace every placeholder with development-only values, then run `npm run dev`. Never commit `.env`.

## Available controls

- Overview: account, outstanding coin, payout, task and ledger totals.
- Users: search, suspend/reactivate accounts and make reasoned coin adjustments. Adjustments write both a wallet transaction and an admin audit record. Suspended accounts are blocked by user APIs and offer listing.
- Tasks & rewards: create/edit/pause admin-managed HTTPS offers, and activate/pause legacy database tasks or edit their display rewards. Displayed rewards do not by themselves credit coins; a provider postback must verify completion. Provider-level fixed rewards are controlled separately.
- Posters: add/edit/reorder/pause/delete home/offers posters, including a publicly reachable HTTPS image URL and optional tap destination. The panel stores the image URL; host the image elsewhere and paste its direct URL. Only active posters appear in the app, and the panel allows one active poster at a time.
- Affiliate posts: manage the real title, caption, image and HTTPS tracked link shown on the Affiliate tab. No seeded/demo posts are displayed.
- Redeem cards: configure voucher provider, denomination, minimum wallet coins and display order. Conversion is 10 coins = ₹1; standard cards require at least 1,000 coins, while Free Fire/PUBG cards require at least 250 coins.
- Redemption requests: requests are listed with the user's name and card. Enter the voucher code/reference after sending it to complete the request; the user can then see the reference in wallet history. Failing a request refunds the reserved coins.
- App information: publish the actual Terms, About Us, support email and store listing URL used by the profile actions. Empty sections are not replaced with sample copy.
- Providers: set offer URLs, per-completion coin rewards and callback secrets. A blank reward keeps the existing provider-specific fallback; the default AdMantum reward is 400 coins (₹40).
- Audit log: inspect recent admin changes.

The login uses an HttpOnly, SameSite=Strict session cookie, expires after 30 minutes of inactivity, and temporarily blocks an IP after repeated failed passwords. Sessions are in memory, so deploying/restarting the backend signs admins out. Configure a single backend instance unless session storage is moved to a shared store.

## Production requirements still needed

- Configure HTTPS, database backups, provider postback URLs/secrets, and the production AdMob IDs.
- Validate the payout/reward terms with each provider before enabling offers; conversion policy is 10 coins = ₹1.
- The Flutter ad gate protects the normal UI flow. Server-verified AdMob rewarded-ad callbacks are not yet connected to the daily-bonus endpoint, so that reward must not be treated as fraud-proof until server-side verification is implemented.
- Current admin access is a single shared owner password, not multi-user admin accounts or role-based approvals.
