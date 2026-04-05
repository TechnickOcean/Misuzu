---
name: requestrepo-oob
description: Run requestrepo.com OOB workflows (create inbox, wait for callback, set HTTP response, add DNS records) via bash and curl.
allowed-tools: Bash(curl:*), Bash(node:*), Bash(python:*)
---

# requestrepo OOB workflow

Use this skill when a challenge needs out-of-band callbacks (SSRF, blind XXE, blind SQLi, DNS exfiltration, webhook verification).

API base: `https://requestrepo.com/api`

## 1) Create a session

Anonymous session:

```bash
curl -sS -X POST "https://requestrepo.com/api/request" -H "Content-Type: application/json"
```

Authenticated session (if token is provided):

```bash
curl -sS -X POST "https://requestrepo.com/api/request" -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>"
```

Response contains `subdomain` and `domain`. Build endpoint URL as:

`https://<subdomain>.<domain>`

## 2) Poll for incoming requests

```bash
curl -sS "https://requestrepo.com/api/get_requests?subdomain=<SUBDOMAIN>"
```

If response array is empty, sleep 2s and poll again until timeout.

## 3) Configure custom HTTP response

```bash
curl -sS -X POST "https://requestrepo.com/api/set_file" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "<SUBDOMAIN>",
    "path": "/index.html",
    "content": "hello from requestrepo",
    "status_code": 200,
    "content_type": "text/html"
  }'
```

## 4) Add DNS record

```bash
curl -sS -X POST "https://requestrepo.com/api/add_dns" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "<SUBDOMAIN>",
    "type": "TXT",
    "value": "proof-token",
    "name": "*"
  }'
```

## Recommended execution pattern

1. Create session and immediately report generated URL.
2. Start polling in bounded loop with clear timeout.
3. On first callback, print method, path, headers, and body.
4. If challenge requires controlled content or DNS, call `set_file` / `add_dns` and re-test.

## Safety notes

- Never log user secrets unless user explicitly asks.
- Keep polling loops bounded and cancellable.
- Prefer `-sS` for clean output but surface HTTP errors clearly.
