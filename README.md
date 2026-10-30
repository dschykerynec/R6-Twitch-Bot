# R6 Twitch Bot

A lightweight Twitch chatbot that reports a streamer's live **Rainbow Six Siege** ranked stats on demand. When someone types `!rank` in chat, the bot looks up the player's current rank and Rank Points (RP) and replies in chat:

```
viewer:  !rank
bot:     <streamer> is currently Diamond 2 with 4,312 RP
```

It ran 24/7 on [Railway](https://railway.app) in a live Twitch channel.

> **⚠️ Status: rank lookups are currently broken.** In August 2026, R6Data rebranded to [Arenyze](https://r6.arenyze.com) and removed its v1 API. The `/api/stats?type=...` endpoints this bot calls now return `410 Gone`, and old R6Data API keys no longer work. Migrating to the Arenyze v2 API is planned; see [Roadmap](#roadmap).

## Features

- **`!rank` command:** fetches the player's current ranked tier (Copper 5 → Champion) and RP from the R6Data API (now [Arenyze](https://r6.arenyze.com))
- **Twitch EventSub over WebSocket:** uses Twitch's current chat API (`channel.chat.message` + Helix `chat/messages`) instead of the legacy IRC interface
- **Automatic OAuth token refresh:** refreshes the access token every 3 hours, and immediately on any `401`, so the bot keeps running without manual re-auth
- **Resilient connection:** handles Twitch `session_reconnect` messages and reconnects automatically if the socket drops
- **Per-command cooldown:** 15-second cooldown to prevent chat spam and limit API usage
- **Graceful failure:** posts a friendly message in chat if the rank lookup fails, and logs the error
- **Zero-framework, single dependency:** plain Node.js with native `fetch`; `ws` is the only package

## How it works

```
Twitch chat ──► EventSub WebSocket ──► bot.js ──► rank.js ──► R6Data API
                                          │
                                          └──► Helix POST /chat/messages ──► Twitch chat
```

1. On startup, `bot.js` opens a WebSocket to `wss://eventsub.wss.twitch.tv/ws`.
2. On `session_welcome`, it subscribes to `channel.chat.message` events for the target channel using the session ID.
3. When a chat message equal to `!rank` arrives (and isn't on cooldown), it calls `fetchRank()` in `rank.js`.
4. `fetchRank()` queries R6Data for the player's PC ranked profile and maps the numeric rank ID to a readable tier name.
5. The bot posts the result back to chat through the Helix Send Chat Message endpoint.

## Project structure

```
src/
├── bot.js    # Twitch auth, EventSub WebSocket, command handling, cooldowns
└── rank.js   # R6Data API client, rank-name mapping, leaderboard search
```

`rank.js` also includes `findLeaderboardPosition()`, an experimental search for a player's global leaderboard position. It jumps through leaderboard pages to find the RP range, then scans neighboring pages to handle RP ties at page boundaries. It isn't wired to a chat command yet.

## Setup

### Prerequisites

- **Node.js 20.12+** (uses built-in `process.loadEnvFile` and `fetch`)
- A **Twitch application** from the [Twitch Developer Console](https://dev.twitch.tv/console) (client ID and secret)
- A **Twitch account for the bot** and a user access token + refresh token for it, with the `user:read:chat` and `user:write:chat` scopes
- An **API key** from [r6.arenyze.com](https://r6.arenyze.com) (formerly R6Data). Free keys reportedly expire after about a month, so expect to regenerate it periodically

### Environment variables

Create a `.env` file in the project root (it's gitignored):

```env
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_OAUTH_TOKEN=bot_user_access_token
TWITCH_REFRESH_TOKEN=bot_user_refresh_token
TWITCH_BOT_USER_ID=numeric_user_id_of_bot_account
TWITCH_CHANNEL_USER_ID=numeric_user_id_of_channel
R6DATA_API_KEY=your_r6data_api_key
```

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Credentials for your Twitch app |
| `TWITCH_OAUTH_TOKEN` | Initial user access token for the bot account |
| `TWITCH_REFRESH_TOKEN` | Refresh token used to get new access tokens |
| `TWITCH_BOT_USER_ID` | Twitch user ID of the bot account |
| `TWITCH_CHANNEL_USER_ID` | Twitch user ID of the channel the bot joins |
| `R6DATA_API_KEY` | API key for R6Data |

### Run locally

```bash
npm install
npm start
```

You should see:

```
WebSocket connected
Subscribed to chat — bot is running
```

## Deploying to Railway

1. Create a new Railway project from this GitHub repo.
2. Add the environment variables above under the service's **Variables** tab. No `.env` file is needed; the bot falls back to Railway's environment automatically.
3. Railway detects Node and runs `npm start`. The bot needs no exposed port, since it only makes outbound connections.

## Customizing

- **Tracked player:** change the default `username` in `fetchRank()` in `src/rank.js`, and the chat message text in `src/bot.js`.
- **Cooldowns:** edit the `COOLDOWNS` map in `src/bot.js`.
- **New commands:** add a branch in the `notification` handler in `src/bot.js`.

## Known limitations

- The refresh token rotates in memory only. If the process restarts after a refresh, it boots with the original token from the environment, which works as long as that refresh token is still valid.
- Rank lookup is PC-only.
- The R6Data v1 API the bot calls has been shut down (see Status above).
- API keys from the stats provider expire and can't be renewed programmatically, so the key has to be regenerated by hand in the provider's dashboard and updated in Railway.

## Roadmap

- [ ] Migrate `rank.js` to the Arenyze v2 API (`https://public-api.arenyze.com/r6/api/v2/profile`) and update response parsing
- [ ] Detect `401` / `410` responses from the stats provider and send an alert (e.g. a Discord webhook) instead of failing quietly in chat
- [ ] Add a scheduled health check against the provider's usage endpoint to catch an expiring key early
- [ ] Persist the rotated Twitch refresh token so restarts don't fall back to a stale token
- [ ] Wire `findLeaderboardPosition()` up to a `!leaderboard` command

## Tech stack

Node.js (ES modules) · `ws` · Twitch EventSub & Helix APIs · R6Data / Arenyze API · Railway
