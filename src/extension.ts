import * as vscode from 'vscode';
import { UnoViewProvider } from './unoViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new UnoViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(UnoViewProvider.viewType, provider),
    provider
  );
}

export function deactivate(): void {}
