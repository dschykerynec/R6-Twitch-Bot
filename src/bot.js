import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch (err) {
  // .env file doesn't exist (e.g., in Railway)
}

import WebSocket from 'ws';
import { fetchRank, findLeaderboardPosition } from './rank.js';

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

  if (!res.ok) console.error('Failed to send message:', res.status, await res.text());
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

const COOLDOWNS = {
  '!rank': 15,
};

const lastUsed = new Map();

function isOnCooldown(command) {
  const cooldownSecs = COOLDOWNS[command] ?? 15;
  const lastTime = lastUsed.get(command) ?? 0;
  const elapsed = (Date.now() - lastTime) / 1000;
  if (elapsed < cooldownSecs) return true;
  lastUsed.set(command, Date.now());
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

      if (text === '!rank') {
        if (isOnCooldown(text)) return;
        try {
          const { rank, rp, rawRank, rawRP } = await fetchRank();
          if (rawRank === 36) {
            const { position } = await findLeaderboardPosition('speztl', rawRP);
            const posStr = position ? `#${position} ` : '';
            await sendChatMessage(`speztl is currently ${posStr}Champ with ${rp} RP`);
          } else {
            await sendChatMessage(`speztl is currently ${rank} with ${rp} RP`);
          }
        } catch (err) {
          await sendChatMessage('Could not fetch rank right now. Kid_Howdy is a terrible coder.');
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
