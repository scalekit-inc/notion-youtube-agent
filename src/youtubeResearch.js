/**
 * YouTube channel research pipeline — keyword expansion, search, dedup, scoring.
 * Used by the YouTube agent tool.
 */

import { chat } from './llm.js';
import { getYouTubeAccountId, searchYouTube, getChannelDetails } from './youtubeTools.js';

function parseJsonArray(text, fallback = []) {
  try { return JSON.parse(text.trim()); } catch {}
  const start = text.indexOf('[');
  if (start === -1) return fallback;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return fallback;
}

export async function expandKeyword(client, model, keyword) {
  const response = await chat({
    client,
    model,
    systemPrompt: 'You are a research assistant. Respond only with valid JSON.',
    messages: [
      {
        role: 'user',
        content: `Generate 5 YouTube search queries to find channels/creators who make content about: "${keyword}".

Rules:
- Treat the keyword as a tech/software topic (e.g. "clerk" = Clerk.dev auth product, not a job title)
- Focus on finding content creators and developer educators, not official brand channels
- Use specific terms: product names, frameworks, use cases (e.g. "Clerk.dev tutorial", "Next.js authentication Clerk", "React auth clerk 2024")
- Cover different angles: tutorials, reviews, comparisons, walkthroughs

Return ONLY a JSON array of strings, no explanation.
Example: ["Clerk.dev authentication tutorial", "Next.js Clerk auth integration", "React Clerk login 2024"]`,
      },
    ],
  });

  try {
    return parseJsonArray(response.content, [keyword]);
  } catch {
    return [keyword];
  }
}

export async function searchAndDedup(scalekitActions, accountId, variations) {
  const channelMap = new Map();

  for (const query of variations) {
    console.log(`  Searching: "${query}"`);
    let videos;
    try {
      videos = await searchYouTube(scalekitActions, accountId, query, { maxResults: 15 });
    } catch (err) {
      console.error(`  Search failed for "${query}":`, err.message);
      continue;
    }

    for (const video of videos) {
      if (!channelMap.has(video.channelId)) {
        channelMap.set(video.channelId, {
          channelId: video.channelId,
          channelTitle: video.channelTitle,
          sampleVideos: [],
          matchCount: 0,
        });
      }
      const entry = channelMap.get(video.channelId);
      entry.matchCount++;
      if (entry.sampleVideos.length < 3) {
        entry.sampleVideos.push({ title: video.title, videoId: video.videoId });
      }
    }
  }

  return channelMap;
}

export async function scoreChannels(client, model, keyword, channels) {
  const channelSummaries = channels.map((ch, i) =>
    `${i}. "${ch.title}" — ${ch.subscribers.toLocaleString()} subscribers. ${ch.description?.slice(0, 120) ?? ''}`,
  ).join('\n');

  const response = await chat({
    client,
    model,
    systemPrompt: 'You are a research analyst. Respond only with valid JSON.',
    messages: [
      {
        role: 'user',
        content: `Score each YouTube channel's relevance to the topic: "${keyword}".

Channels:
${channelSummaries}

Return a JSON array of objects with index and score (0–10, where 10 = highly relevant):
[{"index": 0, "score": 8, "reason": "..."}, ...]`,
      },
    ],
  });

  try {
    const scores = parseJsonArray(response.content, []);
    return channels.map((ch, i) => {
      const scored = scores.find((s) => s.index === i) ?? { score: 0, reason: '' };
      return { ...ch, relevanceScore: scored.score, reason: scored.reason };
    });
  } catch {
    return channels.map((ch) => ({ ...ch, relevanceScore: 0, reason: '' }));
  }
}

export function formatSubscribers(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/**
 * Run the full research pipeline: expand keyword → search → dedup → fetch details → score → rank.
 *
 * @param {object} opts
 * @param {object} opts.client
 * @param {string} opts.model
 * @param {object} opts.scalekitActions
 * @param {string} opts.youtubeIdentifier
 * @param {string} opts.keyword
 * @param {number} opts.topN
 * @returns {Promise<{ keyword, variations, totalFound, channels }>}
 */
export async function researchChannels({ client, model, scalekitActions, youtubeIdentifier, keyword, topN = 15 }) {
  const accountId = await getYouTubeAccountId(scalekitActions, youtubeIdentifier);

  console.log('[YouTube] Expanding keyword...');
  const variations = await expandKeyword(client, model, keyword);
  console.log('  Variations:', variations);

  console.log('[YouTube] Searching...');
  const channelMap = await searchAndDedup(scalekitActions, accountId, variations);
  console.log(`  Found ${channelMap.size} unique channels`);

  if (channelMap.size === 0) return { keyword, variations, totalFound: 0, channels: [] };

  const preFiltered = [...channelMap.values()]
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, topN * 3);

  console.log('[YouTube] Fetching channel details...');
  const channelDetails = await getChannelDetails(scalekitActions, accountId, preFiltered.map((c) => c.channelId));

  const enriched = channelDetails.map((ch) => ({
    ...ch,
    matchCount: channelMap.get(ch.channelId)?.matchCount ?? 0,
    sampleVideos: channelMap.get(ch.channelId)?.sampleVideos ?? [],
  }));

  console.log('[YouTube] Scoring channels...');
  const scored = await scoreChannels(client, model, keyword, enriched);

  const topChannels = scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.matchCount - a.matchCount)
    .slice(0, topN)
    .map((ch) => ({
      title: ch.title,
      subscribers: formatSubscribers(ch.subscribers),
      subscriberCount: ch.subscribers,
      videoCount: ch.videoCount,
      url: ch.url,
      handle: ch.handle ?? null,
      relevanceScore: ch.relevanceScore,
      reason: ch.reason,
      sampleVideo: ch.sampleVideos?.[0] ?? null,
    }));

  return { keyword, variations, totalFound: channelMap.size, channels: topChannels };
}
