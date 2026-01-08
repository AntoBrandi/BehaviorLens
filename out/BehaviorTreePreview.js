"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BehaviorTreePreviewManager = void 0;
const vscode = __importStar(require("vscode"));
class BehaviorTreePreviewManager {
    static getInstance(extensionUri) {
        if (!BehaviorTreePreviewManager._instance) {
            BehaviorTreePreviewManager._instance = new BehaviorTreePreviewManager(extensionUri);
        }
        return BehaviorTreePreviewManager._instance;
    }
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._previews = new Map();
        // Update all active previews when the document changes
        vscode.workspace.onDidChangeTextDocument(e => {
            const preview = this._previews.get(e.document.uri.toString());
            if (preview && preview.visible) {
                this.updateWebview(preview, e.document);
            }
        });
    }
    async showPreview(uri, side) {
        const document = await vscode.workspace.openTextDocument(uri);
        const column = side ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
        // If we already have a panel, show it
        if (this._previews.has(uri.toString())) {
            const panel = this._previews.get(uri.toString());
            panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(BehaviorTreePreviewManager.viewType, `Preview: ${uri.fsPath.replace(/^.*[\\\/]/, '')}`, column, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        });
        this._previews.set(uri.toString(), panel);
        panel.onDidDispose(() => {
            this._previews.delete(uri.toString());
        });
        panel.webview.html = this.getHtmlForWebview(panel.webview);
        // Initial update
        this.updateWebview(panel, document);
    }
    updateWebview(panel, document) {
        panel.webview.postMessage({
            type: 'update',
            text: document.getText(),
        });
    }
    getHtmlForWebview(webview) {
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
exports.BehaviorTreePreviewManager = BehaviorTreePreviewManager;
BehaviorTreePreviewManager.viewType = 'behaviortree.preview';
//# sourceMappingURL=BehaviorTreePreview.js.map