//   node scripts/browser.mjs [engine...]
import { readFile } from 'node:fs/promises';
import playwright from 'playwright';
import { observe } from '../generate/observe.mjs';

const engines = process.argv.length > 2 ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
let failed = false;

for (const engine of engines) {
  const browser = await playwright[engine].launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (!pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      const body = await readFile(new URL(`../src${pathname}`, import.meta.url));
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    await page.goto('https://test.invalid/');
    const { count, problems } = await page.evaluate(`(async () => {
      const { toCloneable } = await import('/index.browser.js');
      const samples = [];
      const records = await (${observe.toString()})((path, instance) => samples.push([path, instance]));
      const problems = [];
      for (const [path, instance] of samples) {
        if (path === 'Array' || path === 'Map' || path === 'Set') continue;
        let output;
        try {
          output = toCloneable({ instance });
          structuredClone(output);
        } catch (error) {
          problems.push(path + ': the result does not clone (' + error.message + ')');
          continue;
        }
        if (records[path].result === 'throw' && 'instance' in output) problems.push(path + ': throws, but was kept');
        if (records[path].result === 'plain' && output.instance === instance) problems.push(path + ': degrades, but was passed through');
      }
      return { count: samples.length, problems };
    })()`);
    console.log(`${engine} ${browser.version()}: ${count} instances, ${problems.length} problems`);
    for (const problem of problems) console.log(`  ${problem}`);
    failed ||= problems.length > 0 || count < 100;
  } finally {
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
