import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildHelpPage } from '../build/build-help.mjs';
import { FAQ, renderFaqList, renderFaqSchema } from '../build/faq.mjs';

test('buildHelpPage replaces tokens and produces valid FAQ schema', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'help-'));
  await writeFile(path.join(distDir, 'help.html'), template());

  await buildHelpPage({ distDir });
  const html = await readFile(path.join(distDir, 'help.html'), 'utf8');

  assert.ok(!html.includes('{{FAQ_LIST}}'));
  assert.ok(!html.includes('{{FAQ_SCHEMA}}'));
  assert.ok(html.includes('Why does my MAC address show no vendor?'));

  const schemaMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(schemaMatch, 'FAQ schema is present');
  const schema = JSON.parse(schemaMatch[1]);
  assert.equal(schema['@type'], 'FAQPage');
  assert.equal(schema.mainEntity.length, FAQ.length);
});

test('buildHelpPage rejects templates without placeholders', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'help-'));
  await writeFile(path.join(distDir, 'help.html'), '<html></html>');
  await assert.rejects(
    () => buildHelpPage({ distDir }),
    /missing the \{\{FAQ_LIST\}\} placeholder/,
  );
});

function template() {
  return '<html><body><div>{{FAQ_LIST}}</div><script type="application/ld+json">{{FAQ_SCHEMA}}</script></body></html>';
}
