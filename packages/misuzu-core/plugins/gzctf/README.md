# gzctf plugin

This plugin adapts GZ::CTF-style platforms (for example `https://nctf.x1ct34m.com/`) to the Misuzu plugin protocol in `plugins/protocol.ts`.

## Naming

- Platform: `gzctf`
- Contest (example): `NCTF2026`

The plugin name follows platform naming, not contest naming.

## Example config

```json
{
  "baseUrl": "https://nctf.x1ct34m.com",
  "contest": {
    "mode": "id",
    "value": 2
  },
  "auth": {
    "mode": "manual"
  }
}
```

## Supported auth modes

- `manual`: launches headed Chrome via `plugins/utils/open-headed-auth.ts`, waits for login, and captures cookie auth
- `credentials`: currently not implemented for this adapter

When `manual` is used, you may optionally pass:

- `auth.loginUrl`
- `auth.authCheckUrl`
- `auth.timeoutSec`

## Implemented behavior

- Auth probe: `GET /api/account/profile`
- Contest list: `GET /api/game`
- Contest details/challenge list: `GET /api/game/{gameId}/details`
- Single challenge details: `GET /api/game/{gameId}/challenges/{challengeId}`
- Flag submit: `POST /api/game/{gameId}/challenges/{challengeId}` with `{ "flag": "..." }`
- Submission status: `GET /api/game/{gameId}/challenges/{challengeId}/status/{submissionId}`
- Notice polling: `GET /api/game/{gameId}/notices`
- Dynamic container toggle: `POST /api/game/{gameId}/container/{challengeId}`

## Auth expiry handling

- On `401/403`, adapter throws `PlatformAuthError`.
- Runtime catches that error, clears session, and retries by re-running plugin `login()`.
