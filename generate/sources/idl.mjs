import { createRequire } from 'node:module';
import webref from '@webref/idl';

export async function idl() {
  const interfaces = new Set();
  const serializable = new Set();
  for (const definitions of Object.values(await webref.parseAll())) {
    for (const definition of definitions) {
      // A partial interface adds members; the attribute lives on the main one.
      if (definition.type !== 'interface' || definition.partial) continue;
      interfaces.add(definition.name);
      if (definition.extAttrs.some((attribute) => attribute.name === 'Serializable')) serializable.add(definition.name);
    }
  }
  const { version } = createRequire(import.meta.url)('@webref/idl/package.json');
  return { ref: `@webref/idl@${version}`, interfaces, serializable };
}
