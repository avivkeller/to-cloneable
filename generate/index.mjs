#!/usr/bin/env node
//   node generate/index.mjs                       -> src/index.node.js
//   deno run -A generate/index.mjs                -> src/index.deno.js
//   bun generate/index.mjs                        -> src/index.bun.js
//   node generate/index.mjs browser [engine...]   -> src/index.browser.js
import { writeFile } from 'node:fs/promises';
import { observeBrowser } from './browser.mjs';
import { compile } from './compile.mjs';
import { observe } from './observe.mjs';
import { renderEntry, renderNotes } from './render.mjs';
import { engineSource } from './sources/index.mjs';
import { idl as fetchIdl } from './sources/idl.mjs';

// Instances sampled by observe() leave rejections and open handles behind.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

const local = globalThis.Bun
  ? { name: 'bun', version: Bun.version }
  : globalThis.Deno
    ? { name: 'deno', version: Deno.version.deno }
    : { name: 'node', version: process.versions.node };
const [target = local.name, ...engines] = process.argv.slice(2);

try {
  const runtimes = {};
  if (target === 'browser') {
    for (const engine of engines.length > 0 ? engines : ['chromium', 'firefox', 'webkit']) {
      runtimes[engine] = await observeBrowser(engine);
    }
  } else if (target === local.name && engines.length === 0) {
    runtimes[target] = { version: local.version, classes: await observe() };
  } else {
    throw new Error(`Usage: generate/index.mjs [browser [engine...]]   (this runtime is ${local.name})`);
  }
  for (const [name, runtime] of Object.entries(runtimes)) {
    runtime.source = await engineSource[name]?.(runtime.version);
  }
  const idl = await fetchIdl();
  const { table, findings } = compile(runtimes, idl);

  const url = new URL(`../src/index.${target}.js`, import.meta.url);
  await writeFile(url, renderEntry(table));
  console.error(`Wrote src/index.${target}.js`);
  // stdout carries only the notes, so the workflow can redirect it into the
  // pull request description.
  console.log(renderNotes(target, runtimes, idl, findings));
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
