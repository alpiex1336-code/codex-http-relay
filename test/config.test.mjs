import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,link} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';
import {planConfig,restoreConfig,hash,readConfig,atomicWrite} from '../src/config.mjs';
const ID='00000000-0000-4000-8000-000000000001';

for(const original of ['', '# Preserve me\nmodel = "example-model"\n[features]\nweb_search = true\n',
  'model_provider = "openai" # existing\nmodel = "example-model"\n',
  '# CRLF\r\nmodel_provider = "openai"\r\n[projects."C:\\Projects\\A"]\r\ntrust_level = "trusted"\r\n'.replace('C:\\Projects\\A','project-a'),
  'model_provider = "openai"', 'instructions = """\nordinary multiline text\n"""\n']) {
  test(`config round trip: ${hash(original).slice(0,8)}`,()=>{
    const p=planConfig(original,18888,ID);
    const parsed=parse(p.installed);assert.equal(parsed.model_provider,'openai');
    assert.equal(parsed.openai_base_url,'http://127.0.0.1:18888/backend-api/codex');
    assert.equal(restoreConfig(p.installed,p),original);
  });
}
test('rollback retains unrelated later edits',()=>{
  const p=planConfig('model_provider = "openai"\nmodel = "a"\n',18888,ID);
  const changed=p.installed.replace('model = "a"','model = "b"')+'\n[features]\nexample = true\n';
  assert.equal(restoreConfig(changed,p),'model_provider = "openai"\nmodel = "b"\n\n[features]\nexample = true\n');
});
test('modified routing or original marker blocks rollback',()=>{
  const p=planConfig('model_provider = "openai"\n',18888,ID);
  assert.throws(()=>restoreConfig(p.installed.replace('18888','18889'),p));
  assert.throws(()=>restoreConfig(p.installed.replace('original-provider','changed-marker'),p));
});
for(const original of ['model_provider="custom"\n','openai_base_url="https://example.invalid"\n',
  '[model_providers.openai]\nname="Other"\n','[profiles.work]\nmodel_provider="openai"\n',
  '"model_provider" = "openai"\n',
  'model_provider = "openai"\nnotes = """\nmodel_provider = "example"\n"""\n']) {
  test(`ambiguous or custom config rejected: ${hash(original).slice(0,8)}`,()=>assert.throws(()=>planConfig(original,18888,ID)));
}
test('atomic write refuses concurrent data and symlink/hardlink',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'relay config '));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.toml');await writeFile(file,'first');
  await assert.rejects(atomicWrite(file,'bad',{expectedHash:hash('other')}));
  assert.equal(await readFile(file,'utf8'),'first');
  await atomicWrite(file,'second',{expectedHash:hash('first')});
  assert.equal(await readFile(file,'utf8'),'second');
  const hard=path.join(dir,'hard.toml');await link(file,hard);
  await assert.rejects(readConfig(file));
  if(process.platform!=='win32') {
    const sym=path.join(dir,'symlink.toml');await symlink(file,sym);await assert.rejects(readConfig(sym));
  }
});
