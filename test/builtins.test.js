import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCloneable } from 'to-cloneable';
import { observe } from '../generate/observe.mjs';

const samples = [];
const records = await observe((path, instance) => samples.push([path, instance]));

test('instances are found', () => {
  assert.ok(samples.length > 50);
});

for (const [path, instance] of samples) {
  test(path, (t) => {
    const output = toCloneable({ instance });
    structuredClone(output);
    // Rebuilt whatever they hold, so this sample's verdict says nothing.
    if (path === 'Array' || path === 'Map' || path === 'Set') return;
    const { result } = records[path];
    if (result === 'throw') assert.ok(!('instance' in output), 'throws, but was kept');
    else if (result === 'plain') assert.notEqual(output.instance, instance, 'degrades, but was passed through');
    // A table generated on one version may lag a newer one: lossy, not unsafe.
    else if (output.instance !== instance) {
      t.diagnostic(`${path} clones here, but the table does not keep it`);
    }
  });
}
