import { strict as assert } from 'node:assert';
import test from 'node:test';
import { classifyInput, splitBatch } from '../src/engine/route.mjs';

test('splitBatch splits on commas, semicolons, and whitespace', () => {
  assert.deepEqual(splitBatch('a, b;c\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitBatch('  '), []);
  assert.deepEqual(splitBatch(null), []);
});

test('classifyInput treats valid addresses and prefixes as single lookups', () => {
  assert.equal(classifyInput('001B21').mode, 'single');
  assert.equal(classifyInput('00:1B:21').mode, 'single');
  assert.equal(classifyInput('00:1B:21:3C:4D:5E').mode, 'single');
  assert.equal(classifyInput('001B213C4D5E').mode, 'single');
  assert.equal(classifyInput('8C1F64AFA').mode, 'single');
  assert.equal(classifyInput('de:ad:be:ef:00:01').mode, 'single');
});

test('classifyInput treats address lists as batch', () => {
  const list = classifyInput('001A2B, 005056');
  assert.equal(list.mode, 'batch');
  assert.deepEqual(list.tokens, ['001A2B', '005056']);
  assert.equal(list.extracted, undefined);
});

test('classifyInput extracts addresses from pasted text', () => {
  const paste = classifyInput('eth0 00:1B:21:3C:4D:5E and 005056AABBCC');
  assert.equal(paste.mode, 'batch');
  assert.deepEqual(paste.tokens, ['001B213C4D5E', '005056AABBCC']);
  assert.equal(paste.extracted, true);

  const collapsed =
    'Interface  eth0  00:1B:21:3C:4D:5Eeth1  DE:AD:BE:EF:00:01link 005056AABBCC';
  assert.deepEqual(classifyInput(collapsed).tokens, [
    '001B213C4D5E',
    'DEADBEEF0001',
    '005056AABBCC',
  ]);
});

test('classifyInput reports MAC-shaped typos', () => {
  assert.deepEqual(classifyInput('00:1G'), { mode: 'invalid', error: 'invalid_chars', value: '00:1G' });
  assert.equal(classifyInput('001A2B3C4D5E6').mode, 'invalid');
  assert.equal(classifyInput('').mode, 'invalid');
  assert.equal(classifyInput('   ').error, 'empty');
});

test('classifyInput falls back to free-text search', () => {
  assert.deepEqual(classifyInput('Apple'), { mode: 'search', value: 'Apple' });
  assert.deepEqual(classifyInput('apple inc'), { mode: 'search', value: 'apple inc' });
  assert.equal(classifyInput('Germany').mode, 'search');
  assert.equal(classifyInput('samsung.com').mode, 'search');
  // All-digit years are valid hex partials, so a lone "2014" is a prefix lookup;
  // year search applies in multi-token queries such as "apple 2014".
  assert.equal(classifyInput('2014').mode, 'single');
  assert.equal(classifyInput('registered 2014').mode, 'search');
});
