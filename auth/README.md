# Syndicate Hub authentication backend

A Cloudflare Worker with a D1 database. Keys are generated server-side and stored only as SHA-256 hashes with a private pepper. The `/verify` endpoint checks a key and a claimed Roblox UserId. **A Roblox executor can spoof UserId; this is not proof of Roblox identity or copy protection.**

## Deploy

1. Install Node.js and run `npx wrangler login`.
2. In this directory run `npx wrangler d1 create syndicate-keys`; copy the returned database ID into `wrangler.toml`.
3. Run `npx wrangler d1 execute syndicate-keys --remote --file=schema.sql`.
4. Generate **two different random secrets**, then run `npx wrangler secret put ADMIN_TOKEN` and `npx wrangler secret put KEY_PEPPER`. Do not commit these values.
5. Run `npx wrangler deploy`. Note the deployed `https://...workers.dev` URL.

## Admin operations

Use an HTTP client or curl, replacing URL, token, and UserId:

Issue: `POST /admin/issue`, header `Authorization: Bearer <ADMIN_TOKEN>`, JSON `{"userId":"12345678","expiresAt":"2027-01-01T00:00:00Z"}`. Omit expiresAt for a non-expiring key. **Copy the generated key immediately: it is only returned once.**

Revoke: `POST /admin/revoke` with same authorization and JSON `{"key":"SYND-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"}`.

List: `GET /admin/keys` with same authorization. Only prefixes are listed, never full keys.

Verify: `POST /verify` JSON `{"userId":"12345678","key":"SYND-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"}`. Response `{"valid":true/false}`.

## Security notes

The verification endpoint is public and does not currently implement rate limiting. Configure Cloudflare WAF/rate limiting before wide distribution. Never embed `ADMIN_TOKEN` or `KEY_PEPPER` in Lua. Key verification on an untrusted client is bypassable, even with this backend. Private GitHub files cannot be fetched by a normal public raw loadstring. No changes to the existing Lua hub are included yet: wire in the endpoint only after deployment, to avoid disabling the currently stored build.
