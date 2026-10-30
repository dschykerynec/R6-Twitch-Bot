# R6 Twitch Bot

A lightweight Twitch chatbot that reports live **Rainbow Six Siege** ranked stats on demand. Viewers can check the streamer's current rank and Rank Points (RP), their Legend Division MMR, or look up any other PC player. The streamer's username is set with one environment variable, so the bot can be reused in any channel:

```
viewer:  !rank
bot:     <streamer> is Diamond 2 with 4,312 RP

viewer:  !rank SomePlayer
bot:     SomePlayer is Emerald 1 with 3,870 RP

viewer:  !legend
bot:     <streamer> is in Legend Division with 5,120 MMR (peak 5,340)
```

It runs 24/7 on [Railway](https://railway.app) in my brother's Twitch channel. He's top 0.4% of global players.

## Commands

| Command | What it does | Cooldown |
| --- | --- | --- |
| `!rank` | Current ranked tier (Copper 5 → Champion 1) and RP for the `DEFAULT_PLAYER` | 30s |
| `!rank <player>` | Same lookup for any PC (Ubisoft Connect) player | 30s |
| `!legend` | Current Legend Division MMR and season peak for the `DEFAULT_PLAYER` | 30s |
| `!legend <player>` | Same lookup for any PC player | 30s |

Cooldowns are set to 30s because Twitch doesn't let bots send identical messages within 30 seconds. R6 games are long anyways.
Without a name, `!rank` and `!legend` look up the player set in `DEFAULT_PLAYER`, which should be the R6 username of the streamer whose chat the bot is in. With a name, they look up that player instead.

## Features

- **Rank and Legend Division lookups** from the [Arenyze R6 API](https://r6.arenyze.com) (formerly R6Data), including lookups for any player by username
- **Twitch EventSub over WebSocket:** uses Twitch's current chat API (`channel.chat.message` + Helix `chat/messages`) instead of the legacy IRC interface
- **Automatic OAuth token refresh:** refreshes the access token every 3 hours, and immediately on any `401`, so the bot keeps running without manual re-auth
- **Resilient connection:** handles Twitch `session_reconnect` messages and reconnects automatically if the socket drops
- **Configurable default player:** bare commands look up whoever is set in `DEFAULT_PLAYER`, so no streamer names are hard-coded
- **Separate cooldowns** for default-player lookups and named-player lookups. They default to 30 seconds, which matches Twitch's own duplicate-message window
- **Dropped-message detection:** Twitch can return `200 OK` and still drop a message (AutoMod, duplicate suppression), so the bot checks `is_sent` in the response and logs the drop reason
- **Helpful errors:** tells chat when a username is probably misspelled or a player has no ranked or Legend Division stats, and falls back to a generic message for anything else
- **Zero-framework, single dependency:** plain Node.js with native `fetch`; `ws` is the only package

## How it works

```
Twitch chat ──► EventSub WebSocket ──► bot.js ──► rank.js ──► Arenyze R6 API (v2)
                                          │
                                          └──► Helix POST /chat/messages ──► Twitch chat
```

1. On startup, `bot.js` opens a WebSocket to `wss://eventsub.wss.twitch.tv/ws`.
2. On `session_welcome`, it subscribes to `channel.chat.message` events for the target channel using the session ID.
3. Incoming messages are matched against `!rank [player]` and `!legend [player]`. If no player is given, the bot uses `DEFAULT_PLAYER`. If the command isn't on cooldown, the bot calls `rank.js`.
4. `rank.js` calls the Arenyze `GET /r6/api/v2/profile` endpoint for the player:
   - `fetchRank()` reads the `ranked` board and maps the numeric rank index to a tier name.
   - `fetchLegendRank()` reads the current season's `legends-division` segment, because Legend Division is a separate ladder with its own MMR, not a tier above Champion.
5. The bot posts the result back to chat through the Helix Send Chat Message endpoint.

## Project structure

```
src/
├── bot.js    # Twitch auth, EventSub WebSocket, command parsing, cooldowns, error messages
└── rank.js   # Arenyze API client, rank-name mapping, Legend Division lookup
```

`rank.js` also still contains `findLeaderboardPosition()`, a search for a player's global leaderboard position that handles RP ties at page boundaries. It's no longer exposed as a command, because the provider's leaderboard doesn't update often enough to be useful in chat.

## Setup

### Prerequisites

- **Node.js 20.12+** (uses built-in `process.loadEnvFile` and `fetch`)
- A **Twitch application** from the [Twitch Developer Console](https://dev.twitch.tv/console) (client ID and secret)
- A **Twitch account for the bot** and a user access token + refresh token for it, with the `user:read:chat` and `user:write:chat` scopes
- An **API key** from [r6.arenyze.com](https://r6.arenyze.com). Free keys expire after about a month, so expect to regenerate it periodically

### Environment variables

Copy the example file and fill in your values (`.env` is gitignored):

```bash
cp .env.example .env
```

```env
R6DATA_API_KEY=your_arenyze_api_key
DEFAULT_PLAYER=streamer_r6_username
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_OAUTH_TOKEN=bot_user_access_token
TWITCH_REFRESH_TOKEN=bot_user_refresh_token
TWITCH_BOT_USER_ID=numeric_user_id_of_bot_account
TWITCH_CHANNEL_USER_ID=numeric_user_id_of_channel
```

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Credentials for your Twitch app |
| `TWITCH_OAUTH_TOKEN` | Initial user access token for the bot account |
| `TWITCH_REFRESH_TOKEN` | Refresh token used to get new access tokens |
| `TWITCH_BOT_USER_ID` | Twitch user ID of the bot account |
| `TWITCH_CHANNEL_USER_ID` | Twitch user ID of the channel the bot joins |
| `R6DATA_API_KEY` | Arenyze API key (the variable keeps its original R6Data name) |
| `DEFAULT_PLAYER` | **Required.** The R6 (Ubisoft Connect) username used when `!rank` or `!legend` is sent without a name. Set it to the streamer whose channel the bot is in |

### Setting the default player

`DEFAULT_PLAYER` is how the bot knows whose stats to show by default. Set it to the streamer's **Rainbow Six Siege username on Ubisoft Connect**, not their Twitch name (they're often different):

```env
DEFAULT_PLAYER=StreamerR6Name
```

Then in chat:

- `!rank` → the streamer's rank and RP
- `!legend` → the streamer's Legend Division MMR
- `!rank OtherPlayer` / `!legend OtherPlayer` → that player's stats, whatever `DEFAULT_PLAYER` is set to

There's no fallback in the code. If `DEFAULT_PLAYER` is missing, bare `!rank` and `!legend` won't work, though lookups with a name still do. To run the bot for a different streamer, change this one variable and restart.

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
2. Add the environment variables above, including `DEFAULT_PLAYER`, under the service's **Variables** tab. No `.env` file is needed; the bot falls back to Railway's environment automatically.
3. Railway detects Node and runs `npm start`. The bot needs no exposed port, since it only makes outbound connections.

## Customizing

- **Default player:** set `DEFAULT_PLAYER` in `.env` or in Railway's variables. No code changes needed.
- **Cooldowns:** edit `DEFAULT_COOLDOWN_SECS` or the `COOLDOWNS` map in `src/bot.js` (`rank`, `rankPlayer`, `legend`, `legendPlayer`). Going below 30 seconds may get repeated replies dropped by Twitch's duplicate-message filter.
- **New commands:** add a pattern match in the `notification` handler in `src/bot.js`.

## API migration (August 2026)

The bot originally used the R6Data v1 API (`api.r6data.eu/api/stats?type=...`). In August 2026, R6Data rebranded to Arenyze and removed v1, so those endpoints began returning `410 Gone` and old keys stopped working. The bot now uses the v2 API at `https://public-api.arenyze.com/r6/api/v2`. The response shape changed (ranked boards moved under `stats`, and Legend Division data lives in `seasons.data.segments`), and that new season data is what made the `!legend` command possible.

## Known limitations

- API keys from the stats provider expire about monthly and can't be renewed programmatically, so the key has to be regenerated by hand and updated in Railway.
- The rotated Twitch refresh token is kept in memory only. If the process restarts after a refresh, it boots with the original token from the environment.
- Cooldowns are channel-wide, not per viewer.
- Lookups are PC-only.

## Roadmap

- [ ] Detect `401` / `410` responses from the stats provider and send an alert (e.g. a Discord webhook) instead of failing quietly in chat
- [ ] Add a scheduled health check against the provider's usage endpoint to catch an expiring key early
- [ ] Persist the rotated Twitch refresh token so restarts don't fall back to a stale token

## Tech stack

Node.js (ES modules) · `ws` · Twitch EventSub & Helix APIs · Arenyze R6 API · Railway
