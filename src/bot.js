import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch (err) {
  // .env file doesn't exist (e.g., in Railway)
}

import WebSocket from 'ws';
import { fetchRank, fetchLegendRank, getDefaultPlayer } from './rank.js';

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_BOT_USER_ID, TWITCH_CHANNEL_USER_ID } = process.env;

let accessToken = process.env.TWITCH_OAUTH_TOKEN;
let refreshToken = process.env.TWITCH_REFRESH_TOKEN;

async function refreshAccessToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET
    })
  });

  if (!res.ok) {
    console.error('Token refresh failed:', res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  console.log('Access token refreshed');
}

async function sendChatMessage(text) {
  const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      broadcaster_id: TWITCH_CHANNEL_USER_ID,
      sender_id: TWITCH_BOT_USER_ID,
      message: text
    })
  });

  if (res.status === 401) {
    await refreshAccessToken();
    return sendChatMessage(text);
  }

  if (!res.ok) {
    console.error('Failed to send message:', res.status, await res.text());
    return;
  }

  // Twitch can return 200 while still silently dropping the message (e.g. AutoMod,
  // duplicate-message suppression) — the real outcome is in the response body.
  const body = await res.json();
  const result = body?.data?.[0];
  if (result && result.is_sent === false) {
    console.error('Message not sent (dropped by Twitch):', JSON.stringify(result.drop_reason));
  }
}

async function subscribeToChat(sessionId) {
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: TWITCH_CHANNEL_USER_ID,
        user_id: TWITCH_BOT_USER_ID
      },
      transport: {
        method: 'websocket',
        session_id: sessionId
      }
    })
  });

  if (res.status === 401) {
    await refreshAccessToken();
    return subscribeToChat(sessionId);
  }

  if (!res.ok) {
    console.error('EventSub subscription failed:', res.status, await res.text());
    process.exit(1);
  }
}

const DEFAULT_COOLDOWN_SECS = 30; // matches Twitch's own duplicate-message suppression window

const COOLDOWNS = {
  rank: DEFAULT_COOLDOWN_SECS,
  rankPlayer: DEFAULT_COOLDOWN_SECS,
  legend: DEFAULT_COOLDOWN_SECS,
  legendPlayer: DEFAULT_COOLDOWN_SECS,
};
console.log('Cooldowns (seconds):', COOLDOWNS);

const lastUsed = new Map();

function isOnCooldown(key) {
  const cooldownSecs = COOLDOWNS[key] ?? DEFAULT_COOLDOWN_SECS;
  const lastTime = lastUsed.get(key) ?? 0;
  const elapsed = (Date.now() - lastTime) / 1000;
  const blocked = elapsed < cooldownSecs;
  console.log(`[cooldown] ${key}: elapsed=${elapsed.toFixed(2)}s limit=${cooldownSecs}s -> ${blocked ? 'BLOCKED' : 'ALLOWED'}`);
  if (blocked) return true;
  lastUsed.set(key, Date.now());
  return false;
}

function connect() {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => console.log('WebSocket connected'));

  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    const type = msg.metadata?.message_type;

    if (type === 'session_welcome') {
      await subscribeToChat(msg.payload.session.id);
      console.log('Subscribed to chat — bot is running');
    }

    if (type === 'session_reconnect') {
      ws.close();
      connect();
    }

    if (type === 'notification' && msg.metadata?.subscription_type === 'channel.chat.message') {
      const text = msg.payload.event.message.text.trim();
      const rankMatch = text.match(/^!rank(?:\s+(\S+))?$/);

      if (rankMatch) {
        const playerArg = rankMatch[1];
        const cooldownKey = playerArg ? 'rankPlayer' : 'rank';
        if (isOnCooldown(cooldownKey)) return;

        try {
          const { rank, rp } = await fetchRank(playerArg);
          const who = playerArg ?? getDefaultPlayer();
          await sendChatMessage(`${who} is ${rank} with ${rp} RP`);
        } catch (err) {
          // A typo'd/nonexistent username usually surfaces as a 404 from the API;
          // an account that exists but has no ranked stats throws this specific message.
          const notFound = playerArg && (
            err.message.includes('404') ||
            err.message === 'No ranked profile found for this player'
          );

          if (notFound) {
            await sendChatMessage(`Couldn't find ranked stats for "${playerArg}" — check the spelling.`);
          } else {
            await sendChatMessage('Could not fetch rank right now. Kid_Howdy is a terrible coder.');
          }
          console.error(err.message);
        }
      }

      const legendMatch = text.match(/^!legend(?:\s+(\S+))?$/);

      if (legendMatch) {
        const playerArg = legendMatch[1];
        const who = playerArg ?? getDefaultPlayer();
        const cooldownKey = playerArg ? 'legendPlayer' : 'legend';
        if (isOnCooldown(cooldownKey)) return;

        try {
          const { mmr, maxMmr } = await fetchLegendRank(playerArg);
          await sendChatMessage(`${who} is in Legend Division with ${mmr} MMR (peak ${maxMmr})`);
        } catch (err) {
          const notFound = err.message.includes('404') ||
            err.message === 'No Legend Division data found for this player';

          if (notFound) {
            await sendChatMessage(playerArg
              ? `Couldn't find Legend Division stats for "${playerArg}" — check the spelling, or they may not be ranked in Legend Division.`
              : `${who} isn't ranked in Legend Division right now.`);
          } else {
            await sendChatMessage('Could not fetch Legend Division rank right now. Kid_Howdy is a terrible coder.');
          }
          console.error(err.message);
        }
      }
    }
  });

  ws.on('error', (err) => console.error('WebSocket error:', err.message));
  ws.on('close', () => {
    console.log('WebSocket closed — reconnecting in 5s');
    setTimeout(connect, 5000);
  });
}

// Proactively refresh the token every 3 hours (tokens last ~4 hours)
setInterval(refreshAccessToken, 3 * 60 * 60 * 1000);

connect();
