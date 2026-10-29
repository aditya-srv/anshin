import * as vscode from 'vscode';
import { UnoViewProvider } from './unoViewProvider';

let provider: UnoViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  provider = new UnoViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(UnoViewProvider.viewType, provider),
    provider
  );
}

export function deactivate(): Thenable<void> {
  return provider?.shutdown() ?? Promise.resolve();
}
