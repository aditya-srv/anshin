import * as vscode from 'vscode';
import { buildSidebarHtml } from './html';

/**
 * Bust webview script/style caches when media/protocol changes.
 * Bump MEDIA_REV when shipping fixes under the same package version (e.g. 0.0.12).
 */
const MEDIA_REV = '14a';

function mediaUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  file: string,
  version: string
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).with({
    query: `v=${encodeURIComponent(version)}-${MEDIA_REV}`,
  });
}

/** HTML for the VS Code sidebar webview. */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  version = '0'
): string {
  const nonce = getNonce();
  return buildSidebarHtml({
    assetUrl: (file) => mediaUri(webview, extensionUri, file, version).toString(),
    csp: `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`,
    nonce,
  });
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
