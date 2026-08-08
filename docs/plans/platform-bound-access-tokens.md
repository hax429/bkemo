# Platform-bound access tokens

**Status:** implemented (pending migrate deploy + client re-login)  
**Confirmed:** 2026-08-06

## Goal

Long-lived credentials for iOS, macOS, Obsidian, and scripts are **named,
scoped, platform-bound access tokens only**. Interactive web login stays a
short-lived session. MCP OAuth is unchanged.

## Decisions

| Topic | Decision |
|---|---|
| Web login | Session JWT (`tokenType: 'session'`) |
| iOS / macOS login | Mints a managed access token (`ios` / `macos`) into Keychain |
| Obsidian | Access token with platform `obsidian` only; pairing codes / device creds hard-cut |
| Scripts / curl | Platform `api` |
| Legacy `apiToken` | Emptied; no longer issued or accepted |
| Platform values | Enum: `web` \| `macos` \| `ios` \| `obsidian` \| `api` + display name |
| Mismatch | Soft-allow + misuse incident (not hard reject) |
| Detection | Required `X-Bkemo-Platform` on access-token requests (signaling, not crypto) |
| Warnings | Full Revoke/Dismiss on **web + macOS**; minimal redirect on **iOS + Obsidian** |
| Existing access tokens | Migrate platform → `api` |
| Platform change | Immutable; revoke + recreate |
| Cap | 50 tokens / account |

## Schema

- `accessToken.platform` (`VarChar`, default `api`)
- `accessTokenMisuseIncident` (open incident per token + observed platform)
- Migration: set platforms, empty `accounts.apiToken`, delete pairing codes + device credentials

## Server

- Create requires `platform` + `name` + scopes; optional expiry (UI default 90d)
- JWT: `tokenType` + `jti` + `platform`; reject credentials without `tokenType`
- Native login body may include `platform` + `deviceName` → mint full-app access token
- On mismatch: upsert incident, publish SSE `kind: 'security'`
- Obsidian: reject device credentials; access-token path only
- tRPC: list incidents, dismiss, revoke

## Clients

- Web / macOS / iOS / Obsidian send `X-Bkemo-Platform`
- Security UI: platform picker, list fields, misuse banner (web + macOS)
- Obsidian settings: paste token only; status line redirects to Mac/Web on alert
- iOS: quiet notice → open Mac/Web Security

## Deploy notes

1. `bunx prisma migrate deploy --schema=prisma/schema.prisma`
2. Restart the app process.
3. Re-login on web/macOS/iOS (legacy JWTs without `tokenType` are rejected).
4. Obsidian: create a new `platform: obsidian` token and paste it (pairing codes dead).

## Out of scope

- Hard reject / strict mode
- Cryptographic device attestation
- MCP token changes
