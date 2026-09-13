import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FAQ, renderFaqList, renderFaqSchema } from '../build/faq.mjs';import { buildHomePage } from '../build/generate-home.mjs';

test('renderFaqList renders every question as a disclosure', () => {
  const html = renderFaqList();
  assert.equal((html.match(/<details class="disclosure">/g) ?? []).length, FAQ.length);
  for (const { question } of FAQ) {
    assert.ok(html.includes(question), `missing question: ${question}`);
  }
  assert.ok(!html.includes('<script>'));
});

test('renderFaqSchema is a valid FAQPage matching the visible questions', () => {
  const schema = JSON.parse(renderFaqSchema());
  assert.equal(schema['@type'], 'FAQPage');
  assert.equal(schema.mainEntity.length, FAQ.length);
  assert.deepEqual(
    schema.mainEntity.map((entity) => entity.name),
    FAQ.map((item) => item.question),
  );
  for (const entity of schema.mainEntity) {
    assert.equal(entity.acceptedAnswer['@type'], 'Answer');
    assert.ok(entity.acceptedAnswer.text.length > 40);
  }
});

test('buildHomePage replaces the placeholders in the template', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-'));
  const distDir = path.join(root, 'dist');
  await mkdir(path.join(root, 'public'), { recursive: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(root, 'public', 'index.html'),
    '<html><body><div>{{FAQ_LIST}}</div><script type="application/ld+json">{{FAQ_SCHEMA}}</script></body></html>',
  );

  await buildHomePage({ root, distDir });
  const html = await readFile(path.join(distDir, 'index.html'), 'utf8');

  assert.ok(!html.includes('{{FAQ_LIST}}'));
  assert.ok(!html.includes('{{FAQ_SCHEMA}}'));
  assert.ok(html.includes('Why does my MAC address show no vendor?'));

  const jsonMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  const schema = JSON.parse(jsonMatch[1]);
  assert.equal(schema['@type'], 'FAQPage');
});

test('buildHomePage rejects templates without placeholders', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-'));
  await mkdir(path.join(root, 'public'), { recursive: true });
  await writeFile(path.join(root, 'public', 'index.html'), '<html></html>');
  await assert.rejects(() => buildHomePage({ root, distDir: root }), /missing FAQ placeholders/);
});
