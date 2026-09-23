# Core's public keys (optional)

Mounted read-only into the backend at `/run/cobalt`. Only used when `.env` sets
`COBALT_CORE_JWKS_FILE=/run/cobalt/core-jwks.json` instead of
`COBALT_CORE_JWKS_URL`. Save Core's JWKS here as `core-jwks.json`:

```bash
curl -sk https://127.0.0.1:3008/auth/.well-known/jwks.json -o cobalt/core-jwks.json
```

It holds public keys only, but it is deployment-specific, so it is not committed.
