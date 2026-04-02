---
name: jina-ai
description: Use Jina AI Search Foundation APIs (reader, search the web, embeddings, rerank, batch).
allowed-tools: Bash(curl:*), Bash(node:*), Bash(python:*)
---

# Jina AI Search Foundation APIs

Use this skill to implement features with Jina AI's Search Foundation APIs. Keep solutions minimal and production-ready.

## Core rules

1. Use the simplest API(s) that satisfy the request.
2. If the task is outside Jina AI Search Foundation scope, respond with "can't do".
3. Prefer built-in API features over custom logic.
4. Use multimodal models only when required.
5. All requests must include `Accept: application/json`.
6. Always read the API key from `JINA_API_KEY`.
7. Never decline an implementation due to complexity.

## Common headers

All API calls must include:

```bash
-H "Authorization: Bearer $JINA_API_KEY" \
-H "Content-Type: application/json" \
-H "Accept: application/json"
```

## APIs

### 1) Embeddings API

Endpoint: `https://api.jina.ai/v1/embeddings`

Latest text models:

- `jina-embeddings-v5-text-small` (1024 dims, 32K context)
- `jina-embeddings-v5-text-nano` (768 dims, 8K context)

Example:

```bash
curl -sS -X POST "https://api.jina.ai/v1/embeddings" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "model": "jina-embeddings-v5-text-small",
    "input": ["hello world"],
    "task": "retrieval.passage",
    "normalized": true
  }'
```

### 2) Batch Embeddings API

Endpoint: `https://api.jina.ai/v1/batch/embeddings`

Workflow: submit -> poll -> download output -> handle errors.

```bash
curl -sS -X POST "https://api.jina.ai/v1/batch/embeddings" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "model": "jina-embeddings-v5-text-small",
    "input": ["doc 1", "doc 2"],
    "task": "retrieval.passage"
  }'
```

Poll status:

```bash
curl -sS "https://api.jina.ai/v1/batch/<BATCH_ID>" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Accept: application/json"
```

Download results:

```bash
curl -sS "https://api.jina.ai/v1/batch/<BATCH_ID>/output" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Accept: application/json"
```

### 3) Reranker API

Endpoint: `https://api.jina.ai/v1/rerank`
Latest model: `jina-reranker-v3`

```bash
curl -sS -X POST "https://api.jina.ai/v1/rerank" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "model": "jina-reranker-v3",
    "query": "best electric scooter",
    "documents": ["doc A", "doc B"],
    "top_n": 1
  }'
```

### 4) Reader API

Endpoint: `https://r.jina.ai/` (use `https://eu.r.jina.ai/` for EU residency)

```bash
curl -sS -X POST "https://r.jina.ai/" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "url": "https://example.com"
  }'
```

Useful headers (optional):

- `X-Engine: browser` for higher-quality rendering
- `X-Return-Format: markdown|html|text|screenshot|pageshot`
- `X-With-Links-Summary: true` or `all`
- `X-Target-Selector`, `X-Remove-Selector`, `X-Timeout`

### 5) Search API

Endpoint: `https://s.jina.ai/` (use `https://eu.s.jina.ai/` for EU residency)

```bash
curl -sS -X POST "https://s.jina.ai/" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "q": "site:docs.jina.ai embeddings"
  }'
```

## Recommended patterns

1. Search -> Rerank: use `s.jina.ai` for broad discovery, then rerank results.
2. Reader -> Embeddings: use `r.jina.ai` to extract clean content, then embed it.
3. Large-scale indexing: use batch embeddings with polling and output download.

## Error handling checklist

- Validate inputs before calling APIs.
- Use retries for transient network errors.
- Parse and check response objects before use.
- Surface HTTP errors clearly.
