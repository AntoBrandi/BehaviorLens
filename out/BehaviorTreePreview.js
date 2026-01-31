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
const xmldom_1 = require("xmldom");
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
                    this.handleEditAttribute(uri, message.nodeId, message.attr, message.value);
                    break;
                case 'reparent_node':
                    this.handleMoveNode(uri, message.sourceId, message.targetId);
                    break;
                case 'switchMode':
                    if (message.mode === 'inspection') {
                        this.startInspectionMode(panel);
                    }
                    else {
                        this.stopInspectionMode();
                    }
                    break;
                case 'add_node':
                    this.handleAddNode(uri, message.nodeType);
                    break;
                case 'delete_node':
                    this.handleDeleteNode(uri, message.id);
                    break;
                case 'delete_edge':
                    this.handleDeleteEdge(uri, message.targetId);
                    break;
                case 'reorder_children':
                    this.handleReorderChildren(uri, message.parentId, message.newOrder);
                    break;
            }
        });
        // Initial update
        this.updateWebview(panel, document);
        // Cleanup on dispose
        panel.onDidDispose(() => {
            this.stopInspectionMode();
            this._previews.delete(uri.toString());
        });
    }
    // Helper to find node by Structural Path ID (e.g., "0-1-3")
    // "0" is root. "0-1" is 2nd child of root.
    findElementByPath(root, pathStr) {
        // Root is "0"
        if (pathStr === '0') {
            return root;
        }
        const indices = pathStr.split('-').map(s => parseInt(s, 10));
        if (indices[0] !== 0)
            return null; // Must start with root 0
        let currentNode = root;
        // Iterate remaining indices
        for (let i = 1; i < indices.length; i++) {
            const targetChildIndex = indices[i];
            let foundChild = null;
            let currentChildIndex = 0;
            // Iterate child nodes to find the N-th Element
            let look = currentNode.firstChild;
            while (look) {
                if (look.nodeType === 1) { // Element only
                    if (currentChildIndex === targetChildIndex) {
                        foundChild = look;
                        break;
                    }
                    currentChildIndex++;
                }
                look = look.nextSibling;
            }
            if (!foundChild)
                return null; // Path invalid
            currentNode = foundChild;
        }
        return currentNode;
    }
    handleDeleteNode(uri, id) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        const node = this.findElementByPath(doc.documentElement, id);
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
            this.saveXml(filePath, doc);
            // Force update
            const panel = this._previews.get(uri.toString());
            if (panel) {
                this.updateWebviewWithContent(panel, this.formatXml(doc), path.dirname(filePath));
            }
        }
    }
    handleDeleteEdge(uri, childId) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        const childNode = this.findElementByPath(doc.documentElement, childId);
        const treeRoot = doc.getElementsByTagName('BehaviorTree')[0] || doc.documentElement;
        if (childNode && treeRoot) {
            if (childNode.parentNode) {
                childNode.parentNode.removeChild(childNode);
            }
            treeRoot.appendChild(childNode);
            this.saveXml(filePath, doc);
            // Force update
            const panel = this._previews.get(uri.toString());
            if (panel) {
                this.updateWebviewWithContent(panel, this.formatXml(doc), path.dirname(filePath));
            }
        }
    }
    handleMoveNode(uri, sourceId, targetId) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        const sourceNode = this.findElementByPath(doc.documentElement, sourceId);
        const targetNode = this.findElementByPath(doc.documentElement, targetId);
        if (sourceNode && targetNode) {
            // Check for cycles
            let check = targetNode;
            let failure = false;
            while (check) {
                if (check === sourceNode) {
                    failure = true;
                    break;
                }
                check = check.parentNode;
            }
            if (failure)
                return;
            if (sourceNode.parentNode) {
                sourceNode.parentNode.removeChild(sourceNode);
            }
            targetNode.appendChild(sourceNode);
            this.saveXml(filePath, doc);
            // Force update
            const panel = this._previews.get(uri.toString());
            if (panel) {
                this.updateWebviewWithContent(panel, this.formatXml(doc), path.dirname(filePath));
            }
        }
        else {
            console.warn(`Could not find source ${sourceId} or target ${targetId} for move`);
        }
    }
    handleReorderChildren(uri, parentId, newOrder) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        const parentNode = this.findElementByPath(doc.documentElement, parentId);
        if (!parentNode)
            return;
        // Resolve all children FIRST to avoid index invalidation during moves
        const childElements = [];
        let valid = true;
        for (const childId of newOrder) {
            const el = this.findElementByPath(doc.documentElement, childId);
            if (!el) {
                valid = false;
                break;
            }
            childElements.push(el);
        }
        if (valid) {
            // Re-append in new order
            childElements.forEach(el => {
                if (el.parentNode === parentNode) {
                    parentNode.appendChild(el);
                }
            });
            this.saveXml(filePath, doc);
            // Force update
            const panel = this._previews.get(uri.toString());
            if (panel) {
                this.updateWebviewWithContent(panel, this.formatXml(doc), path.dirname(filePath));
            }
        }
    }
    // ... Inspection methods ...
    startInspectionMode(panel) {
        if (this._bridgeProcess) {
            return;
        }
        const pythonPath = 'python3';
        const scriptPath = path.join(this._extensionUri.fsPath, 'src', 'ros_bridge.py');
        try {
            this._bridgeProcess = cp.spawn(pythonPath, [scriptPath]);
            this._bridgeProcess.stdout?.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const json = JSON.parse(line);
                            panel.webview.postMessage({
                                type: 'status_update',
                                data: json
                            });
                        }
                        catch (e) {
                            console.log('Bridge output:', line);
                        }
                    }
                }
            });
            this._bridgeProcess.stderr?.on('data', (data) => {
                console.error('Bridge error:', data.toString());
            });
            this._bridgeProcess.on('error', (err) => {
                vscode.window.showErrorMessage(`Failed to start ROS bridge: ${err.message}`);
                this.stopInspectionMode();
            });
            this._bridgeProcess.on('exit', (code, signal) => {
                console.log(`Bridge exited with code ${code} and signal ${signal}`);
                this._bridgeProcess = undefined;
            });
            vscode.window.showInformationMessage("Inspection Mode Started: Listening to ROS 2 topic...");
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error starting bridge: ${e.message}`);
        }
    }
    stopInspectionMode() {
        if (this._bridgeProcess) {
            this._bridgeProcess.kill();
            this._bridgeProcess = undefined;
            vscode.window.showInformationMessage("Inspection Mode Stopped.");
        }
    }
    handleAddNode(uri, nodeType) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        // Logic to determine which Tree is the "Main" one, matching frontend logic
        let tree = null;
        const root = doc.documentElement;
        if (root.tagName === 'root' && root.getAttribute('main_tree_to_execute')) {
            const mainTreeId = root.getAttribute('main_tree_to_execute');
            const candidate = this.findNodeById(doc, mainTreeId); // Reuse findNode if possible or query selector
            if (candidate && candidate.tagName === 'BehaviorTree') {
                tree = candidate;
            }
        }
        if (!tree) {
            tree = doc.getElementsByTagName('BehaviorTree')[0] || doc.documentElement;
        }
        // Create Node
        // Generate ID
        const id = `${nodeType}_${Date.now()}`;
        const newNode = doc.createElement(nodeType);
        newNode.setAttribute('ID', id); // Standard BT attribute
        newNode.setAttribute('name', id);
        // Append to the determined tree
        tree.appendChild(newNode);
        // Save
        this.saveXml(filePath, doc);
        // Force update
        const panel = this._previews.get(uri.toString());
        if (panel) {
            this.updateWebviewWithContent(panel, this.formatXml(doc), path.dirname(filePath));
        }
    }
    // Helper to find node by XML ID attribute (for finding the Tree itself)
    findNodeById(doc, id) {
        const queue = [doc.documentElement];
        while (queue.length > 0) {
            const node = queue.shift();
            if (!node)
                continue;
            if (node.getAttribute && node.getAttribute('ID') === id) {
                return node;
            }
            for (let i = 0; i < node.childNodes.length; i++) {
                if (node.childNodes[i].nodeType === 1) {
                    queue.push(node.childNodes[i]);
                }
            }
        }
        return null;
    }
    updateWebview(panel, document) {
        this.updateWebviewWithContent(panel, document.getText(), path.dirname(document.uri.fsPath));
    }
    updateWebviewWithContent(panel, content, rootPath) {
        const processedXml = this.processXml(content, rootPath);
        panel.webview.postMessage({
            type: 'update',
            text: processedXml,
        });
    }
    saveXml(filePath, doc) {
        const content = this.formatXml(doc);
        fs.writeFileSync(filePath, content);
    }
    formatXml(doc) {
        // Ensure all nodes have IDs for stability
        this.ensureIds(doc.documentElement);
        // Strip whitespace text nodes first to avoid double indenting
        this.stripWhitespace(doc.documentElement);
        return '<?xml version="1.0"?>\n' + this.prettyPrint(doc.documentElement, 0);
    }
    ensureIds(node) {
        if (node.nodeType === 1) { // Element
            const el = node;
            if (!el.getAttribute('ID')) {
                const id = `${el.tagName}_${Math.random().toString(36).substr(2, 9)}`;
                el.setAttribute('ID', id);
            }
            let child = node.firstChild;
            while (child) {
                this.ensureIds(child);
                child = child.nextSibling;
            }
        }
    }
    stripWhitespace(node) {
        let child = node.firstChild;
        while (child) {
            const next = child.nextSibling;
            if (child.nodeType === 3 && !/\S/.test(child.nodeValue || '')) {
                node.removeChild(child);
            }
            else if (child.nodeType === 1) {
                this.stripWhitespace(child);
            }
            child = next;
        }
    }
    prettyPrint(node, level) {
        const indent = '    '.repeat(level);
        if (node.nodeType === 1) { // Element
            const el = node;
            let str = `${indent}<${el.tagName}`;
            // Attributes
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                str += ` ${attr.name}="${attr.value}"`;
            }
            if (!el.hasChildNodes()) {
                str += '/>';
            }
            else {
                str += '>';
                let hasElementChildren = false;
                for (let i = 0; i < el.childNodes.length; i++) {
                    if (el.childNodes[i].nodeType === 1) {
                        hasElementChildren = true;
                        break;
                    }
                }
                if (hasElementChildren) {
                    str += '\n';
                    for (let i = 0; i < el.childNodes.length; i++) {
                        str += this.prettyPrint(el.childNodes[i], level + 1);
                        if (i < el.childNodes.length - 1 || el.childNodes[i].nodeType === 1) {
                            str += '\n';
                        }
                    }
                    str += `${indent}</${el.tagName}>`;
                }
                else {
                    // Text only content, keep inline (though usually BT nodes don't have text)
                    for (let i = 0; i < el.childNodes.length; i++) {
                        str += el.childNodes[i].nodeValue || '';
                    }
                    str += `</${el.tagName}>`;
                }
            }
            return str;
        }
        else if (node.nodeType === 3) { // Text
            return (node.nodeValue || '').trim();
        }
        return '';
    }
    processXml(content, rootPath) {
        try {
            const parser = new xmldom_1.DOMParser();
            const doc = parser.parseFromString(content, 'text/xml');
            // Check for parsing errors
            const parserError = doc.getElementsByTagName("parsererror");
            if (parserError.length > 0) {
                return content; // Fallback to raw content so client can show error
            }
            this.expandIncludes(doc, rootPath, false);
            return new xmldom_1.XMLSerializer().serializeToString(doc);
        }
        catch (e) {
            console.error('Error processing XML includes:', e);
            return content;
        }
    }
    expandIncludes(doc, currentPath, inContainer) {
        const includes = doc.getElementsByTagName('include');
        // Convert live collection to array to avoid issues when checking length or iterating while modifying
        const includeList = [];
        for (let i = 0; i < includes.length; i++) {
            includeList.push(includes[i]);
        }
        for (const inc of includeList) {
            const rosPkg = inc.getAttribute('ros_pkg');
            const pathAttr = inc.getAttribute('path');
            let newPath = '';
            let newInContainer = inContainer;
            if (rosPkg) {
                try {
                    // Resolve via docker
                    const cmd = `docker exec alum bash -c "source /opt/ros/*/setup.bash; if [ -f /opt/pal/alum/setup.bash ]; then source /opt/pal/alum/setup.bash; fi; ros2 pkg prefix --share ${rosPkg}"`;
                    const pkgPath = cp.execSync(cmd, { encoding: 'utf8' }).trim();
                    newPath = path.posix.join(pkgPath, pathAttr || ''); // Use posix for container paths
                    newInContainer = true;
                }
                catch (e) {
                    console.warn(`Failed to resolve package ${rosPkg}`, e);
                    continue;
                }
            }
            else if (pathAttr) {
                if (inContainer) {
                    newPath = path.posix.join(currentPath, pathAttr);
                }
                else {
                    newPath = path.resolve(currentPath, pathAttr);
                }
            }
            if (newPath) {
                try {
                    let fileContent = '';
                    if (newInContainer) {
                        fileContent = cp.execSync(`docker exec alum cat ${newPath}`, { encoding: 'utf8' });
                    }
                    else {
                        if (fs.existsSync(newPath)) {
                            fileContent = fs.readFileSync(newPath, 'utf8');
                        }
                        else {
                            console.warn(`File not found: ${newPath}`);
                            continue;
                        }
                    }
                    const includedDoc = new xmldom_1.DOMParser().parseFromString(fileContent, 'text/xml');
                    const nextPath = newInContainer ? path.posix.dirname(newPath) : path.dirname(newPath);
                    this.expandIncludes(includedDoc, nextPath, newInContainer);
                    const root = includedDoc.documentElement;
                    if (root) {
                        let child = root.firstChild;
                        while (child) {
                            const next = child.nextSibling;
                            const importedNode = doc.importNode(child, true);
                            inc.parentNode?.insertBefore(importedNode, inc);
                            child = next;
                        }
                    }
                    inc.parentNode?.removeChild(inc);
                }
                catch (e) {
                    console.warn(`Failed to read/parse included file ${newPath}`, e);
                }
            }
        }
    }
    handleEditAttribute(uri, nodeId, attr, value) {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        const node = this.findElementByPath(doc.documentElement, nodeId);
        if (node) {
            node.setAttribute(attr, value);
            this.saveXml(filePath, doc);
            // Force update
            const panel = this._previews.get(uri.toString());
            if (panel) {
                vscode.workspace.openTextDocument(uri).then(doc => this.updateWebview(panel, doc));
            }
        }
        else {
            vscode.window.showErrorMessage(`Could not find node with path: ${nodeId}`);
        }
    }
    getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'assets', 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'assets', 'index.css'));
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Behavior Lens</title>
            </head>
            <body>
                <div id="app"></div>
                <script type="module" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
exports.BehaviorTreePreviewManager = BehaviorTreePreviewManager;
BehaviorTreePreviewManager.viewType = 'behaviortree.preview';
//# sourceMappingURL=BehaviorTreePreview.js.map