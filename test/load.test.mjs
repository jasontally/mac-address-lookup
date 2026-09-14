import { strict as assert } from 'node:assert';
import test from 'node:test';
import { checkSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../src/engine/load.mjs';

test('checkSchemaVersion accepts supported and legacy manifests', () => {
  assert.equal(checkSchemaVersion({ schemaVersion: 1 }), 1);
  assert.equal(checkSchemaVersion({ schemaVersion: 0 }), 0);
  assert.equal(checkSchemaVersion({}), 1);
  assert.equal(checkSchemaVersion(null), 1);
});

test('checkSchemaVersion rejects newer schemas with a user-facing message', () => {
  try {
    checkSchemaVersion({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 });
    assert.fail('expected checkSchemaVersion to throw');
  } catch (error) {
    assert.match(error.message, /newer than this app supports/);
    assert.match(error.userMessage, /Reload to update/);
  }
});
