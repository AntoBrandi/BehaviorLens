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
        })
    );
}
