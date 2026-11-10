// r2-put.js — put/get one R2 object over R2's S3-compatible API.
// shortcut: a trimmed copy of the private repo's pipeline/r2-put.js (S3 transport only, put + get); edit both.
// The credentials are read from the environment ONLY (repo secrets). Never write them to a file or log them.
'use strict';
const fs = require('fs');
const { AwsClient } = require('aws4fetch');

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)) throw new Error('R2 credentials missing (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
const url = (bucket, key) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`;

// Did the object land at the size we meant? A put that reported failure is checked before it is believed.
async function landed(bucket, key, bytes) {
  try { const r = await client.fetch(url(bucket, key), { method: 'HEAD' }); return r.ok && Number(r.headers.get('content-length')) === bytes; } catch (e) { return false; }
}

// gzip JSON objects, tagged so HTTP clients inflate them on the way back
async function putObject(bucket, key, filePath) {
  const body = fs.readFileSync(filePath);
  try {
    const res = await client.fetch(url(bucket, key), { method: 'PUT', body, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });
    if (res.ok) { await res.arrayBuffer().catch(() => {}); return { ok: true }; }
    const msg = `HTTP ${res.status}: ${(await res.text().catch(() => res.statusText)).slice(0, 200)}`;
    return (await landed(bucket, key, body.length)) ? { ok: true, recovered: true, msg } : { ok: false, msg };
  } catch (e) {
    return (await landed(bucket, key, body.length)) ? { ok: true, recovered: true, msg: e.message } : { ok: false, msg: e.message };
  }
}

// may hand back an already-decompressed body: callers sniff the gzip magic bytes
async function getObject(bucket, key, destPath) {
  try {
    const res = await client.fetch(url(bucket, key));
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
    fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return { ok: true };
  } catch (e) { return { ok: false, msg: e.message }; }
}

module.exports = { putObject, getObject };
