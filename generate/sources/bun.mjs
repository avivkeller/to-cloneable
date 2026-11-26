import { fetchSource, github, tagMatcher } from './fetch.mjs';

// Bun's serializer is a fork of WebKit's; the file has moved between releases.
const paths = ['src/jsc/bindings/webcore/SerializedScriptValue.cpp', 'src/bun.js/bindings/webcore/SerializedScriptValue.cpp'];

export async function bun(version) {
  const refs = [`bun-v${version}`, 'main'];
  let found;
  for (const path of paths) {
    found = await fetchSource(github('oven-sh/bun', path), refs).catch(() => undefined);
    if (found) break;
  }
  if (!found) throw new Error("Bun's SerializedScriptValue.cpp was not found.");
  const tags = [...found.text.matchAll(/^\s*(\w+)Tag\s*=/gm)].map((match) => match[1]);
  if (tags.length === 0) throw new Error("No serialization tags found in Bun's SerializedScriptValue.cpp");
  return { ref: `bun@${found.ref}`, lists: tagMatcher(tags) };
}
