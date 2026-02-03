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
        this._cachedDocs = new Map();
        this._currentTopic = '/behavior_tree_log';
        // Update all active previews when the document changes
        vscode.workspace.onDidChangeTextDocument(e => {
            const preview = this._previews.get(e.document.uri.toString());
            if (preview && preview.visible) {
                // Determine if we should perform a full update or if it's a "clean" save
                // Actually updateWebview handles the diff logic
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
            this._cachedDocs.delete(uri.toString());
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
                // case 'reparent_node' removed: duplicate, handled below
                case 'switchMode':
                    if (message.mode === 'inspection') {
                        this.startInspectionMode(panel);
                    }
                    else {
                        this.stopInspectionMode();
                    }
                    break;
                case 'add_node':
                    this.handleAddNode(uri, message.nodeType, message.id, message.attributes);
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
                case 'loadLibrary':
                    this.handleLoadLibrary(panel);
                    break;
                case 'updateTopic':
                    this.handleUpdateTopic(panel, message.topic);
                    break;
                    break;
                case 'rename_node':
                    this.handleRenameNode(uri, message.id, message.newName);
                    break;
                case 'reparent_node':
                    this.handleReparentNode(uri, message.sourceId, message.targetId);
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
    findNodeSmart(doc, id) {
        // 1. Try Path-based resolution (Composite ID: "XMLID#Path")
        if (id.includes('#')) {
            const parts = id.split('#');
            // parts[0] is XML ID, parts[1] is Path
            if (parts.length > 1) {
                const pathStr = parts[1];
                const node = this.findElementByPath(doc.documentElement, pathStr);
                if (node)
                    return node;
            }
        }
        // 2. Fallback: Search by ID attribute
        // If the ID is composite but path failed (topology changed?), try finding by the XML ID part
        const cleanId = id.includes('#') ? id.split('#')[0] : id;
        return this.findNodeById(doc, cleanId);
    }
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
    getDoc(uri) {
        // Prefer cache if available to keeping IDs
        if (this._cachedDocs.has(uri.toString())) {
            return this._cachedDocs.get(uri.toString());
        }
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf8');
        const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
        this.ensureTempIds(doc.documentElement);
        this._cachedDocs.set(uri.toString(), doc);
        return doc;
    }
    handleDeleteNode(uri, id) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let node = this.findNodeByUuid(doc, id);
        if (!node) {
            node = this.findNodeSmart(doc, id);
        }
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
            this.saveXml(uri, doc); // Update file (clean)
            this.updateWebviewWithDoc(uri, doc); // Update view (with IDs)
        }
    }
    handleReparentNode(uri, childId, parentId) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let childNode = this.findNodeByUuid(doc, childId);
        if (!childNode)
            childNode = this.findNodeSmart(doc, childId);
        let parentNode = this.findNodeByUuid(doc, parentId);
        if (!parentNode)
            parentNode = this.findNodeSmart(doc, parentId);
        if (childNode && parentNode) {
            // Check for cycles (e.g. reparenting a node to its own descendant)
            let check = parentNode;
            let cycle = false;
            while (check) {
                if (check === childNode) {
                    cycle = true;
                    break;
                }
                check = check.parentNode;
            }
            if (cycle) {
                console.warn(`[Backend] Cycle detected. Cannot reparent ${childId} to ${parentId}`);
                return;
            }
            // Remove from old parent
            if (childNode.parentNode) {
                childNode.parentNode.removeChild(childNode);
            }
            // Append to new parent
            parentNode.appendChild(childNode);
            // It's no longer detached if it was
            if (childNode.getAttribute('_visual_detached')) {
                childNode.removeAttribute('_visual_detached');
            }
            this.saveXml(uri, doc);
            this.updateWebviewWithDoc(uri, doc);
        }
        else {
            console.warn(`[Backend] Reparent failed. Child: ${childId} found=${!!childNode}, Parent: ${parentId} found=${!!parentNode}`);
        }
    }
    handleDeleteEdge(uri, childId) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let childNode = this.findNodeByUuid(doc, childId);
        if (!childNode)
            childNode = this.findNodeById(doc, childId);
        // Move to root container (floating) instead of BehaviorTree
        const container = doc.documentElement;
        if (childNode && container) {
            if (childNode.parentNode) {
                childNode.parentNode.removeChild(childNode);
            }
            container.appendChild(childNode);
            this.saveXml(uri, doc);
            this.updateWebviewWithDoc(uri, doc);
        }
    }
    handleMoveNode(uri, sourceId, targetId) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        const sourceNode = this.findNodeById(doc, sourceId);
        const targetNode = this.findNodeById(doc, targetId);
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
            this.saveXml(uri, doc);
            this.updateWebviewWithDoc(uri, doc);
        }
        else {
            console.warn(`Could not find source ${sourceId} or target ${targetId} for move`);
        }
    }
    handleReorderChildren(uri, parentId, newOrder) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let foundParent = this.findNodeByUuid(doc, parentId);
        if (!foundParent)
            foundParent = this.findNodeSmart(doc, parentId);
        if (!foundParent) {
            console.warn(`[Backend] Reorder failed. Parent ${parentId} not found.`);
            return;
        }
        const parentNode = foundParent;
        // Resolve all children FIRST to avoid index invalidation during moves
        const childElements = [];
        let valid = true;
        for (const childId of newOrder) {
            let el = this.findNodeByUuid(doc, childId);
            if (!el)
                el = this.findNodeSmart(doc, childId);
            if (!el) {
                // If a node is missing, we shouldn't reorder partially as it might destroy the tree structure
                console.warn(`[Backend] Reorder child not found: ${childId}`);
                valid = false;
                break;
            }
            childElements.push(el);
        }
        if (valid) {
            // Re-append in new order
            // This effectively moves them to the end, but since we do it for ALL children in order,
            // they will be sorted correctly.
            // Note: If there are other children NOT in newOrder (e.g. comments, or filtered nodes), 
            // they will remain at the top (if we traverse) or be jumped over?
            // appendChild moves the node.
            childElements.forEach(el => {
                // Ensure we are only moving actual children of the parent
                // (Though findNodeSmart might find them anywhere, logic implies they are siblings)
                if (el.parentNode === parentNode) {
                    parentNode.appendChild(el);
                }
                else {
                    console.warn(`[Backend] Reorder child ${el.getAttribute('ID')} is not a child of target parent.`);
                }
            });
            this.saveXml(uri, doc);
            this.updateWebviewWithDoc(uri, doc);
        }
    }
    // ... Inspection methods ...
    startInspectionMode(panel) {
        if (this._bridgeProcess) {
            return;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace open.");
            return;
        }
        const pythonScriptPath = path.join(this._extensionUri.fsPath, 'src', 'ros_bridge.py');
        const cwd = workspaceFolders[0].uri.fsPath;
        try {
            let command = 'python3';
            let args = [pythonScriptPath, '--ros-args', '-p', `topic_name:=${this._currentTopic}`];
            let shell = true;
            // Robust ROS Environment Sourcing
            // If we are on Linux, check for /opt/ros to try and source automatically
            if (process.platform === 'linux' && fs.existsSync('/opt/ros')) {
                try {
                    const distros = fs.readdirSync('/opt/ros');
                    if (distros.length > 0) {
                        // Prefer humble, foxy, or just the first one
                        const selected = distros.find(d => d === 'humble') || distros.find(d => d === 'foxy') || distros[0];
                        const setupScript = `/opt/ros/${selected}/setup.bash`;
                        console.log(`[BehaviorTreePreview] Detected ROS distro: ${selected}. Will source ${setupScript}`);
                        // Wrap in bash source command
                        command = '/bin/bash'; // Use full path for safety
                        // We need to properly quote the python script path and ensure correct chaining
                        // Using '.' (dot) is safer than 'source' for POSIX compliance, though regular bash supports both.
                        // We use a single string script for bash -c
                        const pythonCmd = `python3 -u "${pythonScriptPath}" --ros-args -p topic_name:="${this._currentTopic}"`;
                        // NOTE: using . (dot) instead of source
                        args = ['-c', `. "${setupScript}" && ${pythonCmd}`];
                    }
                }
                catch (e) {
                    console.warn('Error detecting ROS distro:', e);
                }
            }
            // Pass environment variables, explicitly handling PYTHONPATH and LD_LIBRARY_PATH
            const env = {
                ...process.env,
                PYTHONPATH: process.env.PYTHONPATH || '',
                LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || ''
            };
            this._bridgeProcess = cp.spawn(command, args, {
                cwd: cwd,
                env: env,
                shell: false // We are explicitly invoking bash, so no need for extra shell wrapping
            });
            console.log(`[BehaviorTreePreview] Spawned: ${command} ${args.join(' ')}`);
            let dataBuffer = '';
            this._bridgeProcess.stdout?.on('data', (data) => {
                dataBuffer += data.toString();
                const lines = dataBuffer.split('\n');
                // Process all complete lines
                // The last element is either an empty string (if data ended with \n) 
                // or an incomplete line (fragment) which we should keep in buffer
                dataBuffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    if (trimmed.startsWith('{')) {
                        try {
                            const json = JSON.parse(trimmed);
                            panel.webview.postMessage({
                                type: 'status_update',
                                data: json
                            });
                        }
                        catch (e) {
                            console.error("Error parsing JSON line:", e, trimmed);
                        }
                    }
                    else {
                        console.log(`[Bridge Output]: ${trimmed}`);
                    }
                }
            });
            this._bridgeProcess.stderr?.on('data', (data) => {
                console.info(`[Bridge Output]: ${data}`);
            });
            this._bridgeProcess.on('close', (code) => {
                console.log(`Bridge process exited with code ${code}`);
                this._bridgeProcess = undefined;
            });
            vscode.window.showInformationMessage(`Inspection Mode Started: Listening to ${this._currentTopic}...`);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error starting bridge: ${e.message}`);
        }
    }
    handleUpdateTopic(panel, newTopic) {
        console.log(`[Backend] handleUpdateTopic called with: ${newTopic}. Current: ${this._currentTopic}`);
        if (this._currentTopic !== newTopic) {
            this._currentTopic = newTopic;
            // If running, restart to apply new topic
            if (this._bridgeProcess) {
                console.log(`[Backend] Restarting bridge for new topic...`);
                this.stopInspectionMode();
                setTimeout(() => {
                    this.startInspectionMode(panel);
                }, 500); // Small delay to ensure clean exit
            }
            else {
                console.log(`[Backend] Bridge not running, just updated topic config.`);
            }
        }
    }
    handleRenameNode(uri, id, newName) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let node = this.findNodeByUuid(doc, id);
        if (!node)
            node = this.findNodeById(doc, id);
        if (node) {
            node.setAttribute('name', newName); // Standard BT attribute for display name
            this.saveXml(uri, doc);
            this.updateWebviewWithDoc(uri, doc);
        }
    }
    stopInspectionMode() {
        if (this._bridgeProcess) {
            this._bridgeProcess.kill();
            this._bridgeProcess = undefined;
            vscode.window.showInformationMessage("Inspection Mode Stopped.");
        }
    }
    handleAddNode(uri, nodeType, providedId, attributes) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        // Add to <root> container so it appears floating (not connected to main tree)
        const container = doc.documentElement;
        // Create Node
        // Use provided ID if available, else generate
        // Ensure even backend-generated fallback IDs are transient
        const id = providedId || `_tmp_${nodeType}_${Date.now()}`;
        const newNode = doc.createElement(nodeType);
        newNode.setAttribute('ID', id); // Standard BT attribute
        // Add UUID for robustness
        const uuid = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        newNode.setAttribute('_uuid', uuid);
        // newNode.setAttribute('name', id); // Removed default name attribute as per user request
        if (attributes) {
            Object.entries(attributes).forEach(([key, value]) => {
                newNode.setAttribute(key, value);
            });
        }
        // Append to the container
        container.appendChild(newNode);
        // If container is NOT <root>, we are likely appending to BehaviorTree.
        // Mark it as visually detached so frontend doesn't draw edge.
        if (container.tagName !== 'root') {
            newNode.setAttribute('_visual_detached', 'true');
        }
        // Save
        this.saveXml(uri, doc);
        this.updateWebviewWithDoc(uri, doc);
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
    findNodeByUuid(doc, uuid) {
        const queue = [doc.documentElement];
        while (queue.length > 0) {
            const node = queue.shift();
            if (!node)
                continue;
            if (node.getAttribute && node.getAttribute('_uuid') === uuid) {
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
        const uriStr = document.uri.toString();
        const currentText = document.getText();
        console.log(`[Backend] updateWebview triggered for ${uriStr}`);
        // Assumption: If we have a cached doc, and its serialized (clean) content matches the document content,
        // then we assume it's "in sync" and we prefer our cached doc because it has the Transient IDs.
        // If content differs, user likely typed something manually, so we must re-parse.
        if (this._cachedDocs.has(uriStr)) {
            const cachedDoc = this._cachedDocs.get(uriStr);
            // Clone before format to avoid mutation
            const cachedClean = this.formatXml(cachedDoc, true); // true = clean IDs
            const currentClean = this.normalizeXml(currentText);
            if (cachedClean === currentClean) {
                // Documents match semantically (ignoring potential whitespace differences handled by normalize/format)
                // Use cached doc to preserve IDs
                console.log(`[Backend] Cache HIT. content matches.`);
                this.updateWebviewWithDoc(document.uri, cachedDoc, panel);
                return;
            }
            else {
                console.log(`[Backend] Cache MISS. Content differs.`);
                console.log(`[Backend] Cached (len=${cachedClean.length}): ${cachedClean.substring(0, 50)}...`);
                console.log(`[Backend] Current (len=${currentClean.length}): ${currentClean.substring(0, 50)}...`);
            }
        }
        else {
            console.log(`[Backend] No cache found.`);
        }
        // Fallback: Parse fresh from text, generate NEW temp IDs
        const doc = new xmldom_1.DOMParser().parseFromString(currentText, 'text/xml');
        this.ensureTempIds(doc.documentElement);
        this._cachedDocs.set(uriStr, doc);
        this.updateWebviewWithDoc(document.uri, doc, panel);
    }
    normalizeXml(content) {
        // Parse and re-format to create a canonical string for comparison
        try {
            const doc = new xmldom_1.DOMParser().parseFromString(content, 'text/xml');
            // We do NOT ensure IDs here, we just want to strip whitespace and print
            this.stripWhitespace(doc.documentElement);
            return '<?xml version="1.0"?>\n' + this.prettyPrint(doc.documentElement, 0);
        }
        catch (e) {
            return content.trim(); // Fallback
        }
    }
    updateWebviewWithDoc(uri, doc, panel) {
        const p = panel || this._previews.get(uri.toString());
        if (!p)
            return;
        // Send the doc WITH IDs to the webview
        // We need to process includes as well
        // Serialize first? processXmlWithDoc expects doc, but it will clone it.
        const processedDoc = this.processXmlWithDoc(doc, path.dirname(uri.fsPath));
        p.webview.postMessage({
            type: 'update',
            text: new xmldom_1.XMLSerializer().serializeToString(processedDoc),
        });
    }
    saveXml(uri, doc) {
        // Format XML strips IDs if passed true (or handled internally)
        // usage: formatXml(doc, true) -> clean
        // We need deep clone to avoid modifying the cached doc
        const clone = doc.cloneNode(true);
        // Clean IDs from clone
        this.cleanTempIds(clone.documentElement);
        // formatXml(..., false) because cleaning is done manually
        const content = this.formatXml(clone, false);
        fs.writeFileSync(uri.fsPath, content);
    }
    cleanTempIds(node) {
        if (node.nodeType === 1) {
            const el = node;
            const id = el.getAttribute('ID');
            if (id && id.startsWith('_tmp_')) {
                el.removeAttribute('ID');
            }
            if (el.getAttribute('_visual_detached')) {
                el.removeAttribute('_visual_detached');
            }
            if (el.getAttribute('_uuid')) {
                el.removeAttribute('_uuid');
            }
            let child = node.firstChild;
            while (child) {
                this.cleanTempIds(child);
                child = child.nextSibling;
            }
        }
    }
    ensureTempIds(node) {
        if (node.nodeType === 1) { // Element
            const el = node;
            if (!el.getAttribute('ID')) {
                // Generate a TEMP id
                const id = `_tmp_${el.tagName}_${Math.random().toString(36).substr(2, 9)}`;
                el.setAttribute('ID', id);
            }
            if (!el.getAttribute('_uuid')) {
                const uuid = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
                el.setAttribute('_uuid', uuid);
            }
            let child = node.firstChild;
            while (child) {
                this.ensureTempIds(child);
                child = child.nextSibling;
            }
        }
    }
    formatXml(doc, clean) {
        // If clean is requested, we should remove _tmp_ IDs. 
        // But saveXml usually does that on a clone. 
        // normalizeXml uses this too.
        if (clean) {
            // Operates on provided node (could be clone or original)
            // BEWARE: if original, it mutates.
            // normalizeXml passes a fresh doc.
            // updateWebview calls formatXml(cachedDoc, true) -> THIS MUTATES CACHED DOC!
            // FIX: Clone before formatting if clean=true
            const clone = doc.cloneNode(true);
            this.cleanTempIds(clone.documentElement);
            this.stripWhitespace(clone.documentElement);
            return '<?xml version="1.0"?>\n' + this.prettyPrint(clone.documentElement, 0);
        }
        // Helper that works on the node provided
        this.stripWhitespace(doc.documentElement);
        return '<?xml version="1.0"?>\n' + this.prettyPrint(doc.documentElement, 0);
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
                    // Text only content
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
    processXmlWithDoc(doc, rootPath) {
        const clone = doc.cloneNode(true);
        try {
            this.expandIncludes(clone, rootPath, false);
        }
        catch (e) {
            console.error("Error expanding", e);
        }
        return clone;
    }
    handleEditAttribute(uri, nodeId, attr, value) {
        const doc = this.getDoc(uri);
        if (!doc)
            return;
        let node = this.findNodeByUuid(doc, nodeId);
        if (!node)
            node = this.findNodeSmart(doc, nodeId);
        if (node) {
            node.setAttribute(attr, value);
            this.saveXml(uri, doc);
            // Force update
            // Wait, we need to update webview too.
            this.updateWebviewWithDoc(uri, doc);
            // Re-open/update editor too? 
            // vscode.workspace.openTextDocument(uri)...? 
            // saveXml writes to file, so editor updates automatically.
        }
        else {
            vscode.window.showErrorMessage(`Could not find node with path: ${nodeId}`);
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
    async handleLoadLibrary(panel) {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Load Library',
            filters: {
                'XML Files': ['xml'],
                'All Files': ['*']
            }
        });
        if (uris && uris.length > 0) {
            const uri = uris[0];
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                panel.webview.postMessage({
                    type: 'library_loaded',
                    xml: content
                });
                vscode.window.showInformationMessage(`Loaded library: ${path.basename(uri.fsPath)}`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Failed to load library: ${e.message}`);
            }
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