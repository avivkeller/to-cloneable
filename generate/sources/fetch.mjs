export async function fetchSource(url, refs) {
  for (const ref of refs) {
    const response = await fetch(url(ref));
    if (response.ok) return { ref, text: await response.text() };
    if (response.status !== 404) throw new Error(`${url(ref)}: HTTP ${response.status}`);
  }
  throw new Error(`Not found at any of ${refs.join(', ')}: ${url('<ref>')}`);
}

export const github = (repository, path) => (ref) => `https://raw.githubusercontent.com/${repository}/${ref}/${path}`;

// Engines decorate the class name (kVideoFrameTag, SCTAG_DOM_VIDEOFRAME), hence
// the suffix match. It can match by accident (RTCEncodedVideoFrame ends with
// VideoFrame), so compile.mjs also requires the spec to agree.
export function tagMatcher(tags) {
  const lowered = [...tags].map((tag) => tag.toLowerCase());
  return (className) => lowered.some((tag) => tag.endsWith(className.toLowerCase()));
}
