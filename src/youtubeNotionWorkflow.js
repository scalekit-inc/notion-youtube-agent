/**
 * YouTube → Notion channel research workflow.
 *
 * Pipeline:
 *   1. LLM expands keyword into semantic variations
 *   2. YouTube search for each variation (via Scalekit)
 *   3. Deduplicate channels across all results
 *   4. Fetch channel details (subscribers, description)
 *   5. LLM scores each channel for relevance (0–10)
 *   6. Append ranked results to a Notion page
 */

import { chat } from './llm.js';
import { getYouTubeAccountId, searchYouTube, getChannelDetails } from './youtubeTools.js';

/** Robustly extract the first JSON array from an LLM response string */
function parseJsonArray(text, fallback = []) {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch {}
  // Extract first [...] block, handling nested brackets
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

// ── Step 1: Keyword expansion ─────────────────────────────────────────────────

async function expandKeyword(client, provider, model, keyword) {
  const response = await chat({
    client,
    provider,
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

// ── Step 2+3: Search + deduplicate ───────────────────────────────────────────

async function searchAndDedup(scalekitActions, accountId, variations) {
  const channelMap = new Map(); // channelId → { channelTitle, sampleVideos, matchCount }

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

// ── Step 5: LLM scoring ──────────────────────────────────────────────────────

async function scoreChannels(client, provider, model, keyword, channels) {
  const channelSummaries = channels.map((ch, i) =>
    `${i}. "${ch.title}" — ${ch.subscribers.toLocaleString()} subscribers. ${ch.description?.slice(0, 120) ?? ''}`,
  ).join('\n');

  const response = await chat({
    client,
    provider,
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

// ── Step 6: Build + append Notion blocks ─────────────────────────────────────

function formatSubscribers(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function buildNotionBlocks(keyword, topChannels) {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const blocks = [
    { type: 'divider' },
    { type: 'heading_2', text: `YouTube Research: "${keyword}" — ${now}` },
  ];

  for (const ch of topChannels) {
    const sampleVideo = ch.sampleVideos?.[0];
    const videoLine = sampleVideo
      ? `Sample video: ${sampleVideo.title} (https://youtube.com/watch?v=${sampleVideo.videoId})`
      : 'No sample video';

    blocks.push(
      { type: 'heading_3', text: ch.title },
      { type: 'bulleted_list_item', text: `Relevance Score: ${ch.relevanceScore}/10 — ${ch.reason}` },
      { type: 'bulleted_list_item', text: `Subscribers: ${formatSubscribers(ch.subscribers)} (${ch.videoCount.toLocaleString()} videos)` },
      { type: 'bulleted_list_item', text: `Channel: ${ch.handle ? `@${ch.handle.replace('@', '')}` : ch.url} — ${ch.url}` },
      { type: 'bulleted_list_item', text: videoLine },
    );
  }

  return blocks;
}

async function appendToNotion(scalekitActions, notionIdentifier, notionPageId, blocks) {
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'notion',
    identifier: notionIdentifier,
  });
  const account = resp.connectedAccount ?? resp;

  await scalekitActions.executeTool({
    toolName: 'notion_page_content_append',
    connectedAccountId: account.id,
    toolInput: { block_id: notionPageId, blocks },
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.client              - LLM client
 * @param {string} opts.provider            - 'anthropic' | 'openai'
 * @param {string} opts.model               - model name
 * @param {object} opts.scalekitActions     - scalekit.actions
 * @param {string} opts.youtubeIdentifier   - Scalekit identifier for YouTube ('shared-youtube')
 * @param {string} opts.notionIdentifier    - Scalekit identifier for Notion ('shared-notion')
 * @param {string} opts.notionPageId        - ID of the Notion page to append results to
 * @param {string} opts.keyword             - search keyword (e.g. "clerk creators")
 * @param {number} opts.topN                - how many top channels to surface (default 15)
 */
export async function runYouTubeNotionWorkflow({
  client,
  provider,
  model,
  scalekitActions,
  youtubeIdentifier,
  notionIdentifier,
  notionPageId,
  keyword,
  topN = 15,
}) {
  console.log(`\nKeyword: "${keyword}"`);

  // Fetch YouTube account ID once — reused across all tool calls
  const youtubeAccountId = await getYouTubeAccountId(scalekitActions, youtubeIdentifier);

  // Step 1: Expand keyword
  console.log('\n[1/5] Expanding keyword into search variations...');
  const variations = await expandKeyword(client, provider, model, keyword);
  console.log('  Variations:', variations);

  // Step 2+3: Search + deduplicate
  console.log('\n[2/5] Searching YouTube for each variation...');
  const channelMap = await searchAndDedup(scalekitActions, youtubeAccountId, variations);
  console.log(`  Found ${channelMap.size} unique channels`);

  if (channelMap.size === 0) {
    throw new Error('No YouTube results found. Check the keyword or YouTube connection.');
  }

  // Step 3: Fetch channel details — pre-filter to topN*3 by matchCount to limit LLM input
  console.log('\n[3/5] Fetching channel details (subscribers, description)...');
  const preFiltered = [...channelMap.values()]
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, topN * 3);
  const channelIds = preFiltered.map((c) => c.channelId);
  const channelDetails = await getChannelDetails(scalekitActions, youtubeAccountId, channelIds);

  // Merge match count + sample videos into details
  const enriched = channelDetails.map((ch) => ({
    ...ch,
    matchCount: channelMap.get(ch.channelId)?.matchCount ?? 0,
    sampleVideos: channelMap.get(ch.channelId)?.sampleVideos ?? [],
  }));

  // Step 4: LLM scoring
  console.log('\n[4/5] Scoring channels for relevance...');
  const scored = await scoreChannels(client, provider, model, keyword, enriched);

  // Sort: primary = relevance score, secondary = match count
  const sorted = scored.sort((a, b) =>
    b.relevanceScore - a.relevanceScore || b.matchCount - a.matchCount,
  );
  const topChannels = sorted.slice(0, topN);

  console.log(`\n  Top ${topChannels.length} channels:`);
  topChannels.forEach((ch) =>
    console.log(`  [${ch.relevanceScore}/10] ${ch.title} — ${formatSubscribers(ch.subscribers)} subs`),
  );

  // Step 5: Append to Notion
  console.log('\n[5/5] Appending results to Notion page...');
  const blocks = buildNotionBlocks(keyword, topChannels);
  await appendToNotion(scalekitActions, notionIdentifier, notionPageId, blocks);
  console.log('  Done.');

  return { keyword, variations, totalChannelsFound: channelMap.size, topChannels };
}
