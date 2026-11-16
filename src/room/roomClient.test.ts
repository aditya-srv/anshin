import assert from 'assert';
import { describe, it } from 'node:test';
import { describeSocketClose } from './roomClient';

describe('describeSocketClose', () => {
  it('prefers the server reason', () => {
    assert.strictEqual(describeSocketClose(4001, Buffer.from('Unauthorized')), 'Unauthorized');
    assert.strictEqual(describeSocketClose(1006, '  proxy closed  '), 'proxy closed');
  });

  it('maps room close codes when the reason is empty', () => {
    assert.strictEqual(describeSocketClose(4001, Buffer.alloc(0)), 'Unauthorized');
    assert.strictEqual(describeSocketClose(4002, ''), 'Room at capacity');
    assert.strictEqual(describeSocketClose(4003, ''), 'Join timed out');
    assert.strictEqual(describeSocketClose(4004, ''), 'Too many messages.');
    assert.strictEqual(describeSocketClose(1006, ''), 'Connection closed.');
  });
});
