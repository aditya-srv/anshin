import assert from 'assert';
import { describe, it } from 'node:test';
import { pickLanIPv4 } from './lan';

describe('pickLanIPv4', () => {
  it('prefers a physical 192.168 address over virtual 192.168 and 10.x', () => {
    const ip = pickLanIPv4([
      { name: 'vEthernet (WSL)', address: '192.168.208.1', internal: false, family: 'IPv4' },
      { name: 'Ethernet', address: '10.0.0.8', internal: false, family: 'IPv4' },
      { name: 'Wi-Fi', address: '192.168.1.20', internal: false, family: 'IPv4' },
    ]);
    assert.strictEqual(ip, '192.168.1.20');
  });

  it('ranks 192.168 ahead of 10 ahead of 172.16', () => {
    const ip = pickLanIPv4([
      { name: 'Ethernet 3', address: '172.16.0.4', internal: false, family: 'IPv4' },
      { name: 'Ethernet 2', address: '10.1.2.3', internal: false, family: 'IPv4' },
      { name: 'Ethernet', address: '192.168.0.5', internal: false, family: 'IPv4' },
    ]);
    assert.strictEqual(ip, '192.168.0.5');
  });

  it('falls back to a virtual adapter when nothing else is private', () => {
    const ip = pickLanIPv4([
      { name: 'vEthernet (Default Switch)', address: '172.22.48.1', internal: false, family: 'IPv4' },
      { name: 'Loopback Pseudo-Interface', address: '127.0.0.1', internal: true, family: 'IPv4' },
    ]);
    assert.strictEqual(ip, '172.22.48.1');
  });

  it('ignores internal and non-IPv4 entries', () => {
    const ip = pickLanIPv4([
      { name: 'Wi-Fi', address: 'fe80::1', internal: false, family: 'IPv6' },
      { name: 'Loopback', address: '127.0.0.1', internal: true, family: 'IPv4' },
    ]);
    assert.strictEqual(ip, null);
  });
});
