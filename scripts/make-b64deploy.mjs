#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const SITE_ID = '3b53561c-3d9b-4184-b525-2ab704ca9eb6';

function token() {
  const envToken = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
  if (envToken) return envToken;
  const cfg = JSON.parse(readFileSync(join(homedir(), 'Library/Preferences/netlify/config.json'), 'utf8'));
  return cfg.users[cfg.userId].auth.token;
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'scripts' || name === '.git' || name.startsWith('b64deploy')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

function sha1(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

const paths = walk(ROOT);
const manifest = {};
const payloads = {};
for (const p of paths) {
  const buf = readFileSync(join(ROOT, p));
  manifest[p] = sha1(buf);
  payloads[p] = buf.toString('base64');
}

const out = { token: token(), siteId: SITE_ID, manifest, payloads };
writeFileSync(join(ROOT, 'scripts/b64deploy-zonicme.json'), JSON.stringify(out));
console.log('wrote', paths.length, 'files');
