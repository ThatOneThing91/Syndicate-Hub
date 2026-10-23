# Syndicate Hub member keys

Worker: https://syndicate-auth.loganmatthewsmall.workers.dev

The root StorageHunters script now presents a member-key window before starting the hub. It posts the key and the player's claimed Roblox UserId to `/verify`. Only HTTP 200 with JSON `{"valid":true}` opens the hub. Server errors, timeouts, invalid responses, expired keys, and revoked keys do not grant access. Closing the window cancels that launch. Re-executing replaces an older pending key window.

Keys are checked online at every launch. After a successful verification, the client remembers the member key separately for each Roblox User ID. Re-executing automatically verifies the saved key and opens the hub without showing the key window when it remains active. Executors with readfile/writefile also retain it across sessions in a local `SyndicateHub_Key_<UserId>.json` file; other executors retain it in session memory.

An explicit invalid response (including expiration or revocation) clears the saved key and asks for a new one. Network errors, timeouts, malformed responses, and rate limits never grant offline access or erase the saved key; the window appears with the existing key available to retry. Revocation blocks subsequent launches; it does not terminate an already-running hub.

## Member launch

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters"))()
```

Enter the individual member key. The window displays the numeric Roblox User ID needed when issuing it. The executor must support an HTTP request function.

## Administration

The Worker uses the `syndicate-keys` D1 database through the `DB` binding. `ADMIN_TOKEN` and `KEY_PEPPER` are configured as Cloudflare secrets. Never put either secret in Lua, this repository, a member loadstring, or a public message. The private administrator credential handout is separate from this repository.

Using an HTTP client:

- Issue: `POST /admin/issue`, header `Authorization: Bearer <ADMIN_TOKEN>`, JSON `{"userId":"12345678"}`. Optionally include `"expiresAt":"2027-01-01T00:00:00Z"`. The full generated key is returned only once; copy it immediately.
- List: `GET /admin/keys` with the same authorization. Returns key prefixes, User IDs, expiry, creation time, and revoked status. It never returns full keys.
- Revoke: `POST /admin/revoke` with the same authorization and JSON `{"key":"SYND-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"}`.
- Verify: `POST /verify`, JSON `{"userId":"12345678","key":"SYND-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"}`.
- Health: `GET /health` returns `{"ok":true}` when required bindings and secrets are present.

The private handout includes PowerShell examples. The admin token can be replaced in Cloudflare without changing member keys. Do not replace KEY_PEPPER casually: existing key hashes depend on it.

## Deployment

`wrangler.toml` references the deployed database. For source deployments use `npx wrangler login` and `npx wrangler deploy` from this directory. Retain the existing secrets and database. `schema.sql` creates the member_keys table and index for a new deployment.

## Limits

This is server-verified licensing for normal client use, not tamper-proof copy protection. Executors control their client code and can spoof the supplied UserId or bypass local checks. The obfuscated script is still distributed publicly. The verification endpoint currently has no application rate limiter; configure appropriate rate limits before wide distribution.
