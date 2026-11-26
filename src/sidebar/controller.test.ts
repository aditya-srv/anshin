import assert from 'assert';
import { describe, it } from 'node:test';
import { AnshinController } from './controller';
import { WebviewUiState } from './types';

interface Sent {
  type: string;
  state: WebviewUiState;
}

function controllerWithSink(): { controller: AnshinController; sent: Sent[] } {
  const sent: Sent[] = [];
  const controller = new AnshinController({
    send: (message) => sent.push(message as Sent),
    version: 'test',
    getDefaultServerUrl: () => '',
    copyText: async () => undefined,
  });
  return { controller, sent };
}

describe('AnshinController', () => {
  it('shows the menu on ready', async () => {
    const { controller, sent } = controllerWithSink();
    await controller.handle({ type: 'ready' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'ui');
    assert.strictEqual(sent[0].state.screen, 'menu');
    await controller.shutdown();
  });

  it('asks for a display name before hosting or joining', async () => {
    const { controller, sent } = controllerWithSink();
    await controller.handle({ type: 'join', name: '   ', url: 'ws://127.0.0.1:3847/?t=abc' });
    assert.strictEqual(sent[sent.length - 1].state.status, 'Enter a display name.');
    await controller.shutdown();
  });

  it('validates join URLs before connecting', async () => {
    const { controller, sent } = controllerWithSink();
    await controller.handle({ type: 'join', name: 'Ana', url: 'http://not-a-socket' });
    const last = sent[sent.length - 1].state;
    assert.match(last.status, /URL must be ws:\/\/ or wss:\/\//);
    assert.strictEqual(last.screen, 'menu');
    await controller.shutdown();
  });
});
