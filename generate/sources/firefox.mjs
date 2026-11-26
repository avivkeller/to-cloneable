import { fetchSource, github, tagMatcher } from './fetch.mjs';

const path = 'dom/base/StructuredCloneTags.h';

export async function firefox(version) {
  const { ref, text } = await fetchSource(github('mozilla-firefox/firefox', path), [
    `FIREFOX_${version.replaceAll('.', '_')}_RELEASE`,
    'main',
  ]);
  const tags = [...text.matchAll(/\bSCTAG_DOM_(\w+)/g)].map((match) => match[1].replaceAll('_', ''));
  if (tags.length === 0) throw new Error(`No serialization tags found in Firefox's ${path}`);
  return { ref: `firefox@${ref}`, lists: tagMatcher(tags) };
}
