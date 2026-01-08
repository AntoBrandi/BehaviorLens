import * as vscode from 'vscode';

export class BehaviorTreePreviewManager {
    public static readonly viewType = 'behaviortree.preview';
    private static _instance: BehaviorTreePreviewManager;

    private readonly _previews = new Map<string, vscode.WebviewPanel>();

    public static getInstance(extensionUri: vscode.Uri): BehaviorTreePreviewManager {
        if (!BehaviorTreePreviewManager._instance) {
            BehaviorTreePreviewManager._instance = new BehaviorTreePreviewManager(extensionUri);
        }
        return BehaviorTreePreviewManager._instance;
    }

    private constructor(
        private readonly _extensionUri: vscode.Uri
    ) {
        // Update all active previews when the document changes
        vscode.workspace.onDidChangeTextDocument(e => {
            const preview = this._previews.get(e.document.uri.toString());
            if (preview && preview.visible) {
                this.updateWebview(preview, e.document);
            }
        });
    }

    public async showPreview(uri: vscode.Uri, side: boolean) {
        const document = await vscode.workspace.openTextDocument(uri);
        const column = side ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (this._previews.has(uri.toString())) {
            const panel = this._previews.get(uri.toString())!;
            panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            BehaviorTreePreviewManager.viewType,
            `Preview: ${uri.fsPath.replace(/^.*[\\\/]/, '')}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
            }
        );

        this._previews.set(uri.toString(), panel);

        panel.onDidDispose(() => {
            this._previews.delete(uri.toString());
        });

        panel.webview.html = this.getHtmlForWebview(panel.webview);

        // Initial update
        this.updateWebview(panel, document);
    }

    private updateWebview(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
        panel.webview.postMessage({
            type: 'update',
            text: document.getText(),
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Convert on-disk resource paths to webview resource paths
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const scriptD3Uri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'd3.min.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleMainUri}" rel="stylesheet" />
                <script src="${scriptD3Uri}"></script>
                <title>Behavior Lens</title>
            </head>
            <body>
                <div id="toolbar">
                    <button class="icon-btn" id="btn-layout">Layout: Vertical</button>
                    <button class="icon-btn" id="btn-fit">Fit View</button>
                </div>
                <div id="tree-container"></div>
                <div id="minimap"></div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
