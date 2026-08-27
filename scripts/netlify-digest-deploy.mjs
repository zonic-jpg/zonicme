#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const PUBLISH = ROOT;
const SITE_ID = process.env.NETLIFY_SITE_ID || '3b53561c-3d9b-4184-b525-2ab704ca9eb6';

function token() {
  const cfg = JSON.parse(readFileSync(join(homedir(), 'Library/Preferences/netlify/config.json'), 'utf8'));
  return cfg.users[cfg.userId].auth.token;
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'scripts' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push('/' + relative(base, p).split('\\').join('/'));
  }
  return out;
}

function sha1(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

async function main() {
  const auth = token();
  const files = Object.fromEntries(
    walk(PUBLISH).map((rel) => [rel, sha1(join(PUBLISH, rel.slice(1)))]),
  );
  const create = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const deploy = await create.json();
  if (!create.ok) throw new Error(`create deploy failed: ${create.status} ${JSON.stringify(deploy)}`);
  const hashToPath = Object.fromEntries(Object.entries(files).map(([p, h]) => [h, p]));
  const required = deploy.required || [];
  console.log('deploy', deploy.id, 'required', required.length);
  for (const hash of required) {
    const rel = hashToPath[hash];
    if (!rel) throw new Error(`missing path for hash ${hash}`);
    const body = readFileSync(join(PUBLISH, rel.slice(1)));
    const put = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files${rel}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/octet-stream' },
      body,
    });
    if (!put.ok) throw new Error(`upload ${rel} failed: ${put.status} ${await put.text()}`);
    console.log('uploaded', rel);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}`, {
      headers: { Authorization: `Bearer ${auth}` },
    }).then((r) => r.json());
    console.log('state', st.state, st.ssl_url || st.deploy_ssl_url || '');
    if (st.state === 'ready') {
      console.log('LIVE', st.ssl_url || st.deploy_ssl_url);
      process.exit(0);
    }
    if (st.state === 'error') throw new Error(st.error_message || 'deploy error');
  }
  throw new Error('deploy timeout');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
