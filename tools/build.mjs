import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
const home = process.env.ELISCRIPT_HOME || resolve('node_modules/eliscript');
const result = spawnSync(realpathSync(resolve(home, 'bin/eliscript-build')), ['--config', 'eliscript.json'], {stdio:'inherit', env:{...process.env, ELISCRIPT_JS_RUNTIME:'bun'}});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
