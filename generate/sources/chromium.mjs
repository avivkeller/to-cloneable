import { fetchSource, tagMatcher } from './fetch.mjs';

const path = 'third_party/blink/renderer/bindings/core/v8/serialization/serialization_tag.h';

export async function chromium(version) {
  // Gitiles serves file contents base64-encoded.
  const { ref, text } = await fetchSource(
    (ref) => `https://chromium.googlesource.com/chromium/src/+/${ref}/${path}?format=TEXT`,
    [`refs/tags/${version}`, 'main'],
  );
  const header = atob(text);
  const tags = [...header.matchAll(/\bk(\w+?)(?:Index)?Tag\s*=/g)].map((match) => match[1]);
  if (tags.length === 0) throw new Error(`No serialization tags found in Chromium's ${path}`);
  return { ref: `chromium@${ref}`, lists: tagMatcher(tags) };
}
