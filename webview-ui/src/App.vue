<script setup lang="ts">
import { ref, computed, onErrorCaptured } from 'vue';
import { VueFlow, useVueFlow, Position } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import dagre from 'dagre';
import CustomNode from './components/CustomNode.vue';
import ContextMenu from './components/ContextMenu.vue';

// State
const currentMode = ref<'editor' | 'inspection'>('editor');
const menu = ref<{ x: number; y: number; type: 'node' | 'edge'; id: string } | null>(null);
const userNodePositions = ref(new Map<string, {x: number, y: number}>());
const isFirstLoad = ref(true);
const layoutDirection = ref('TB');
const showPorts = ref(false);
const errorLog = ref('');
const treeDefinitions = ref<Map<string, Element>>(new Map());
const showExpandMenu = ref(false);
const subTreeToExpand = ref<string | null>(null);
const rosTopic = ref('/behavior_tree_log');
const expandedSubTreeIds = ref(new Set<string>());

function updateTopic() {
    vscode.postMessage({
        type: 'updateTopic',
        topic: rosTopic.value
    });
}

onErrorCaptured((err) => {
    console.error("Captured Error:", err);
    errorLog.value = String(err);
    return false;
});

interface PortDef {
    name: string;
    type?: string;
    description?: string;
    default?: string;
}

interface NodeDef {
    type: 'Action' | 'Condition' | 'Control' | 'Decorator';
    ports: PortDef[];
}

const nodeLibrary = ref<Record<string, NodeDef>>({
    'Sequence': { type: 'Control', ports: [] },
    'Fallback': { type: 'Control', ports: [] },
    'Action': { type: 'Action', ports: [] },
    'Condition': { type: 'Condition', ports: [] }
});

const libraryGroups = computed(() => {
    const groups: Record<string, string[]> = {
        Control: [],
        Decorator: [],
        Action: [],
        Condition: []
    };
    for (const [name, def] of Object.entries(nodeLibrary.value)) {
        // Map XML tag names to our internal types if needed, or rely on naming convention
        // Groot types: Action, Condition, Control, Decorator
        const type = def.type;
        if (groups[type]) {
            groups[type].push(name);
        } else {
             // Fallback
             if (!groups['Action']) groups['Action'] = [];
             groups['Action'].push(name);
        }
    }
    return groups;
});

// Vue Flow
const { onConnect, addEdges, onNodeDragStop, fitView, setNodes, setEdges, applyNodeChanges, applyEdgeChanges, removeNodes, removeEdges, project } = useVueFlow({
    minZoom: 0.2,
    maxZoom: 4
});
const nodes = ref([]);
const edges = ref([]);

// Change Handlers (Delete via Keyboard)
function onNodesChange(changes: any[]) {
    changes.forEach((change) => {
        if (change.type === 'remove') {
            const node = nodes.value.find((n: any) => n.id === change.id);
            if (node?.data?.isRoot) return; // Prevent deletion of Root

            // If ID is composite (ID#Path), use data.uuid (preferred) or node.id (Composite ID) to ensure uniqueness
            // node.id is already the Composite ID (XMLID#Path) which backend understands via findNodeSmart
            const idToSend = node?.data?.uuid || change.id;
            
            vscode.postMessage({
                type: 'delete_node',
                id: idToSend
            });
            // Clear from cache if deleted
            if (node?.data?.uuid) {
                userNodePositions.value.delete(node.data.uuid);
            } else if (node?.data?.xmlId) {
                userNodePositions.value.delete(node.data.xmlId);
            }
        }
    });
}
function onEdgesChange(changes: any[]) {
    changes.forEach((change) => {
        if (change.type === 'remove') {
            const edge = edges.value.find((e: any) => e.id === change.id);
            if (edge) {
                const targetNode = nodes.value.find((n: any) => n.id === edge.target);
                const idToSend = targetNode?.data?.uuid || edge.target; // Composite ID fallback

                vscode.postMessage({
                    type: 'delete_edge',
                    targetId: idToSend
                });
            }
        }
    });
}

// ... (Context Menu Handlers omitted for brevity, they are unchanged) ...
// But I need to include them to match the target block if I'm replacing a large chunk.
// Actually, let's target specific blocks to be safer.

// I will do this in 2 chunks.
// Chunk 1: State definitions.
// Chunk 2: parseXML and handleNodeDragStop.

// Wait, replace_file_content needs contiguous block for SINGLE call, or I can use multi_replace.
// I will use multi_replace.

// ... (Retrying with multi_replace logic below)



// Context Menu Handlers
function onNodeContextMenu(event: any) {
    if (currentMode.value !== 'editor') return;
    event.event.preventDefault();
    menu.value = {
        x: event.event.clientX,
        y: event.event.clientY,
        type: 'node',
        id: event.node.id
    };
}

function onEdgeContextMenu(event: any) {
    if (currentMode.value !== 'editor') return;
    event.event.preventDefault();
    menu.value = {
        x: event.event.clientX,
        y: event.event.clientY,
        type: 'edge',
        id: event.edge.id
    };
}

function onDeleteFromMenu() {
    if (!menu.value) return;
    if (menu.value.type === 'node') {
        const node = nodes.value.find((n: any) => n.id === menu.value!.id);
        if (node?.data?.isRoot) return; // Prevent deletion of Root
        
        // Use graph ID for removal from view, but ensure backend gets XML ID if needed?
        // Actually removeNodes expects graph IDs.
        removeNodes([menu.value.id]);
        
        // If we want to send message to backend (we do in onNodesChange via listener), 
        // dragging/context menu deletion might trigger onNodesChange?
        // Yes, removeNodes triggers onNodesChange. So we don't need to postMessage here IF onNodesChange handles it.
        // Checking onNodesChange implementation... yes it sends the message.
        // So we just need to ensure onNodesChange handles the composite ID (which I did in previous step).
    } else {
        removeEdges([menu.value.id]);
    }
    menu.value = null;
}

const editingNodeId = ref<string | null>(null);

function onExpandSubTree() {
    if (!subTreeToExpand.value) return;
    expandSubTree(subTreeToExpand.value);
    showExpandMenu.value = false;
    subTreeToExpand.value = null;
    menu.value = null;
}

function onNodeClick(event: any) {
    // Only show for SubTree nodes
    const node = event.node;
    if (node.data.type === 'subtree') {
        const { clientX, clientY } = event.event;
        menu.value = {
            x: clientX,
            y: clientY,
            type: 'node',
            id: node.id
        };
        
        event.event.preventDefault(); 
        event.event.stopPropagation();
        
        subTreeToExpand.value = node.id;
        showExpandMenu.value = true;
    } else {
        showExpandMenu.value = false;
        subTreeToExpand.value = null;
        menu.value = null;
    }
}

function onRenameFromMenu() {
    if (!menu.value || menu.value.type !== 'node') return;
    const node = nodes.value.find((n: any) => n.id === menu.value!.id);
    if (node?.data?.isRoot) return; // Prevent rename of Root
    
    editingNodeId.value = menu.value.id;
    menu.value = null;
}

function onSaveLabel(payload: { nodeId: string, newLabel: string }) {
    const node = nodes.value.find((n: any) => n.id === payload.nodeId);
    if (node) {
        if (node.data.label !== payload.newLabel) {
            node.data.label = payload.newLabel;
            node.label = payload.newLabel;
            
            vscode.postMessage({
                type: 'rename_node',
                id: node.data.uuid || node.id,
                newName: payload.newLabel
            });
        }
    }
    editingNodeId.value = null;
}

function onCancelEdit() {
    editingNodeId.value = null;
}

function onRequestEdit(nodeId: string) {
    if (currentMode.value === 'inspection') return;
    editingNodeId.value = nodeId;
}

// Type Inference Logic
function getNodeType(tagName: string, hasChildren: boolean): string {
    // 1. Check Library first
    if (nodeLibrary.value[tagName]) {
        return nodeLibrary.value[tagName].type.toLowerCase();
    }

    const lower = tagName.toLowerCase();
    
    // 2. Explicit types from lists
    if (['sequence', 'fallback', 'parallel', 'reactivesequence', 'reactivefallback', 'switch2', 'switch3', 'switch4', 'if', 'while', 'control'].includes(lower)) {
        return 'control';
    }
    if (['inverter', 'forcesuccess', 'forcefailure', 'repeat', 'retry', 'timeout', 'delay', 'keeprunninguntilfailure', 'alwayssuccess', 'alwaysfailure', 'decorator'].includes(lower)) {
        return 'decorator';
    }

    // 3. Heuristic based on children
    // If it has children, it must be an internal node (Control or Decorator).
    // It logic above didn't catch it, we default to Control.
    if (hasChildren) {
        return 'control';
    }

    // 4. Heuristic: If it has "Condition" in name it's likely a condition
    // Only if it implies no children (leaf)
    if (tagName.includes('Condition')) {
        return 'condition';
    }

    // 5. Explicit check for SubTree
    if (tagName === 'SubTree') {
        return 'subtree';
    }

    // Default to Action (Leaf)
    return 'action';
}

function parseXML(text: string) {
    // Capture old positions before parsing
    const oldPositions = new Map<string, {x: number, y: number}>();
    nodes.value.forEach((n: any) => {
        if (n.data?.isExpanded) {
            // Expanded nodes use Composite ID
             oldPositions.set(n.id, n.position);
        } else if (n.data?.uuid) {
            oldPositions.set(n.data.uuid, n.position);
        } else if (n.data?.xmlId) {
            oldPositions.set(n.data.xmlId, n.position);
        }
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
        console.error("XML Parsing Error", errorNode.textContent);
        return;
    }

    const newNodes: any[] = [];
    const newEdges: any[] = [];
    // let idCounter = 0; // No longer needed with path-based IDs

    function getAttributes(node: Element) {
        const attrs: Record<string, string> = {};
        for(let i=0; i<node.attributes.length; i++) {
            const attr = node.attributes[i];
            attrs[attr.name] = attr.value;
        }
        return attrs;
    }

    // Recursive Graph Builder (mutates passed arrays)
    function buildGraphRecursive(xmlNode: Element, currentPath: string, parentId: string | null, targetNodes: any[], targetEdges: any[]) {
        if (xmlNode.nodeType !== 1) return;

        const xmlId = xmlNode.getAttribute('ID');
        if (!xmlId) return;

        const internalId = `${xmlId}#${currentPath}`; // Unique ID per instance
        const label = xmlNode.tagName;
        const name = xmlNode.getAttribute('name');
        
        const hasChildren = xmlNode.children.length > 0;
        const inferredType = getNodeType(label, hasChildren);

        targetNodes.push({
            id: internalId,
            type: 'custom',
            label: name || label,
            data: { 
                label: name || label, 
                type: inferredType, 
                originalName: label,
                xmlId: xmlId,
                uuid: xmlNode.getAttribute('_uuid'),
                attributes: getAttributes(xmlNode)
            },
            position: { x: 0, y: 0 } 
        });

        if (parentId && xmlNode.getAttribute('_visual_detached') !== 'true') {
            targetEdges.push({
                id: `e${parentId}-${internalId}`,
                source: parentId,
                target: internalId,
                type: 'default'
            });
        }

        // Children
        let childIndex = 0;
        for (let i = 0; i < xmlNode.children.length; i++) {
            const child = xmlNode.children[i];
            if (child.nodeType === 1) { 
                 buildGraphRecursive(child, `${currentPath}-${childIndex}`, internalId, targetNodes, targetEdges);
                 childIndex++;
            }
        }
    }

    // Determine Root and Start Path
    const docRoot = doc.documentElement;
    let mainTree: Element | null = null;
    let mainTreePath = '0'; // Default if docRoot is the tree

    if (docRoot.tagName === 'root') {
         // It's a container. Find the specific BehaviorTree
         const targetId = docRoot.getAttribute('main_tree_to_execute');
         let found = false;
         
         let childIndex = 0;
         for(let i=0; i<docRoot.children.length; i++) {
             const child = docRoot.children[i];
             if (child.nodeType === 1) {
                 if (targetId && child.getAttribute('ID') === targetId) {
                     mainTree = child;
                     mainTreePath = `0-${childIndex}`;
                     found = true;
                     break;
                 }
                 // Fallback: first BehaviorTree if no targetId
                 if (!targetId && child.tagName === 'BehaviorTree') {
                     mainTree = child;
                     mainTreePath = `0-${childIndex}`;
                     found = true;
                     break;
                 }
                 childIndex++;
             }
         }
    } else {
        // docRoot is potentially the BehaviorTree itself
        mainTree = docRoot;
        mainTreePath = '0';
    }

    if (mainTree) {
        // Create Root Node
        const rootId = mainTree.getAttribute('ID') || 'Root';
        newNodes.push({
            id: rootId,
            type: 'custom',
            label: 'Root',
            data: { 
                label: 'Root', 
                type: 'root', 
                originalName: rootId,
                xmlId: rootId,
                uuid: mainTree.getAttribute('_uuid'),
                isRoot: true,
                attributes: getAttributes(mainTree)
            },
            position: { x: 0, y: 0 } 
        });

        // Visualize children of the Tree with Root as parent
        let childIndex = 0;
        for (let i = 0; i < mainTree.children.length; i++) {
            const child = mainTree.children[i];
            if (child.nodeType === 1) {
                // Parent ID is rootId
                buildGraphRecursive(child, `${mainTreePath}-${childIndex}`, rootId, newNodes, newEdges);
                childIndex++;
            }
        }
    }

    // Visualize Floating Nodes (Direct children of <root> that are NOT BehaviorTree)
    if (docRoot.tagName === 'root') {
        const rootChildren = docRoot.children;
        for(let i=0; i<rootChildren.length; i++) {
            const child = rootChildren[i];
            if (child.nodeType === 1 && child !== mainTree && child.tagName !== 'BehaviorTree') {
                buildGraphRecursive(child, `0-${i}`, null, newNodes, newEdges);
            }
        }
        
        // Populate treeDefinitions
        treeDefinitions.value.clear();
        for(let i=0; i<rootChildren.length; i++) {
             const child = rootChildren[i];
             if (child.tagName === 'BehaviorTree') {
                 const id = child.getAttribute('ID');
                 if (id) treeDefinitions.value.set(id, child);
             }
        }
    }

    const layout = getLayoutedElements(newNodes, newEdges, layoutDirection.value);
    
    // Position Reconciliation
    layout.nodes.forEach((node: any) => {
        const uuid = node.data.uuid;
        const xmlId = node.data.xmlId;
        const isExpanded = node.data.isExpanded;
        
        // 1. If user explicitly moved it, use that position
        
        let cachedPos = null;
        if (isExpanded) {
             // For expanded nodes, ALWAYS use Composite ID (node.id)
             if (userNodePositions.value.has(node.id)) {
                 cachedPos = userNodePositions.value.get(node.id);
             }
        } else {
            // For regular nodes, Prefer UUID
            if (uuid && userNodePositions.value.has(uuid)) {
                 cachedPos = userNodePositions.value.get(uuid);
            } else if (xmlId && userNodePositions.value.has(xmlId)) {
                 cachedPos = userNodePositions.value.get(xmlId);
            }
        }

        if (cachedPos) {
             node.position = cachedPos;
             return;
        }

        // 2. Fallback to old position (from previous render)
        if (isExpanded) {
            if (oldPositions.has(node.id)) {
                node.position = oldPositions.get(node.id);
                return;
            }
        } else {
            if (uuid && oldPositions.has(uuid)) {
                 node.position = oldPositions.get(uuid);
                 return;
            }
            if (xmlId && oldPositions.has(xmlId)) {
                 node.position = oldPositions.get(xmlId);
            }
        }
    });

    nodes.value = layout.nodes;
    edges.value = layout.edges;
    
    if (isFirstLoad.value) {
        fitView();
        isFirstLoad.value = false;
    }

    // Re-apply expansions
    // We use a queue to handle nested expansions
    let queue = [...nodes.value];
    // To prevent infinite loops or redundant checks
    const processed = new Set<string>();

    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || processed.has(node.id)) continue;
        processed.add(node.id);

        if (node.data.type === 'subtree') {
            const shouldExpand = expandedSubTreeIds.value.has(node.id) || 
                                (node.data.uuid && expandedSubTreeIds.value.has(node.data.uuid));
            
            if (shouldExpand) {
                const newNodes = expandSubTree(node.id);
                if (newNodes && newNodes.length > 0) {
                    queue.push(...newNodes);
                }
            }
        }
    }
}

// Separate function for expansion relying on same logic, but we need to instantiate it or move it out.
// Ideally move logic out. For now, I'll duplicate the simplified builder logic or extract it properly.
// The `parseXML` function is huge.
// Let's create a standalone builder function outside parseXML.

function populateGraph(xmlNode: Element, currentPath: string, parentId: string | null, targetNodes: any[], targetEdges: any[]) {
     if (xmlNode.nodeType !== 1) return;

    const xmlId = xmlNode.getAttribute('ID');
    if (!xmlId) return;

    const internalId = `${xmlId}#${currentPath}`;
    const label = xmlNode.tagName;
    const name = xmlNode.getAttribute('name');
    
    // Check if node has children OR if it's a SubTree (which shouldn't have children by default but we are populating)
    const hasChildren = xmlNode.children.length > 0;
    const inferredType = getNodeType(label, hasChildren);

    function getAttrs(node: Element) {
        const attrs: Record<string, string> = {};
        for(let i=0; i<node.attributes.length; i++) {
            const attr = node.attributes[i];
            attrs[attr.name] = attr.value;
        }
        return attrs;
    }

    targetNodes.push({
        id: internalId,
        type: 'custom',
        label: name || label,
        data: { 
            label: name || label, 
            type: inferredType, 
            originalName: label,
            xmlId: xmlId,
            uuid: xmlNode.getAttribute('_uuid'),
            isExpanded: true,
            attributes: getAttrs(xmlNode)
        },
        position: { x: 0, y: 0 } 
    });

    if (parentId) {
        targetEdges.push({
            id: `e${parentId}-${internalId}`,
            source: parentId,
            target: internalId,
            type: 'default'
        });
    }

    let childIndex = 0;
    for (let i = 0; i < xmlNode.children.length; i++) {
        const child = xmlNode.children[i];
        if (child.nodeType === 1) { 
             populateGraph(child, `${currentPath}-${childIndex}`, internalId, targetNodes, targetEdges);
             childIndex++;
        }
    }
}

function expandSubTree(nodeId: string): any[] | undefined {
    const nodeIndex = nodes.value.findIndex((n: any) => n.id === nodeId);
    if (nodeIndex === -1) return undefined;
    
    const subTreeNode = nodes.value[nodeIndex];
    if (subTreeNode.data.type !== 'subtree') return undefined;

    // Track state
    expandedSubTreeIds.value.add(nodeId);
    if (subTreeNode.data.uuid) {
        expandedSubTreeIds.value.add(subTreeNode.data.uuid);
    }
    
    // Capture original position
    const originalPosition = { ...subTreeNode.position };
    
    const treeId = subTreeNode.data.xmlId || subTreeNode.data.originalName;
    const definition = treeDefinitions.value.get(treeId);
    
    if (!definition) {
        console.warn(`Definition for SubTree ${treeId} not found.`);
        return undefined;
    }
    
    const parentEdge = edges.value.find((e: any) => e.target === nodeId);
    const parentId = parentEdge ? parentEdge.source : null;
    
    const subTreePath = nodeId.split('#')[1]; 
    if (!subTreePath) return undefined;

    const newNodes: any[] = [];
    const newEdges: any[] = [];
    
    let rootChild: Element | null = null;
    for(let i=0; i<definition.children.length; i++) {
        if (definition.children[i].nodeType === 1) {
            rootChild = definition.children[i];
            break;
        }
    }
    
    if (!rootChild) return undefined;
    
    // Populate graph logic...
    populateGraph(rootChild, subTreePath, parentId, newNodes, newEdges);
    
    // LOCAL LAYOUT CALCULATION
    // 1. Isolate internal edges (edges between newNodes)
    // The edge from parentId -> newRoot is NOT internal for layout purposes of the subtree itself 
    // if we want to treat newRoot as the "root" of the local layout.
    // However, getLayoutedElements expects a graph.
    // If we pass ONLY newNodes and internal edges, dagre will layout them relative to (0,0).
    
    const newNodeIds = new Set(newNodes.map(n => n.id));
    const internalEdges = newEdges.filter(e => newNodeIds.has(e.source) && newNodeIds.has(e.target));
    
    // 2. Compute layout for just the new subtree
    const layout = getLayoutedElements(newNodes, internalEdges, layoutDirection.value);
    
    // 3. Find the new root node (the one connected to parentId, or the one with no incoming internal edges)
    // The populateGraph call recursively adds nodes. The first one added is usually the root.
    // ID of the new root should be `${rootChild.getAttribute('ID')}#${subTreePath}`.
    // Or we can find it by checking which node has parentId as source in newEdges
    const incomingEdge = newEdges.find(e => e.source === parentId);
    const newRootId = incomingEdge ? incomingEdge.target : newNodes[0].id; // Fallback
    
    const newRoot = layout.nodes.find((n: any) => n.id === newRootId);
    
    if (!newRoot) return undefined;
    
    // 4. Calculate Offset
    // We want newRoot.position to match originalPosition
    const offsetX = originalPosition.x - newRoot.position.x;
    const offsetY = originalPosition.y - newRoot.position.y;
    
    // 5. Apply Offset to ALL new nodes AND Reconcile with Cache
    layout.nodes.forEach((n: any) => {
        const uuid = n.data.uuid;
        const xmlId = n.data.xmlId;
        const isExpanded = n.data.isExpanded;

        // Check if we have a user-defined position for this node (moved previously)
        // Since we re-expand, the node ID might be regenerated if path changes, 
        // BUT uuid persists if available.
        // We prioritize UUID check.
        
        let cachedPos = null;
        if (isExpanded) {
            // For expanded nodes, use Composite ID (node.id)
            if (userNodePositions.value.has(n.id)) {
                cachedPos = userNodePositions.value.get(n.id);
            }
        } else if (uuid && userNodePositions.value.has(uuid)) {
            cachedPos = userNodePositions.value.get(uuid);
        } else if (xmlId && userNodePositions.value.has(xmlId)) {
            cachedPos = userNodePositions.value.get(xmlId);
        }

        if (cachedPos) {
            // Restore user position
            n.position = { ...cachedPos };
        } else {
            // Apply offset to auto-layout position
            n.position.x += offsetX;
            n.position.y += offsetY;
        }
        
        
        // Cache this new position so it sticks if we do a future global reconciliation (optional, but good practice)
        if (isExpanded) {
             userNodePositions.value.set(n.id, { ...n.position });
        } else if (n.data.uuid) {
             userNodePositions.value.set(n.data.uuid, { ...n.position });
        } else if (n.data.xmlId) {
             userNodePositions.value.set(n.data.xmlId, { ...n.position });
        }
    });
    
    // Remove SubTree node
    const remainingNodes = nodes.value.filter((n: any) => n.id !== nodeId);
    // Remove incoming edge to SubTree, but keep other edges
    const remainingEdges = edges.value.filter((e: any) => e.target !== nodeId); 
    
    // Verify valid edges? 
    // populateGraph added edge parentId -> newRootId to newEdges.
    // We need to ensure that is kept. content of 'newEdges' has it.
    
    nodes.value = [...remainingNodes, ...layout.nodes];
    edges.value = [...remainingEdges, ...newEdges];
    
    return layout.nodes; // Return new nodes for recursion
}

function parseLibraryXML(text: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const model = doc.getElementsByTagName('TreeNodesModel')[0];
    if (!model) return;

    const newLibrary: Record<string, NodeDef> = {};
    
    // Iterate over children of TreeNodesModel
    for(let i=0; i<model.children.length; i++) {
        const node = model.children[i];
        if(node.nodeType !== 1) continue;

        const tagName = node.tagName; // Action, Condition, Control, Decorator
        const id = node.getAttribute('ID');
        if (!id) continue;

        let type: any = 'Action';
        if (tagName === 'Action' || tagName === 'Condition' || tagName === 'Control' || tagName === 'Decorator') {
            type = tagName;
        }

        const ports: PortDef[] = [];
        for(let j=0; j<node.children.length; j++) {
            const child = node.children[j];
            if(child.nodeType !== 1) continue;
            
            if (child.tagName === 'input_port' || child.tagName === 'output_port' || child.tagName === 'inout_port') {
                 ports.push({
                     name: child.getAttribute('name') || '',
                     type: child.getAttribute('type') || 'string',
                     default: child.getAttribute('default') || undefined,
                     description: child.textContent || ''
                 });
            }
        }

        newLibrary[id] = { type, ports };
    }

    // Merge or Replace? Let's Replace but keep defaults if wanting a clean slate, 
    // OR merge with defaults. The user request implies "upload custom nodes... form a library".
    // Usually standard nodes are always available.
    // Let's merge with standard set.
    // Merge with existing library
    // Merge with existing library
    nodeLibrary.value = {
        ...nodeLibrary.value,
        ...newLibrary
    };
}


// Helper to reorder children based on visual position
function reorderChildren(parentId: string) {
    // 1. Find all edges where source is parentId
    // Edges are reactive
    const childEdges = edges.value.filter((e: any) => e.source === parentId);
    if (childEdges.length <= 1) return; // Nothing to sort

    // 2. Map edges to target nodes
    const childrenNodes = childEdges.map((e: any) => nodes.value.find((n: any) => n.id === e.target)).filter((n: any) => n !== undefined);

    // 3. Sort based on layout direction
    // If TB (Vertical), Left-to-Right is X.
    // If LR (Horizontal), Top-to-Bottom order is Y.
    const isVertical = layoutDirection.value === 'TB';
    
    childrenNodes.sort((a: any, b: any) => {
        if (isVertical) {
            return a.position.x - b.position.x;
        } else {
            return a.position.y - b.position.y;
        }
    });

    // 4. Extract UUIDs or Composite IDs
    const newOrder = childrenNodes.map((n: any) => n.data.uuid || n.id).filter((id: any) => !!id);

    console.log(`[App.vue] Reordering children of ${parentId} based on ${isVertical ? 'X' : 'Y'}:`, newOrder);

    // 5. Send to backend
    // Only if we define a 'reorder_children' message type in backend
    // Check BehaviorTreePreview.ts -> handleReorderChildren exists? YES.
    const parentNode = nodes.value.find((n: any) => n.id === parentId);
    
    // Use UUID for parent if available, else Composite ID
    const parentRealId = parentNode?.data?.uuid || parentNode?.id;
    
    if (parentRealId) {
        vscode.postMessage({
            type: 'reorder_children',
            parentId: parentRealId,
            newOrder: newOrder
        });
    }
}



onConnect((params) => {
    // Resolve nodes to get XML IDs
    const sourceNode = nodes.value.find((n: any) => n.id === params.source);
    const targetNode = nodes.value.find((n: any) => n.id === params.target);

    const sourceIdToSend = sourceNode?.data?.uuid || params.source;
    const targetIdToSend = targetNode?.data?.uuid || params.target;

    console.log("[App.vue] onConnect triggered. Raw:", params, "IDs:", { source: sourceIdToSend, target: targetIdToSend });
   
    // Add edge locally so reorderChildren can see it immediately
    addEdges([params]);

    vscode.postMessage({
        type: 'reparent_node',
         // Backend expects: sourceId = Child (Node to move), targetId = Parent (Destination)
         // Vue Flow edge: Source (Parent) -> Target (Child)
         // So we want to move params.target (Child) to params.source (Parent)
        sourceId: targetIdToSend,
        targetId: sourceIdToSend
    });

    // Trigger reorder after a tick to allow the edge to be registered?
    // Edges reference is reactive. The edge might not be in 'edges.value' yet inside onConnect?
    // onConnect is event, the edge is added by VueFlow automatically or via addEdges?
    // Usually we need to add edge manually if we don't use default connection line behavior,
    // but here we might rely on default.
    // But wait, if we rely on default, 'edges.value' should update.
    setTimeout(() => {
        reorderChildren(params.source);
    }, 100);
});

// Layout Graph
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 172;
const nodeHeight = 36;

// Helper to count visible attributes including library ports
function countVisiblePorts(node: any) {
    const attrs = node.data.attributes || {};
    const label = node.data.label;
    const originalName = node.data.originalName;
    
    // Find definition (Logic matches CustomNode.vue)
    const def = nodeLibrary.value[label] || nodeLibrary.value[originalName];

    const seen = new Set<string>();
    let count = 0;

    // Count defined ports
    if (def && def.ports) {
        def.ports.forEach((p: any) => {
            seen.add(p.name);
            count++;
        });
    }

    // Count extra attributes not in definition
    if (attrs) {
        Object.keys(attrs).forEach(key => {
            if (key !== 'ID' && key !== 'name' && key !== '_uuid' && !seen.has(key)) {
                count++;
            }
        });
    }

    return count;
}

function getLayoutedElements(nodes: any[], edges: any[], direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  // Set explicit separation to avoid overlap in LR mode
  dagreGraph.setGraph({ 
      rankdir: direction,
      nodesep: 40, // Horizontal separation in TB, Vertical in LR
      ranksep: 60 // Vertical separation in TB, Horizontal in LR
  });

  nodes.forEach((node) => {
    let height = nodeHeight;
    let width = nodeWidth;

    if (showPorts.value) {
        const attrCount = countVisiblePorts(node);
        if (attrCount > 0) {
            height += 8; // Top margin for ports container
            height += attrCount * 32; // Per port item
            
            // Dynamic Width Calculation based on max line length
            // Heuristic: 7px per char + 20px padding + 20px label/input overhead
            // We need to check all keys + values length
            let maxLineLen = 0;
            const def = nodeLibrary.value[node.data.label] || nodeLibrary.value[node.data.originalName];
            
            // 1. Check definition ports
             if (def && def.ports) {
                def.ports.forEach((p: any) => {
                    const lineLen = (p.name || '').length + (p.default || '').length;
                    if (lineLen > maxLineLen) maxLineLen = lineLen;
                });
            }
            // 2. Check attributes
            if (node.data.attributes) {
                 Object.entries(node.data.attributes).forEach(([k, v]) => {
                     if (k !== 'ID' && k !== 'name' && k !== '_uuid') {
                         const lineLen = k.length + String(v).length;
                         if (lineLen > maxLineLen) maxLineLen = lineLen;
                     }
                 });
            }
            
            const estimatedWidth = (maxLineLen * 8) + 60; // 8px char width + padding
            if (estimatedWidth > width) {
                width = estimatedWidth;
            }
        }
    }
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    // Shift dagre center to top-left for Vue Flow
    node.targetPosition = direction === 'LR' ? Position.Left : Position.Top;
    node.sourcePosition = direction === 'LR' ? Position.Right : Position.Bottom;
    
    // We must use the calculated width/height from dagre, derived from our inputs
    const w = nodeWithPosition.width;
    const h = nodeWithPosition.height;
    
    node.position = { 
        x: nodeWithPosition.x - w / 2, 
        y: nodeWithPosition.y - h / 2 
    };
    
    // Store size in data if needed by custom node (optional, but handled by CSS mostly)
    // React Flow handles size via style width/height usually 
  });

  return { nodes, edges };

}

// Drag and Drop
// Drag and Drop
function handleNodeDragStop(event: any) {
    const draggedNode = event.node;
    if (!draggedNode) return;

    // Cache the new position
    if (draggedNode.data?.uuid) {
        userNodePositions.value.set(draggedNode.data.uuid, { ...draggedNode.position });
    } else if (draggedNode.data?.xmlId) {
        // Store a copy to avoid reactivity issues or object mutation
        userNodePositions.value.set(draggedNode.data.xmlId, { ...draggedNode.position });
    }

    // 1. Find Parent
    const parentEdge = edges.value.find((e: any) => e.target === draggedNode.id);
    if (!parentEdge) return; // Root node, ignore reorder for now

    const parentId = parentEdge.source;

    // 2. Find Siblings
    const siblingEdges = edges.value.filter((e: any) => e.source === parentId);
    const siblingIds = siblingEdges.map((e: any) => e.target);
    
    // 3. Get Nodes and Sort by X Position
    // We must use the OLD position for non-dragged nodes, but the NEW position for the dragged node.
    // The 'nodes.value' might not have updated the dragged node's position yet in the array reactive source? 
    // VueFlow usually updates 'draggedNode' (event.node) with latest pos.
    
    const siblingNodes = nodes.value.filter((n: any) => siblingIds.includes(n.id)).map((n: any) => {
        // If this is the dragged node, use the event's position
        if (n.id === draggedNode.id) {
             return { ...n, position: draggedNode.position };
        }
        return n;
    });
    
    // Sort logic: Left to Right (TB) or Top to Bottom (LR)
    if (layoutDirection.value === 'LR') {
        siblingNodes.sort((a: any, b: any) => a.position.y - b.position.y);
    } else {
        siblingNodes.sort((a: any, b: any) => a.position.x - b.position.x);
    }

    const newOrderIds = siblingNodes.map((n: any) => n.id);

    // 4. Send Message (Optimization: check if order changed? 
    // Ideally yes, but backend can also handle no-op. Let's send it.)
    vscode.postMessage({
        type: 'reorder_children',
        parentId: parentId,
        newOrder: newOrderIds
    });
}


function onDragStart(event: DragEvent, nodeType: string) {
  if (event.dataTransfer) {
    event.dataTransfer.setData('application/vueflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onDrop(event: DragEvent) {
  const nodeType = event.dataTransfer?.getData('application/vueflow');
  if (!nodeType) return;
  
  // 1. Calculate Drop Position
  const { left, top } = (document.querySelector('.vue-flow__pane') || document.body).getBoundingClientRect();
  const position = project({ 
      x: event.clientX - left, 
      y: event.clientY - top 
  });

  // 2. Generate ID (Frontend Side)
  // Match backend format: _tmp_Type_Timestamp_Random for transient IDs
  const id = `_tmp_${nodeType}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // 3. Cache Position Immediately
  userNodePositions.value.set(id, position); 
  // NOTE: 'id' here is the Transient ID _tmp_... which will become xmlId usually.
  // Actually, backend generates _uuid.
  // We can't know the _uuid yet.
  // But subsequent updates will replace this node with one from backend having _uuid.
  // The backend's new node will have clean _uuid.
  // This immediate cache might be lost on next update if we don't map it?
  // Actually, the new node from backend will NOT be in 'userNodePositions' yet.
  // But buildGraphRecursive will use 'oldPositions'.
  // We need to ensuring the newly added node finds its position.
  // The 'id' generated here usually matches the 'ID' attribute set by backend if we pass it?
  // Yes: this.handleAddNode(..., id) -> backend sets ID=id.
  
  // So 'userNodePositions' keyed by 'id' (XMLID) works for the FIRST render.
  // After that, we likely switch to UUID.
  // So we should keep setting it by ID here as fallback.

  // 4. Send to Backend
  vscode.postMessage({
    type: 'add_node',
    nodeType: nodeType,
    id: id // Pass the ID so backend uses it
  });
  console.log(`[DnD] Dropped node. Generated ID: ${id}, Position:`, position);
}

// Toggle Mode
function toggleMode() {
  currentMode.value = currentMode.value === 'editor' ? 'inspection' : 'editor';
  
  if (currentMode.value === 'editor') {
      // Clear all status/highlighting
      nodes.value.forEach((node: any) => {
          if (node.data && node.data.status) {
              // Create new data object to trigger reactivity if needed, or just assignment
              // node.data.status = undefined; // might not trigger deep watch
              node.data = { ...node.data, status: undefined, realStatus: undefined }; 
          }
      });
  }

  vscode.postMessage({
    type: 'switchMode',
    mode: currentMode.value
  });
}

onNodeDragStop((event) => {
    // 1. Update Position Cache
    event.nodes.forEach((node) => {
        // Use UUID for persistence if available, UNLESS expanded
        let id;
        if (node.data?.isExpanded) {
             id = node.id;
        } else {
             id = node.data?.uuid || node.data?.xmlId || node.id;
        }
        userNodePositions.value.set(id, { ...node.position });
        
        // 2. Trigger Reordering for Parent(s)
        const parentEdges = edges.value.filter((e) => e.target === node.id);
        const parentIds = new Set(parentEdges.map((e) => e.source));
        
        parentIds.forEach((parentId) => {
            reorderChildren(parentId);
        });
    });
});

function toggleLayout() {
  layoutDirection.value = layoutDirection.value === 'TB' ? 'LR' : 'TB';
  // Clear user positions when switching layout, as they are relative to the old layout
  userNodePositions.value.clear();
  
  const layout = getLayoutedElements(nodes.value, edges.value, layoutDirection.value);
  // Re-assign to trigger update
  nodes.value = [...layout.nodes];
  edges.value = [...layout.edges];
  
  setTimeout(() => fitView({ padding: 0.2 }), 50);
}

function loadLibrary() {
    vscode.postMessage({ type: 'loadLibrary' });
}

// Toggle Ports
function togglePorts() {
  showPorts.value = !showPorts.value;
  
  // Re-run layout to account for size changes
  const layout = getLayoutedElements(nodes.value, edges.value, layoutDirection.value);
  nodes.value = [...layout.nodes];
  edges.value = [...layout.edges];

  setTimeout(() => fitView({ padding: 0.2 }), 50);
}


// Global VS Code API
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const statusColors: Record<string, string> = {
    'IDLE': '#ffffff',
    'RUNNING': '#ffeb3b',
    'SUCCESS': '#4caf50',
    'FAILURE': '#f44336'
};

function handleStatusUpdate(data: any) {
    if (!data.event_log) return;

    data.event_log.forEach((event: any) => {
         // 1. Find candidates (Name/ID matching)
         const candidates = nodes.value.filter((n: any) => {
             // Check composite ID or internal ID
             if (n.id === event.node_name) return true;
             
             // Check XML ID (ID attribute)
             if (n.data?.xmlId === event.node_name) return true;
             
             // Check Label (often the Name for custom nodes)
             if (n.data?.label === event.node_name) return true;
             
             // Check explicit Name attribute
             // Some nodes like <Action ID="Move" name="MoveToGoal"> might log "MoveToGoal"
             if (n.data?.attributes?.name === event.node_name) return true;

             // Fallback: Check original tagName (rarely unique but sometimes logged)
             // ONLY if the node does not have a custom label/name that differentiates it.
             // If a node is named "ClearingActions" (type Sequence), it should NOT match "Sequence".
             if (n.data?.originalName === event.node_name) {
                 const currentLabel = n.data?.label || '';
                 const original = n.data?.originalName || '';
                 // Accept match only if label is generic (same as original or empty)
                 if (currentLabel === original || !currentLabel) {
                     return true;
                 }
             }
             
             return false;
         });

         // 2. Disambiguate by Previous Status (Best Effort)
         // Only update nodes that are in the expected 'previous' state.
         // Use realStatus (logical state) instead of visual status for correctness.
         const exactMatches = candidates.filter((n: any) => 
             (n.data?.realStatus || 'IDLE') === event.previous_status
         );

         // 3. Fallback: If no node matches the state transition (e.g. packet loss or first sync),
         // update ALL candidates to resync them. 
         // If we have exact matches, touch only them.
         const targets = exactMatches.length > 0 ? exactMatches : candidates;

         targets.forEach((node: any) => {
             const newData = {
                 ...node.data,
                 realStatus: event.current_status
             };

             // Visual Persistence & Blinking
             if (event.current_status !== 'IDLE') {
                 // Blink if re-triggering the same active status or just updating
                 // Actually, blink on ANY active update is good feedback
                 if (newData.status === event.current_status) {
                     newData.blink = true;
                     setTimeout(() => {
                         // We need to mutate the responsive object directly or re-assign
                         // Since we are in a loop, we can try to find the node again or just mutate if it's reactive
                         // But `newData` is a local object. We need to touch the node ref.
                         // Let's use a simpler approach: Set blink, then clear it.
                         // However, referencing `node` inside timeout is safe closure.
                         if (node.data) {
                             node.data = { ...node.data, blink: false };
                         }
                     }, 200);
                 }
                 newData.status = event.current_status;
             }

             node.data = newData;
         });
    });
}

// Handle Messages
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      parseXML(message.text);
      break;
    case 'status_update': 
      if (currentMode.value === 'inspection') {
        handleStatusUpdate(message.data);
      }
      break;
    case 'library_loaded':
      parseLibraryXML(message.xml);
      break;
  }
});


function onUpdateAttribute(payload: any) {
    const node = nodes.value.find((n: any) => n.id === payload.nodeId);
    const realId = node?.data?.uuid || payload.nodeId; // Use Composite ID if UUID missing
    
    vscode.postMessage({
        type: 'editAttribute',
        nodeId: realId,
        attr: payload.attr,
        value: payload.value
    });
}
</script>

<template>
  <div class="app-container">
    <div v-if="errorLog" style="color: red; padding: 20px; background: white; border: 1px solid red; z-index:9999; position:absolute;">
        CRITICAL ERROR: {{ errorLog }}
    </div>
    <div class="toolbar">
      <button @click="toggleMode">
        Mode: {{ currentMode === 'editor' ? 'Editor' : 'Inspection' }}
      </button>
      <button @click="toggleLayout">
        Layout: {{ layoutDirection === 'TB' ? 'Vertical' : 'Horizontal' }}
      </button>
      <button @click="togglePorts">
        {{ showPorts ? 'Hide Ports' : 'Show Ports' }}
      </button>
      <button @click="loadLibrary">
        Load Library
      </button>
      <div v-if="currentMode === 'inspection'" class="topic-config">
          <span class="topic-label">Topic:</span>
          <input 
            v-model="rosTopic" 
            class="topic-input" 
            @blur="updateTopic" 
            @keydown.enter="updateTopic" 
            placeholder="/behavior_tree_log" 
          />
      </div>
    </div>

    <div class="dnd-flow" @drop="onDrop" @dragover="onDragOver">
      <div class="sidebar" v-if="currentMode === 'editor'">
         <div class="description">Drag nodes to the pane</div>
         
         <div v-for="(nodes, group) in libraryGroups" :key="group">
            <div v-if="nodes.length > 0" class="group-title">{{ group }}</div>
            <div 
                v-for="nodeId in nodes" 
                :key="nodeId" 
                class="dndnode" 
                :class="group.toLowerCase() === 'control' ? 'input' : (group.toLowerCase() === 'condition' ? 'output' : (group.toLowerCase() === 'decorator' ? 'decorator' : 'default'))"
                draggable="true" 
                @dragstart="onDragStart($event, nodeId)"
            >
                {{ nodeId }}
            </div>
         </div>
      </div>
      <div class="flow-container">
          <VueFlow 
            v-model:nodes="nodes" 
            v-model:edges="edges" 
            :fit-view-on-init="true"
            :delete-key-code="currentMode === 'editor' ? ['Backspace', 'Delete'] : []"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            @node-context-menu="onNodeContextMenu"
            @edge-context-menu="onEdgeContextMenu"
            @node-click="onNodeClick"
            :default-viewport="{ x: 0, y: 0, zoom: 1 }"
            :min-zoom="0.2"
            :max-zoom="4"
            :nodes-draggable="currentMode === 'editor'"
            :nodes-connectable="currentMode === 'editor'"
            :elements-selectable="true"
            :edges-updatable="currentMode === 'editor'"
            :edges-focusable="currentMode === 'editor'"
          >
            <Background :pattern-color="'#aaa'" :gap="16" />
            <Controls />
            
            <template #node-custom="props">
              <CustomNode v-bind="props" :show-ports="showPorts" :definition="nodeLibrary[props.data.label] || nodeLibrary[props.data.originalName]" :is-editing="editingNodeId === props.id" @request-edit="onRequestEdit" @save-label="onSaveLabel" @cancel-edit="onCancelEdit" @update-attribute="onUpdateAttribute" />
            </template>
          </VueFlow>
      </div>
    </div>
    <ContextMenu 
        v-if="menu" 
        :x="menu.x" 
        :y="menu.y" 
        :type="menu.type" 
        :show-expand="showExpandMenu"
        @close="menu = null" 
        @delete="onDeleteFromMenu" 
        @rename="onRenameFromMenu"
        @expand="onExpandSubTree"
    />
  </div>
</template>

<style>
.app-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.toolbar {
  padding: 10px;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  display: flex;
  gap: 10px;
  align-items: center;
}
.topic-config {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto; /* Push to right */
    font-size: 12px;
}
.topic-label {
    font-weight: 500;
}
.topic-input {
    padding: 4px;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 2px;
    width: 200px;
}
.dnd-flow {
    display: flex;
    flex: 1;
    min-height: 0;
}
.sidebar {
    width: 200px;
    border-right: 1px solid var(--vscode-panel-border);
    padding: 10px;
    background: var(--vscode-sideBar-background);
    overflow-y: auto;
}
.dndnode {
    padding: 10px;
    margin-bottom: 5px;
    cursor: grab;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 6px;
    border: 1px solid transparent;
    font-weight: 500;
}
.group-title {
    font-size: 11px;
    text-transform: uppercase;
    color: #888;
    margin-top: 10px;
    margin-bottom: 4px;
    font-weight: 600;
}
.dndnode.input { /* Control equivalent */
    background: #e3f2fd;
    color: #1565c0;
    border-color: #2196f3;
}
.dndnode.default { /* Action equivalent */
    background: #e8f5e9;
    color: #2e7d32;
    border-color: #4caf50;
}
.dndnode.output { /* Condition equivalent */
    background: #fff3e0;
    color: #ef6c00;
    border-color: #ff9800;
}
.dndnode.decorator { /* Decorator equivalent */
    background: #f3e5f5;
    color: #7b1fa2;
    border-color: #9c27b0;
}
.flow-container {
  flex: 1;
}
</style>
