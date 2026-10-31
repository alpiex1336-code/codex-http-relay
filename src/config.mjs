import {parse} from 'smol-toml';
import {isDeepStrictEqual} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {lstat, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
const PREFIX = '# codex-http-relay';
// smol-toml uses null-prototype tables; compare values without prototype noise.
const sameValue = (a,b) => isDeepStrictEqual(structuredClone(a),structuredClone(b));
const withoutRouting = value => {
  const copy = structuredClone(value);
  delete copy.model_provider;
  delete copy.openai_base_url;
  return copy;
};

export function validateOriginal(text) {
  if (text.includes(PREFIX)) throw new Error('Managed relay markers already exist; use status or rollback.');
  const cfg = parse(text);
  if (cfg.model_provider !== undefined && cfg.model_provider !== 'openai')
    throw new Error('Custom provider selected; automatic migration is deliberately unsupported.');
  if (cfg.openai_base_url !== undefined || cfg.model_providers?.openai !== undefined)
    throw new Error('An existing OpenAI route/override must be reviewed separately.');
  for (const profile of Object.values(cfg.profiles ?? {})) {
    if (profile.openai_base_url !== undefined || profile.model_provider !== undefined)
      throw new Error('Profile-specific provider routing requires manual review.');
  }
  return cfg;
}

export function planConfig(original, port, id) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error('Invalid installation parameters.');
  const before = validateOriginal(original);
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let remainder = original;
  let replacedLine = null;
  const placeholder = `${PREFIX} original-provider ${id}`;
  if (before.model_provider !== undefined) {
    // Only accept a single, simple assignment; parsing proves its semantic location.
    const matches = [...original.matchAll(/^[ \t]*model_provider[ \t]*=[^\r\n]*(?:\r?\n|$)/gm)];
    if (matches.length !== 1) throw new Error('Ambiguous provider assignment; leave config untouched.');
    replacedLine = matches[0][0];
    remainder = original.slice(0, matches[0].index) + placeholder + newline
      + original.slice(matches[0].index + replacedLine.length);
    const expected = structuredClone(before); delete expected.model_provider;
    if (!sameValue(parse(remainder), expected)) throw new Error('Cannot safely isolate root provider assignment.');
  }
  const baseUrl = `http://127.0.0.1:${port}/backend-api/codex`;
  const block = `${PREFIX} BEGIN ${id}${newline}model_provider = "openai"${newline}openai_base_url = "${baseUrl}"${newline}${PREFIX} END ${id}${newline}`;
  const installed = block + remainder;
  const expected = {...before, model_provider: 'openai', openai_base_url: baseUrl};
  if (!sameValue(parse(installed), expected)) throw new Error('Config semantic verification failed.');
  return {id, baseUrl, block, placeholder, replacedLine, newline, originalHash: hash(original), installedHash: hash(installed), installed};
}

export function restoreConfig(current, plan) {
  if (!current.startsWith(plan.block) || current.indexOf(plan.block, plan.block.length) !== -1)
    throw new Error('Managed routing block changed; refusing to overwrite user edits.');
  let restored = current.slice(plan.block.length);
  if (plan.replacedLine !== null) {
    const marker = plan.placeholder + plan.newline;
    if (restored.split(marker).length !== 2) throw new Error('Original-provider marker changed; manual recovery required.');
    restored = restored.replace(marker, plan.replacedLine);
  }
  const before = parse(current), after = parse(restored);
  if (before.model_provider !== 'openai' || before.openai_base_url !== plan.baseUrl
      || !sameValue(withoutRouting(before), withoutRouting(after)))
    throw new Error('Rollback would change unrelated settings.');
  if (after.openai_base_url !== undefined || (after.model_provider !== undefined && after.model_provider !== 'openai'))
    throw new Error('Unexpected restored route.');
  return restored;
}

export async function readConfig(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024)
      throw new Error('Config must be a regular, single-link file under 4 MiB.');
    const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(file));
    return {text, existed: true};
  } catch (e) {
    if (e.code === 'ENOENT') return {text: '', existed: false};
    throw e;
  }
}

export async function atomicWrite(file, contents, {expectedHash, expectedExists} = {}) {
  const current = await readConfig(file);
  if ((expectedHash !== undefined && hash(current.text) !== expectedHash)
      || (expectedExists !== undefined && current.existed !== expectedExists))
    throw new Error('File changed during operation; refusing to overwrite it.');
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, contents, {flag: 'wx', mode: 0o600});
    const again = await readConfig(file);
    if (again.text !== current.text || again.existed !== current.existed)
      throw new Error('Concurrent edit detected; no replacement performed.');
    await rename(temp, file);
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
