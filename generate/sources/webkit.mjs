import { fetchSource, github, tagMatcher } from './fetch.mjs';

const path = 'Source/WebCore/bindings/js/SerializedScriptValue.cpp';

// Playwright's WebKit is a build of trunk with no matching tag.
export async function webkit() {
  const { ref, text } = await fetchSource(github('WebKit/WebKit', path), ['main']);
  const tags = [...text.matchAll(/\bcase (\w+)Tag:/g)].map((match) => match[1]);
  if (tags.length === 0) throw new Error(`No serialization tags found in WebKit's ${path}`);
  return { ref: `WebKit@${ref}`, lists: tagMatcher(tags) };
}
