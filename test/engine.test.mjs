import { strict as assert } from 'node:assert';
import test from 'node:test';
import { analyzeBits, normalizeInput } from '../src/engine/input.mjs';
import { formatAddress } from '../src/engine/formats.mjs';
import { classifyRandomization, detectHypervisor } from '../src/engine/vendors.mjs';

test('normalizeInput accepts every separator style', () => {
  assert.deepEqual(normalizeInput('00:1a:2b:3c:4d:5e'), {
    ok: true,
    hex: '001A2B3C4D5E',
    length: 12,
  });
  assert.deepEqual(normalizeInput('00-1A-2B'), { ok: true, hex: '001A2B', length: 6 });
  assert.deepEqual(normalizeInput('001A.2B3C.4D5E'), {
    ok: true,
    hex: '001A2B3C4D5E',
    length: 12,
  });
  assert.deepEqual(normalizeInput(' 001A 2B '), { ok: true, hex: '001A2B', length: 6 });
  assert.deepEqual(normalizeInput('001a2'), { ok: true, hex: '001A2', length: 5 });
});

test('normalizeInput reports errors', () => {
  assert.deepEqual(normalizeInput(''), { ok: false, error: 'empty' });
  assert.deepEqual(normalizeInput('   '), { ok: false, error: 'empty' });
  assert.deepEqual(normalizeInput(null), { ok: false, error: 'empty' });
  assert.deepEqual(normalizeInput('00:1G'), { ok: false, error: 'invalid_chars' });
  assert.deepEqual(normalizeInput('001A2B3C4D5E6'), { ok: false, error: 'too_long' });
});

test('analyzeBits decodes I/G and U/L bits and special addresses', () => {
  const universal = analyzeBits('001A2B');
  assert.equal(universal.multicast, false);
  assert.equal(universal.locallyAdministered, false);

  const multicast = analyzeBits('011A2B');
  assert.equal(multicast.multicast, true);
  assert.equal(multicast.locallyAdministered, false);

  const local = analyzeBits('021A2B');
  assert.equal(local.multicast, false);
  assert.equal(local.locallyAdministered, true);

  assert.equal(analyzeBits('FFFFFFFFFFFF').broadcast, true);
  assert.equal(analyzeBits('000000000000').allZeros, true);
  assert.equal(analyzeBits('FFFFFFFFFFFF').allZeros, false);
  assert.equal(analyzeBits('F'), null);
});

test('formatAddress converts to all common notations', () => {
  const formats = formatAddress('001A2B3C4D5E');
  assert.equal(formats.plain, '001A2B3C4D5E');
  assert.equal(formats.colon, '00:1A:2B:3C:4D:5E');
  assert.equal(formats.hyphen, '00-1A-2B-3C-4D-5E');
  assert.equal(formats.cisco, '001A.2B3C.4D5E');
  assert.equal(formats.eui64, '02-1A-2B-FF-FE-3C-4D-5E');
  assert.equal(formats.ipv6LinkLocal, 'fe80::21a:2bff:fe3c:4d5e');

  const oui = formatAddress('001A2B');
  assert.equal(oui.colon, '00:1A:2B');
  assert.equal(oui.cisco, '001A.2B');
  assert.equal(oui.eui64, undefined);
  assert.equal(oui.ipv6LinkLocal, undefined);
});

test('detectHypervisor recognizes VM prefixes, longest match first', () => {
  assert.equal(detectHypervisor('005056AABBCC').name, 'VMware');
  assert.equal(detectHypervisor('000C29AABBCC').name, 'VMware');
  assert.equal(detectHypervisor('080027AABBCC').name, 'VirtualBox');
  assert.equal(detectHypervisor('0A0027AABBCC').name, 'VirtualBox (host-only)');
  assert.equal(detectHypervisor('00155DAABBCC').name, 'Microsoft Hyper-V');
  assert.equal(detectHypervisor('001C42AABBCC').name, 'Parallels');
  assert.equal(detectHypervisor('00163EAABBCC').name, 'Xen');
  assert.equal(detectHypervisor('525400AABBCC').name, 'QEMU/KVM');
  assert.equal(detectHypervisor('0242AC110002').name, 'Docker container');
  assert.equal(detectHypervisor('0242').name, 'Docker container');
  assert.equal(detectHypervisor('001A2B'), null);
});

test('classifyRandomization flags locally administered addresses', () => {
  const unregisteredLocal = classifyRandomization({
    bits: analyzeBits('02ABCD'),
    match: null,
    hypervisor: null,
  });
  assert.equal(unregisteredLocal.likely, true);
  assert.equal(unregisteredLocal.confidence, 'high');

  const unregisteredUniversal = classifyRandomization({
    bits: analyzeBits('04ABCD'),
    match: null,
    hypervisor: null,
  });
  assert.equal(unregisteredUniversal.likely, false);

  const registered = classifyRandomization({
    bits: analyzeBits('001A2B'),
    match: { isPrivate: false },
    hypervisor: null,
  });
  assert.equal(registered.likely, false);
  assert.deepEqual(registered.reasons, []);

  const privateBlock = classifyRandomization({
    bits: analyzeBits('021A2B'),
    match: { isPrivate: true },
    hypervisor: null,
  });
  assert.equal(privateBlock.likely, true);
  assert.equal(privateBlock.confidence, 'medium');

  const docker = classifyRandomization({
    bits: analyzeBits('0242AC110002'),
    match: null,
    hypervisor: detectHypervisor('0242AC110002'),
  });
  assert.equal(docker.likely, false);
  assert.match(docker.reasons[0], /Docker/);

  const broadcast = classifyRandomization({
    bits: analyzeBits('FFFFFFFFFFFF'),
    match: null,
    hypervisor: null,
  });
  assert.equal(broadcast.likely, false);
  assert.match(broadcast.reasons[0], /Broadcast/);
});
