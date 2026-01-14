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
        panel.onDidChangeViewState(() => {
            if (panel.visible) {
                this.updateWebview(panel, document);
            }
        });
        panel.webview.html = this.getHtmlForWebview(panel.webview);
        panel.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'editAttribute':
                    // We need a fresh doc reference? 'document' from showPreview scope might be stale if replaced?
                    // Actually vscode.TextDocument objects can become closed, but reusing the one from openTextDocument is usually okay 
                    // provided the URI is the same. Ideally we re-fetch open document or use the event.
                    // For simplicity, find doc by uri.
                    vscode.workspace.openTextDocument(uri).then(doc => {
                        this.handleAttributeEdit(doc, message.nodeId, message.occurrenceIndex, message.attr, message.value);
                    });
                    break;
            }
        });
        // Initial update
        this.updateWebview(panel, document);
    }
    updateWebview(panel, document) {
        panel.webview.postMessage({
            type: 'update',
            text: document.getText(),
        });
        // Ensure we only register the listener once per panel or handle it appropriately
        // Actually, updateWebview is called on document change, so we shouldn't register listeners here repeatedly.
        // It's better to register in `showPreview` or constructor.
        // BUT, `updateWebview` is convenient because we have the `document` ref.
        // Let's modify `showPreview` to register the listener, and pass the document retrieval logic.
    }
    handleAttributeEdit(document, nodeId, occurrenceIndex, attr, value) {
        const text = document.getText();
        // 1. Find the node by ID or Name.
        // ID should be inside the tag attributes.
        // We match either ID="nodeId" OR name="nodeId".
        // Regex: <TagName ... (ID="id" | name="id") ... >
        const idPattern = new RegExp(`<\\w+[^>]*\\b(ID|name)="${nodeId}"[^>]*>`, 'g');
        let match;
        let count = 0;
        let targetMatch = null;
        while ((match = idPattern.exec(text)) !== null) {
            if (count === occurrenceIndex) {
                targetMatch = match;
                break;
            }
            count++;
        }
        if (!targetMatch) {
            console.error(`Node ${nodeId} at index ${occurrenceIndex} not found`);
            return;
        }
        const tagContent = targetMatch[0];
        const tagStartOffset = targetMatch.index;
        // 2. Find attribute within the tag
        // Use word boundary to ensure we don't match substrings (e.g. 'attr' inside 'my_attr')
        const attrPattern = new RegExp(`\\b${attr}="([^"]*)"`);
        const attrMatch = attrPattern.exec(tagContent);
        if (attrMatch) {
            // Found existing attribute
            // attrMatch[0] is `attr="val"` (with possible leading boundary match, but \b is zero-width)
            // But wait, if \b matches start of string or space, it's fine.
            const valStartLocal = attrMatch.index + attrMatch[0].indexOf('"') + 1;
            const valLength = attrMatch[1].length;
            const absOffset = tagStartOffset + valStartLocal;
            const startPos = document.positionAt(absOffset);
            const endPos = document.positionAt(absOffset + valLength);
            const range = new vscode.Range(startPos, endPos);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, range, value);
            vscode.workspace.applyEdit(edit).then(success => {
                if (success)
                    document.save();
            });
        }
        else {
            // Attribute missing, need to insert.
            // Insert before the closing `>` or `/>`
            // tagContent ends with `>` or `/>`
            // We want to insert ` attr="value"` before that.
            // Simplest way: Find last `>` or `/>` in tagContent.
            // But tagContent might have `>` in attributes? (Wait, XML attributes can't have `>` unless escaped &gt;)
            // Regex for tag matched `[^>]*>`. So it ends at the first `>`.
            // So simpler: replace `/>` with ` attr="value"/>` or `>` with ` attr="value">`
            let insertPosLocal = -1;
            let insertText = ` ${attr}="${value}"`;
            if (tagContent.endsWith('/>')) {
                insertPosLocal = tagContent.length - 2;
            }
            else if (tagContent.endsWith('>')) {
                insertPosLocal = tagContent.length - 1;
            }
            if (insertPosLocal !== -1) {
                const absOffset = tagStartOffset + insertPosLocal;
                const pos = document.positionAt(absOffset);
                const range = new vscode.Range(pos, pos); // Empty range for insertion
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, range, insertText);
                vscode.workspace.applyEdit(edit).then(success => {
                    if (success)
                        document.save();
                });
            }
        }
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
                    <button class="icon-btn" id="btn-ports">Show Ports</button>
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