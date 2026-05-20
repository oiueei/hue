# OIUEEI Hue 💡

A tiny Philips Hue light controller, deployed as a **Netlify static page + serverless function**. It started life as a Django easter egg inside OIUEEI; this is the standalone JavaScript port.

## What it does

A page with three buttons, each calling `/api/hue`:

| Action | Effect |
|---|---|
| **Blink** (`?action=trigger`) | Blinks the light for ~15s (Hue native `lselect`) |
| **Stop** (`?action=stop`) | Turns the light off |
| **List lights** (`?action=lights`) | Lists available lights with state |

There is also an admin endpoint `?action=set-refresh-token&key=<ADMIN_KEY>&token=<NEW>` to inject a fresh refresh token without redeploying.

## How it works

- `netlify/functions/hue.js` talks to the **Hue Cloud API** (`api.meethue.com`) using OAuth2.
- Hue **rotates the refresh token** on every refresh, and serverless functions are stateless, so tokens are persisted in **[Netlify Blobs](https://docs.netlify.com/blobs/overview/)** (the `hue-tokens` store). On first run the function seeds the store from the env vars below.

## Environment variables (Netlify → Site settings → Environment variables)

| Variable | Required | Description |
|---|---|---|
| `HUE_CLIENT_ID` | Yes | OAuth2 app ID from the Hue Developer portal |
| `HUE_CLIENT_SECRET` | Yes | OAuth2 app secret |
| `HUE_USERNAME` | Yes | Hue bridge username (whitelist identifier) |
| `HUE_LIGHT_ID` | No | Light to control (default `3`) |
| `HUE_REFRESH_TOKEN` | Yes (seed) | Initial refresh token; after the first refresh, the rotated token lives in Netlify Blobs |
| `HUE_ACCESS_TOKEN` | No (seed) | Initial access token (optional) |
| `HUE_ACCESS_TOKEN_EXPIRES_AT` | No (seed) | Initial expiry (unix seconds) |
| `ADMIN_KEY` | No | Guards the `set-refresh-token` action |

## Deploy

1. `git init && git add -A && git commit -m "Initial commit"`
2. Create a GitHub repo (e.g. `oiueei/hue`) and push.
3. In Netlify: **Add new site → Import from Git** → pick the repo.
4. Add the environment variables above.
5. Deploy. The page is at the site root; the function at `/api/hue`.

The refresh token expires every ~120 days; renew it via the OAuth2 flow and either update `HUE_REFRESH_TOKEN` or call the `set-refresh-token` action.

## Reference

`reference-django/` contains the original Django implementation (views, model, migrations, URL routes) this port is based on.
