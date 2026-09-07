import * as vscode from 'vscode';
import { BehaviorTreePreviewManager } from './BehaviorTreePreview';

export function activate(context: vscode.ExtensionContext) {
    console.log('BehaviorTree Preview extension is now active');

    const manager = BehaviorTreePreviewManager.getInstance(context.extensionUri);

    context.subscriptions.push(
        vscode.commands.registerCommand('behaviortree.preview', () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                manager.showPreview(activeEditor.document.uri, false);
            }
        }),
        vscode.commands.registerCommand('behaviortree.previewSide', () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                manager.showPreview(activeEditor.document.uri, true);
            }
        }),
        // Bring previews back after a window reload. The document URI is read
        // from the state the webview persisted with setState().
        vscode.window.registerWebviewPanelSerializer(BehaviorTreePreviewManager.viewType, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
                const uriStr: string | undefined = state?.uri;
                if (!uriStr) {
                    // Nothing to re-attach to; a preview without a document is useless.
                    panel.dispose();
                    return;
                }
                try {
                    await manager.restorePanel(panel, vscode.Uri.parse(uriStr));
                } catch (e: any) {
                    // The file was moved or deleted while the window was closed.
                    vscode.window.showWarningMessage(
                        `Could not restore Behavior Lens preview for ${uriStr}: ${e.message}`
                    );
                    panel.dispose();
                }
            }
        })
    );
}
