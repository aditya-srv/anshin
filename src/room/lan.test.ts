import assert from 'assert';
import { describe, it } from 'node:test';
import { listLanIPv4, parseDefaultRouteIPv4, pickLanIPv4 } from './lan';

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

  it('accepts a numeric IPv4 family', () => {
    const ip = pickLanIPv4([{ name: 'Wi-Fi', address: '10.0.0.8', internal: false, family: 4 }]);
    assert.strictEqual(ip, '10.0.0.8');
  });

  it('prefers the default-route address over a higher-ranked adapter', () => {
    const interfaces = [
      { name: 'Ethernet', address: '192.168.0.5', internal: false, family: 'IPv4' as const },
      { name: 'Wi-Fi', address: '10.0.0.8', internal: false, family: 4 },
    ];
    assert.strictEqual(pickLanIPv4(interfaces, '10.0.0.8'), '10.0.0.8');
    assert.deepStrictEqual(listLanIPv4(interfaces, '10.0.0.8'), ['10.0.0.8', '192.168.0.5']);
  });

  it('parses the lowest-metric default route', () => {
    const text = `
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     50
          0.0.0.0          0.0.0.0         10.0.0.1       10.0.0.8     25
`;
    assert.strictEqual(parseDefaultRouteIPv4(text), '10.0.0.8');
  });

  it('ignores internal and non-IPv4 entries', () => {
    const ip = pickLanIPv4([
      { name: 'Wi-Fi', address: 'fe80::1', internal: false, family: 'IPv6' },
      { name: 'Loopback', address: '127.0.0.1', internal: true, family: 'IPv4' },
    ]);
    assert.strictEqual(ip, null);
  });
});
