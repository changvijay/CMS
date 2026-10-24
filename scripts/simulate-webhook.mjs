#!/usr/bin/env node
/**
 * Sends a correctly signed Instagram webhook to your own server, so you can test the auto-reply
 * without commenting from a second account.
 *
 *   node --env-file=.env scripts/simulate-webhook.mjs --account <your IG account id> --type comment --text "link"
 *   node --env-file=.env scripts/simulate-webhook.mjs --account <id> --type dm --text "link" --sender 555
 *
 * Options: --url (default http://localhost:5001), --account (required), --type comment|dm, --text,
 *          --sender (default 555), --username (comments), --media (post/reel id, comments), --product REELS|FEED (comments),
 *          --id (event id; random by default)
 * Needs META_APP_SECRET in the environment: the same one the server uses. Run the server with
 * AUTOMATION_DRY_RUN=true to see what it would send without messaging anyone.
 */
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5001' },
    account: { type: 'string' },
    type: { type: 'string', default: 'comment' },
    text: { type: 'string', default: 'link' },
    sender: { type: 'string', default: '555' },
    username: { type: 'string', default: 'test_user' },
    media: { type: 'string', default: '17900000000000001' },
    product: { type: 'string', default: 'REELS' },
    id: { type: 'string', default: crypto.randomBytes(6).toString('hex') },
  },
});

if (!a.account) {
  console.error('Missing --account (your Instagram account id, the "page_id" stored for the account).');
  process.exit(1);
}
const secret = process.env.META_APP_SECRET;
if (!secret) {
  console.error('META_APP_SECRET is not set. Run with: node --env-file=.env scripts/simulate-webhook.mjs ...');
  process.exit(1);
}

const payload = a.type === 'dm'
  ? { object: 'instagram', entry: [{ id: a.account, time: Date.now(), messaging: [{ sender: { id: a.sender }, recipient: { id: a.account }, timestamp: Date.now(), message: { mid: `m_${a.id}`, text: a.text } }] }] }
  : { object: 'instagram', entry: [{ id: a.account, time: Date.now(), field: 'comments', value: { id: `c_${a.id}`, from: { id: a.sender, username: a.username }, text: a.text, media: { id: a.media, media_product_type: a.product } } }] };

const body = JSON.stringify(payload);
const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
const res = await fetch(`${a.url.replace(/\/$/, '')}/api/webhooks/instagram`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body,
});
console.log(`${a.type} "${a.text}" -> HTTP ${res.status} (event id ${a.id})`);
process.exit(res.ok ? 0 : 1);
