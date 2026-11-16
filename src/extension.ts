import * as vscode from 'vscode';
import { AnshinViewProvider } from './anshinViewProvider';

let provider: AnshinViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  provider = new AnshinViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AnshinViewProvider.viewType, provider),
    provider
  );
}

export function deactivate(): Thenable<void> {
  return provider?.shutdown() ?? Promise.resolve();
}
