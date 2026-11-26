import playwright from 'playwright';
import { observe } from './observe.mjs';

export async function observeBrowser(engine) {
  const browser = await playwright[engine].launch();
  try {
    const page = await browser.newPage();
    const source = observe.toString();
    // An intercepted HTTPS origin is a secure, cross-origin-isolated context;
    // about:blank would hide secure-context interfaces and SharedArrayBuffer.
    // WebKit will not start a blob: worker here, hence /worker.js.
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
    await page.route('**/*', (route) =>
      route.request().url().endsWith('/worker.js')
        ? route.fulfill({ contentType: 'text/javascript', headers, body: `(${source})().then((result) => postMessage(result))` })
        : route.fulfill({ contentType: 'text/html', headers, body: '<!doctype html>' }),
    );
    await page.goto('https://observe.invalid/');
    const classes = await page.evaluate(`(${source})()`);
    const inWorker = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker('/worker.js');
          worker.onmessage = (event) => resolve(event.data);
          // Sampled instances throw asynchronously; that is not a failure.
          worker.onerror = (event) => event.preventDefault();
          setTimeout(() => reject(new Error('The worker did not report back.')), 60_000);
        }),
    );
    for (const [path, record] of Object.entries(inWorker)) {
      if (!(path in classes)) {
        classes[path] = record;
      } else if (classes[path].result === 'unsampled' && record.result !== 'unsampled') {
        classes[path] = { ...record, parent: classes[path].parent };
      }
    }
    for (const record of Object.values(classes)) if (!(record.parent in classes)) record.parent = null;
    return { version: browser.version(), classes };
  } finally {
    await browser.close();
  }
}
