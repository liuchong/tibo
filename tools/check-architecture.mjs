import {readdir, readFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Source import checks complement the runtime tests that intercept process execution.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
async function sources(directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), {withFileTypes: true})) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sources(path));
    else if (entry.isFile() && path.endsWith('.eli')) files.push(path);
  }
  return files;
}
const files = [...await sources('src'), ...await sources('adapters')];
const graph = new Map();
const identities = new Set();
for (const file of files) {
  const text = await readFile(resolve(root, file), 'utf8');
  const identity = text.match(/^\(module\s+([^\s()]+)/m)?.[1];
  if (!identity || identities.has(identity)) failures.push(`${file}: missing or duplicate module identity`);
  identities.add(identity);
  const imports = [];
  for (const [, specifier] of text.matchAll(/^\s*\(import\s+"([^"]+)"/gm)) {
    if (!specifier.endsWith('.eli')) {
      imports.push(specifier);
      continue;
    }
    const target = relative(root, resolve(root, dirname(file), specifier)).split(sep).join('/');
    if (!files.includes(target)) failures.push(`${file}: unresolved local import ${specifier}`);
    if (file.startsWith('src/') && target.startsWith('adapters/')) failures.push(`${file}: business code depends on an IM adapter`);
    const layer = file.split('/')[1];
    const targetLayer = target.split('/')[1];
    const allowed = {platform: ['platform'], evidence: ['evidence', 'platform'],
      forecast: ['forecast', 'evidence', 'platform'], ai: ['ai', 'evidence', 'forecast', 'platform']}[layer];
    if (file.startsWith('src/') && allowed && (!target.startsWith('src/') || !allowed.includes(targetLayer))) {
      failures.push(`${file}: ${layer} imports higher-level module ${target}`);
    }
    imports.push(target);
  }
  graph.set(file, imports);
}
const visited = new Set();
function visit(file, stack = []) {
  if (stack.includes(file)) {
    failures.push(`cyclic imports: ${[...stack.slice(stack.indexOf(file)), file].join(' -> ')}`);
    return;
  }
  if (visited.has(file) || !graph.has(file)) return;
  for (const target of graph.get(file)) visit(target, [...stack, file]);
  visited.add(file);
}
for (const file of files) visit(file);
function publicDependencies(file, visited = new Set()) {
  if (visited.has(file) || !graph.has(file)) return;
  visited.add(file);
  for (const target of graph.get(file)) {
    if (target === 'node:child_process' || target === 'src/platform/service.eli') {
      failures.push(`${file}: public business path reaches process or installation capability`);
    }
    publicDependencies(target, visited);
  }
}
for (const entry of ['src/commands/index.eli', 'src/app/mcp.eli', 'adapters/lark/inbox.eli', 'adapters/lark/broadcast.eli']) {
  publicDependencies(entry);
}
if (failures.length) {
  for (const failure of new Set(failures)) console.error(failure);
  process.exitCode = 1;
} else console.log(`Architecture: ${files.length} modules, acyclic imports, layer and public execution boundaries passed.`);
