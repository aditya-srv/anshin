import assert from 'assert';
import { describe, it } from 'node:test';
import {
  appendRoomToken,
  extractRoomTokenFromUrl,
  generateRoomToken,
  isValidBindHost,
  isValidJoinUrl,
  isValidPublicHost,
  tokensEqual,
} from './urlAuth';

describe('urlAuth', () => {
  it('generates a 32-char hex token', () => {
    const token = generateRoomToken();
    assert.match(token, /^[a-f0-9]{32}$/);
    assert.notStrictEqual(generateRoomToken(), token);
  });

  it('appends ?t= to a bare join URL', () => {
    const url = appendRoomToken('ws://192.168.1.10:3847', 'abc123');
    assert.strictEqual(extractRoomTokenFromUrl(url), 'abc123');
    assert.ok(url.startsWith('ws://192.168.1.10:3847'));
  });

  it('replaces an existing t= query param', () => {
    const url = appendRoomToken('ws://10.0.0.2:3847/?t=old&x=1', 'newtok');
    assert.strictEqual(extractRoomTokenFromUrl(url), 'newtok');
  });

  it('extracts token from an upgrade path', () => {
    assert.strictEqual(extractRoomTokenFromUrl('/?t=secret'), 'secret');
    assert.strictEqual(extractRoomTokenFromUrl('/'), null);
  });

  it('compares tokens safely', () => {
    assert.strictEqual(tokensEqual('same', 'same'), true);
    assert.strictEqual(tokensEqual('same', 'diff'), false);
    assert.strictEqual(tokensEqual('same', null), false);
  });

  it('validates PUBLIC_HOST', () => {
    assert.strictEqual(isValidPublicHost('203.0.113.10'), true);
    assert.strictEqual(isValidPublicHost('uno.example.com'), true);
    assert.strictEqual(isValidPublicHost('ws://evil'), false);
    assert.strictEqual(isValidPublicHost('host/path'), false);
    assert.strictEqual(isValidPublicHost('has space'), false);
    assert.strictEqual(isValidPublicHost('256.1.1.1'), false);
  });

  it('validates BIND_HOST', () => {
    assert.strictEqual(isValidBindHost('0.0.0.0'), true);
    assert.strictEqual(isValidBindHost('127.0.0.1'), true);
    assert.strictEqual(isValidBindHost('localhost'), true);
    assert.strictEqual(isValidBindHost('::'), true);
    assert.strictEqual(isValidBindHost('bad host'), false);
  });

  it('validates join URLs', () => {
    assert.strictEqual(isValidJoinUrl('ws://192.168.0.5:3847/?t=abc'), true);
    assert.strictEqual(isValidJoinUrl('wss://example.com/room?t=x'), true);
    assert.strictEqual(isValidJoinUrl('ws://'), false);
    assert.strictEqual(isValidJoinUrl('http://example.com'), false);
  });
});
