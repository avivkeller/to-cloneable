import { bun } from './bun.mjs';
import { chromium } from './chromium.mjs';
import { firefox } from './firefox.mjs';
import { webkit } from './webkit.mjs';

// Node and Deno keep no single list: each class is marked where it is defined.
export const engineSource = { bun, chromium, firefox, webkit };
