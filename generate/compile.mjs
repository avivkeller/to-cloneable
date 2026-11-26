/**
 * @param {Record<string, { classes: Record<string, any>, source?: { ref: string, lists(name: string): boolean } }>} runtimes
 * @param {{ ref: string, interfaces: Set<string>, serializable: Set<string> }} idl
 */
export function compile(runtimes, idl) {
  const names = Object.keys(runtimes);
  const leaf = (path) => path.slice(path.lastIndexOf('.') + 1);
  const findings = [];
  const note = (kind, runtime, path) => findings.push({ kind, runtime, path });

  const verdicts = {};
  for (const name of names) {
    const { classes, source } = runtimes[name];
    verdicts[name] = {};
    for (const [path, record] of Object.entries(classes)) {
      const inSpec = idl.serializable.has(leaf(path));
      // Only the class's own tag counts. WebKit tags FileSystemHandle and
      // encodes its subclasses inside it, but accepting an ancestor's tag
      // would also keep GPUPipelineError on the strength of DOMException's.
      const inSource = source?.lists(leaf(path)) ?? false;
      let verdict = record.result;
      if (verdict === 'unsampled') {
        if (inSpec && inSource) {
          verdict = 'clone';
          note('inferred', name, path);
        } else {
          if (inSpec) note('unverified', name, path);
          verdict = record.native ? 'throw' : 'plain';
          for (let p = record.parent; p; p = classes[p].parent) {
            if (classes[p].result !== 'unsampled') {
              if (classes[p].result === 'throw') verdict = 'throw';
              break;
            }
          }
        }
      } else if (inSpec && verdict !== 'clone') {
        note(verdict === 'throw' ? 'spec-but-throws' : 'spec-but-plain', name, path);
      } else if (verdict === 'clone' && idl.interfaces.has(leaf(path)) && !inSpec) {
        note('clones-beyond-spec', name, path);
      }
      verdicts[name][path] = verdict;
    }
  }

  const having = (path) => names.filter((name) => path in runtimes[name].classes);
  const depth = (name, path) => {
    const { classes } = runtimes[name];
    let n = 0;
    for (let p = classes[path].parent; p; p = classes[p].parent) n++;
    return n;
  };
  const paths = [...new Set(names.flatMap((name) => Object.keys(runtimes[name].classes)))];
  const order = new Map(paths.map((path) => [path, Math.max(...having(path).map((name) => depth(name, path)))]));
  paths.sort((a, b) => order.get(a) - order.get(b) || (a < b ? -1 : 1));

  const entries = {};
  const byDefault = (name, path) => {
    const { classes } = runtimes[name];
    let native = classes[path].native;
    for (let p = classes[path].parent; p; p = classes[p].parent) {
      if (entries[p]) return native ? 'remove' : entries[p];
      native ||= classes[p].native;
    }
    return native ? 'remove' : 'plain';
  };
  for (const path of paths) {
    // core.js rebuilds arrays itself and must not pass them through.
    if (path === 'Array') continue;
    const results = having(path).map((name) => verdicts[name][path]);
    // Anything mixed is removed: wrongly keeping throws, wrongly removing
    // only loses data.
    const wanted = results.every((r) => r === 'clone') ? 'keep' : results.every((r) => r === 'plain') ? 'plain' : 'remove';
    if (wanted === 'remove' && results.includes('clone')) {
      for (const name of having(path)) if (verdicts[name][path] === 'clone') note('dropped-for-others', name, path);
    }
    if (wanted === 'keep' || having(path).some((name) => byDefault(name, path) !== wanted)) entries[path] = wanted;
  }

  const table = { keep: {}, remove: [], plain: [], walks: {} };
  for (const path of Object.keys(entries).sort()) {
    if (entries[path] !== 'keep') {
      table[entries[path]].push(path);
      continue;
    }
    const [first, ...rest] = having(path).map((name) => runtimes[name].classes[path].brands);
    table.keep[path] = first.find((brand) => rest.every((brands) => brands.includes(brand))) ?? '';
    const walks = [...new Set(having(path).flatMap((name) => runtimes[name].classes[path].walks))].sort();
    if (walks.length > 0) table.walks[path] = walks;
  }
  return { table, findings };
}
