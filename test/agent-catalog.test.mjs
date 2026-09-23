import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('ARD well-known catalogs are valid empty manifests', async () => {
  for (const name of ['ai-catalog.json', 'ard.json']) {
    const file = path.join(root, 'public', '.well-known', name);
    const catalog = JSON.parse(await readFile(file, 'utf8'));

    assert.equal(catalog.specVersion, '1.0', `${name} uses ARD catalog version 1.0`);
    assert.equal(catalog.host.displayName, 'MAC Address Lookup');
    assert.equal(catalog.host.documentationUrl, 'https://mac.jasontally.com/help');
    assert.deepEqual(catalog.entries, [], `${name} advertises no agent-callable resources`);
  }
});
