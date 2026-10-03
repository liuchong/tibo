import {spawnSync} from 'node:child_process';
import {realpathSync, mkdirSync, existsSync, symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const home = process.env.ELISCRIPT_HOME || resolve('node_modules/eliscript');
const result = spawnSync(realpathSync(resolve(home, 'bin/eliscript-build')), ['--config', 'eliscript.json'], {stdio:'inherit', env:{...process.env, ELISCRIPT_JS_RUNTIME:'bun'}});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

if (result.status === 0) {
  const target = resolve('dist/adapters/lark/node_modules');
  mkdirSync(resolve('dist/adapters/lark'), {recursive:true});
  if (!existsSync(target) && existsSync(resolve('adapters/lark/node_modules'))) symlinkSync(resolve('adapters/lark/node_modules'), target, 'dir');
}
