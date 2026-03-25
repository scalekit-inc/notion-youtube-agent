/**
 * One-time Notion OAuth setup via Scalekit.
 *
 * Run this ONCE before deploying the actor:
 *   npm run auth:setup
 *
 * It will:
 *   1. Create a connected account for your shared Notion workspace
 *   2. Print the authorization URL — open it in a browser
 *   3. After you authorize, the token is stored in Scalekit automatically
 *
 * After the browser step completes, run this script again to verify status.
 */

import 'dotenv/config';
import { ScalekitClient } from '@scalekit-sdk/node';

const {
  SCALEKIT_ENV_URL,
  SCALEKIT_CLIENT_ID,
  SCALEKIT_CLIENT_SECRET,
  NOTION_IDENTIFIER = 'shared-notion',
} = process.env;

if (!SCALEKIT_ENV_URL || !SCALEKIT_CLIENT_ID || !SCALEKIT_CLIENT_SECRET) {
  console.error('Missing env vars. Copy .env.example to .env and fill in your Scalekit credentials.');
  process.exit(1);
}

const scalekit = new ScalekitClient(SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID, SCALEKIT_CLIENT_SECRET);
const actions = scalekit.actions;

console.log(`\nChecking Notion connection for identifier: "${NOTION_IDENTIFIER}"...\n`);

const resp = await actions.getOrCreateConnectedAccount({
  connectionName: 'notion',
  identifier: NOTION_IDENTIFIER,
});

const account = resp.connectedAccount ?? resp;
console.log('Connected account status:', account.status);
console.log('Connected account ID:', account.id);

// ConnectorStatus: 0=UNSPECIFIED, 1=ACTIVE, 2=EXPIRED, 3=PENDING_AUTH
const ACTIVE = 1;
const statusLabel = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' }[account.status] ?? account.status;
console.log('Resolved status label:', statusLabel);

if (account.status === ACTIVE) {
  console.log('\nNotion is already connected and active. You are ready to run the actor.\n');
  process.exit(0);
}

// Generate the OAuth authorization link
const { link } = await actions.getAuthorizationLink({
  connectionName: 'notion',
  identifier: NOTION_IDENTIFIER,
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log('ACTION REQUIRED: Open the link below in your browser');
console.log('to connect your Notion workspace:\n');
console.log(link);
console.log('\nAfter you authorize in Notion, run this script again to');
console.log('verify the connection status.');
console.log('═══════════════════════════════════════════════════════════\n');
