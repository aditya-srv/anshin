import * as vscode from 'vscode';
import { AnshinController } from './sidebar/controller';
import { IncomingMessage } from './sidebar/types';
import { buildWebviewHtml } from './sidebar/webviewHtml';

export type { GuiMode } from './sidebar/types';

export class AnshinViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'anshin.unoView';

  private view?: vscode.WebviewView;
  private webviewDisposables: vscode.Disposable[] = [];
  private readonly controller: AnshinController;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.controller = new AnshinController({
      send: (message) => {
        void this.view?.webview.postMessage(message);
      },
      version: readExtensionVersion(),
      getDefaultServerUrl: () =>
        vscode.workspace.getConfiguration('anshin').get<string>('serverUrl')?.trim() ?? '',
      copyText: async (text) => {
        await vscode.env.clipboard.writeText(text);
      },
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.clearWebviewListeners();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    this.webviewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
        void this.controller.handle(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.controller.refresh();
        }
      })
    );

    webviewView.webview.html = buildWebviewHtml(
      webviewView.webview,
      this.extensionUri,
      readExtensionVersion()
    );
    this.controller.refresh();
  }

  public shutdown(): Promise<void> {
    return this.controller.shutdown();
  }

  public dispose(): void {
    this.clearWebviewListeners();
    void this.controller.shutdown();
  }

  private clearWebviewListeners(): void {
    for (const item of this.webviewDisposables) {
      item.dispose();
    }
    this.webviewDisposables = [];
  }
}

function readExtensionVersion(): string {
  try {
    // Compiled as out/anshinViewProvider.js → ../package.json is the extension root.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return String(pkg.version ?? 'dev');
  } catch {
    return String(Date.now());
  }
}
