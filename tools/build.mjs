import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const home = process.env.ELISCRIPT_HOME || resolve('node_modules/eliscript');
const configuration = JSON.parse(await readFile('eliscript.json', 'utf8'));
const output = resolve(configuration.outDir);
const runtime = resolve(output, 'node_modules/eliscript');
await rm(runtime, {recursive:true, force:true});
const result = spawnSync(realpathSync(resolve(home, 'bin/eliscript-build')), ['--config', 'eliscript.json'], {stdio:'inherit', env:{...process.env, ELISCRIPT_JS_RUNTIME:'bun'}});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// Bundle the runtime closure, leaving application modules and source maps intact.
// Copying a fixed capsule list misses dependencies such as literal support.
const manifest = JSON.parse(await readFile(resolve(output, 'eliscript-project.json'), 'utf8'));
const runtimes = new Set();
for (const module of manifest.modules) {
  const source = await readFile(resolve(output, module.output), 'utf8');
  for (const [, , name] of source.matchAll(/(?:\bfrom\s*|\bimport\s*)(["'])eliscript\/runtime\/([^"'\n]+)\1/g)) {
    if (!/^[\w/-]+\.mjs$/.test(name)) throw new Error('Unexpected compiler runtime import');
    runtimes.add(name);
  }
}
await rm(runtime, {recursive:true, force:true});
if (runtimes.size) {
  const bundled = await Bun.build({
    entrypoints:[...runtimes].map(name => resolve(home, 'runtime', name)),
    root:resolve(home, 'runtime'), outdir:resolve(runtime, 'runtime'),
    target:'bun', format:'esm', splitting:true,
    naming:{entry:'[dir]/[name].mjs', chunk:'chunks/[name]-[hash].mjs'},
  });
  if (!bundled.success) throw new AggregateError(bundled.logs, 'Eliscript runtime packaging failed');
  await mkdir(runtime, {recursive:true});
  await writeFile(resolve(runtime, 'package.json'), JSON.stringify({
    name:'eliscript', private:true, type:'module', exports:{'./runtime/*':'./runtime/*'},
  }) + '\n');
}
