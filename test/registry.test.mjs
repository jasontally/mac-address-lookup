import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRegistry } from '../src/engine/registry.mjs';
import { lookup } from '../src/engine/lookup.mjs';

const rows = [
  {
    prefix: '001A2B',
    prefix_len: 24,
    block_type: 'MA-L',
    address_count: 16_777_216,
    org_name: 'Vendor A',
    org_address: '1 A St US 10001',
    country: 'US',
    is_private: false,
  },
  {
    prefix: '001A2B0',
    prefix_len: 28,
    block_type: 'MA-M',
    address_count: 1_048_576,
    org_name: 'Vendor B',
    org_address: '2 B St DE 10115',
    country: 'DE',
    is_private: false,
  },
  {
    prefix: '001A2B0C1',
    prefix_len: 36,
    block_type: 'MA-S',
    address_count: 4_096,
    org_name: 'Vendor C',
    org_address: '3 C St JP 100-0001',
    country: 'JP',
    is_private: false,
  },
  {
    prefix: '005056',
    prefix_len: 24,
    block_type: 'MA-L',
    address_count: 16_777_216,
    org_name: 'VMware, Inc.',
    org_address: '3401 Hillview Ave Palo Alto CA US 94304',
    country: 'US',
    is_private: false,
  },
  {
    prefix: '741AE09',
    prefix_len: 28,
    block_type: 'MA-M',
    address_count: 1_048_576,
    org_name: 'Private',
    org_address: '',
    country: null,
    is_private: true,
  },
];

test('createRegistry indexes all supported prefix lengths', () => {
  assert.equal(createRegistry(rows).size, 5);
});

test('resolve prefers the longest registered prefix', () => {
  const registry = createRegistry(rows);

  const exactOui = registry.resolve('001A2B');
  assert.equal(exactOui.record.orgName, 'Vendor A');
  assert.equal(exactOui.matchedLength, 6);
  assert.equal(exactOui.exact, true);

  const exactMam = registry.resolve('001A2B0');
  assert.equal(exactMam.record.orgName, 'Vendor B');
  assert.equal(exactMam.matchedLength, 7);
  assert.equal(exactMam.exact, true);

  const exactMas = registry.resolve('001A2B0C1');
  assert.equal(exactMas.record.orgName, 'Vendor C');
  assert.equal(exactMas.matchedLength, 9);
  assert.equal(exactMas.exact, true);

  const fullMac = registry.resolve('001A2B0C1FFF');
  assert.equal(fullMac.record.orgName, 'Vendor C');
  assert.equal(fullMac.matchedLength, 9);
  assert.equal(fullMac.exact, false);
});

test('resolve falls back through prefix lengths', () => {
  const registry = createRegistry(rows);

  const mamFallback = registry.resolve('001A2B0FF');
  assert.equal(mamFallback.record.orgName, 'Vendor B');
  assert.equal(mamFallback.matchedLength, 7);
  assert.equal(mamFallback.exact, false);

  const ouiFallback = registry.resolve('001A2BE');
  assert.equal(ouiFallback.record.orgName, 'Vendor A');
  assert.equal(ouiFallback.matchedLength, 6);
  assert.equal(ouiFallback.exact, false);

  assert.equal(registry.resolve('0F0F0F'), null);
});

test('listPartials matches ranges, caps rows, and counts the total', () => {
  const registry = createRegistry(rows);

  const all = registry.listPartials('00');
  assert.equal(all.total, 4);
  assert.equal(all.matches.length, 4);
  assert.equal(all.truncated, false);
  assert.deepEqual(
    all.matches.map((record) => record.prefix),
    ['001A2B', '001A2B0', '001A2B0C1', '005056'],
  );

  const capped = registry.listPartials('00', 2);
  assert.equal(capped.total, 4);
  assert.equal(capped.matches.length, 2);
  assert.equal(capped.truncated, true);
  assert.deepEqual(
    capped.matches.map((record) => record.prefix),
    ['001A2B', '001A2B0'],
  );
});

test('lookup returns a full result for registered addresses', () => {
  const registry = createRegistry(rows);
  const result = lookup(registry, '00:1A:2B:0C:1F:FF');

  assert.equal(result.kind, 'match');
  assert.equal(result.match.orgName, 'Vendor C');
  assert.equal(result.match.matchedLength, 9);
  assert.equal(result.match.exact, false);
  assert.equal(result.bits.multicast, false);
  assert.equal(result.bits.locallyAdministered, false);
  assert.equal(result.randomization.likely, false);
  assert.equal(result.formats.colon, '00:1A:2B:0C:1F:FF');
  assert.equal(result.hypervisor, null);
});

test('lookup classifies invalid, partial, and unknown inputs', () => {
  const registry = createRegistry(rows);

  const invalid = lookup(registry, 'nope');
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.error, 'invalid_chars');

  const partial = lookup(registry, '00:1A');
  assert.equal(partial.kind, 'partial');
  assert.equal(partial.total, 3);
  assert.equal(partial.matches.length, 3);

  const unknown = lookup(registry, '041A2B');
  assert.equal(unknown.kind, 'none');
  assert.equal(unknown.randomization.likely, false);

  const randomized = lookup(registry, '021A2B');
  assert.equal(randomized.kind, 'none');
  assert.equal(randomized.randomization.likely, true);
});

test('lookup flags hypervisor prefixes without flagging randomization', () => {
  const registry = createRegistry(rows);
  const vmware = lookup(registry, '005056123456');

  assert.equal(vmware.kind, 'match');
  assert.equal(vmware.match.orgName, 'VMware, Inc.');
  assert.equal(vmware.hypervisor.name, 'VMware');
  assert.equal(vmware.randomization.likely, false);

  const docker = lookup(registry, '0242AC110002');
  assert.equal(docker.kind, 'none');
  assert.equal(docker.hypervisor.name, 'Docker container');
  assert.equal(docker.randomization.likely, false);
});
