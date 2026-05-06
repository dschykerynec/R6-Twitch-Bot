const RANK_NAMES = [
  'Unranked',
  'Copper 5', 'Copper 4', 'Copper 3', 'Copper 2', 'Copper 1',
  'Bronze 5', 'Bronze 4', 'Bronze 3', 'Bronze 2', 'Bronze 1',
  'Silver 5', 'Silver 4', 'Silver 3', 'Silver 2', 'Silver 1',
  'Gold 5',   'Gold 4',   'Gold 3',   'Gold 2',   'Gold 1',
  'Platinum 5', 'Platinum 4', 'Platinum 3', 'Platinum 2', 'Platinum 1',
  'Emerald 5',  'Emerald 4',  'Emerald 3',  'Emerald 2',  'Emerald 1',
  'Diamond 5',  'Diamond 4',  'Diamond 3',  'Diamond 2',  'Diamond 1',
  'Champion'
];

export async function fetchLeaderboard(page = 1) {
  const response = await fetch(
    `https://api.r6data.eu/api/stats?type=leaderboards&page=${page}&platform=pc`,
    {
      headers: { 'api-key': process.env.R6DATA_API_KEY }
    }
  );

  if (!response.ok) {
    throw new Error(`R6Data API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function searchPage(username, targetRP, entries, page, apiCalls) {
  const entry = entries.find(p => p.id === username);
  if (entry) return { position: entry.position, page, apiCalls };

  // Expand forward while the next page still has entries at or above targetRP (ties)
  let nextPage = page + 1;
  while (true) {
    const next = await fetchLeaderboard(nextPage);
    apiCalls++;
    if (!next.length || next[0].rankPoints < targetRP) break;
    const found = next.find(p => p.id === username);
    if (found) return { position: found.position, page: nextPage, apiCalls };
    nextPage++;
  }

  // Expand backward while the prev page's last entry is at or below targetRP (ties at boundary)
  let prevPage = page - 1;
  while (prevPage >= 1) {
    const prev = await fetchLeaderboard(prevPage);
    apiCalls++;
    if (!prev.length || prev[prev.length - 1].rankPoints > targetRP) break;
    const found = prev.find(p => p.id === username);
    if (found) return { position: found.position, page: prevPage, apiCalls };
    prevPage--;
  }

  return { position: null, page: null, apiCalls };
}

export async function findLeaderboardPosition(username, targetRP) {
  let page = 1;
  let apiCalls = 0;

  // Phase 1: jump forward by 50 pages until targetRP is in range or we overshoot
  while (true) {
    const entries = await fetchLeaderboard(page);
    apiCalls++;

    if (!entries.length) break; // jumped past end of leaderboard

    const firstRP = entries[0].rankPoints;
    const lastRP = entries[entries.length - 1].rankPoints;

    if (firstRP >= targetRP && lastRP <= targetRP) {
      return searchPage(username, targetRP, entries, page, apiCalls);
    }

    if (lastRP > targetRP) {
      page += 20; // entire page is above target, go deeper
    } else {
      break; // entire page is below target, overshot
    }
  }

  // Phase 2: decrement one page at a time back to the right range
  page = Math.max(1, page - 1);
  while (page >= 1) {
    const entries = await fetchLeaderboard(page);
    apiCalls++;

    if (!entries.length) { page--; continue; }

    const firstRP = entries[0].rankPoints;
    const lastRP = entries[entries.length - 1].rankPoints;

    if (firstRP >= targetRP && lastRP <= targetRP) {
      return searchPage(username, targetRP, entries, page, apiCalls);
    }

    if (lastRP > targetRP) break; // gone too far back, player not found

    page--;
  }

  return { position: null, page: null, apiCalls };
}

export async function fetchRank(username = 'speztl') {
  const response = await fetch(
    `https://api.r6data.eu/api/stats?type=stats&nameOnPlatform=${username}&platformType=uplay&platform_families=pc`,
    {
      headers: { 'api-key': process.env.R6DATA_API_KEY }
    }
  );

  if (!response.ok) {
    throw new Error(`R6Data API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const boards = data?.platform_families_full_profiles?.[0]?.board_ids_full_profiles;
  const profile = boards?.find(b => b.board_id === 'ranked')?.full_profiles?.[0]?.profile;

  if (!profile) throw new Error('No ranked profile found for this player');

  return {
    rank: RANK_NAMES[profile.rank] ?? 'Unknown',
    rp: profile.rank_points.toLocaleString(),
    rawRank: profile.rank,
    rawRP: profile.rank_points
  };
}
