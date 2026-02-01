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
const { onConnect, addEdges, onNodeDragStop, fitView, setNodes, setEdges, applyNodeChanges, applyEdgeChanges, removeNodes, removeEdges, project } = useVueFlow();
const nodes = ref([]);
const edges = ref([]);

// Change Handlers (Delete via Keyboard)
function onNodesChange(changes: any[]) {
    changes.forEach((change) => {
        if (change.type === 'remove') {
            vscode.postMessage({
                type: 'delete_node',
                id: change.id
            });
            // Clear from cache if deleted
            const node = nodes.value.find((n: any) => n.id === change.id);
            if (node?.data?.xmlId) {
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
                vscode.postMessage({
                    type: 'delete_edge',
                    targetId: edge.target
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
        removeNodes([menu.value.id]); 
    } else {
        removeEdges([menu.value.id]);
    }
    menu.value = null;
}

const editingNodeId = ref<string | null>(null);

function onRenameFromMenu() {
    if (!menu.value || menu.value.type !== 'node') return;
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
                id: payload.nodeId,
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
    editingNodeId.value = nodeId;
}

// Type Inference Logic
function getNodeType(tagName: string): string {
    // 1. Check Library first
    if (nodeLibrary.value[tagName]) {
        return nodeLibrary.value[tagName].type.toLowerCase();
    }

    // 2. Fallback
    const lower = tagName.toLowerCase();
    if (['sequence', 'fallback', 'parallel', 'reactivesequence', 'reactivefallback', 'switch2', 'switch3', 'switch4', 'if', 'while'].includes(lower)) {
        return 'control';
    }
    if (['inverter', 'forcesuccess', 'forcefailure', 'repeat', 'retry', 'timeout', 'delay', 'keeprunninguntilfailure', 'alwayssuccess', 'alwaysfailure'].includes(lower)) {
        return 'decorator';
    }
    // Heuristic: If it has "Condition" in name it's likely a condition
    if (tagName.includes('Condition')) {
        return 'condition';
    }
    // Default to Action
    return 'action';
}

function parseXML(text: string) {
    // Capture old positions before parsing
    const oldPositions = new Map<string, {x: number, y: number}>();
    nodes.value.forEach((n: any) => {
        if (n.data?.xmlId) {
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

    // Recursive Graph Builder
    function buildGraph(xmlNode: Element, currentPath: string, parentId: string | null) {
        if (xmlNode.nodeType !== 1) return;

        const internalId = currentPath; 
        const label = xmlNode.tagName;
        const name = xmlNode.getAttribute('name');
        const inferredType = getNodeType(label);

        newNodes.push({
            id: internalId,
            type: 'custom',
            label: name || label,
            data: { 
                label: name || label, 
                type: inferredType, 
                originalName: label,
                xmlId: xmlNode.getAttribute('ID'),
                attributes: getAttributes(xmlNode)
            },
            position: { x: 0, y: 0 } 
        });

        if (parentId) {
            newEdges.push({
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
                 buildGraph(child, `${currentPath}-${childIndex}`, internalId);
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
        // Visualize children of the Tree (skip visualizing the BehaviorTree node itself as a node)
        // But we must use correct paths: 0-k-childIndex
        let childIndex = 0;
        for (let i = 0; i < mainTree.children.length; i++) {
            const child = mainTree.children[i];
            if (child.nodeType === 1) {
                // Parent ID is null for top-level nodes ?? 
                // Or do we make them roots of the graph? Yes, parentId = null.
                buildGraph(child, `${mainTreePath}-${childIndex}`, null);
                childIndex++;
            }
        }
    }

    const layout = getLayoutedElements(newNodes, newEdges, layoutDirection.value);
    
    // Position Reconciliation
    layout.nodes.forEach((node: any) => {
        const xmlId = node.data.xmlId;
        // 1. If user explicitly moved it, use that position
        if (xmlId && userNodePositions.value.has(xmlId)) {
            console.log(`[Reconciliation] Found cached position for ${xmlId}:`, userNodePositions.value.get(xmlId));
            node.position = userNodePositions.value.get(xmlId);
            return;
        } else if (xmlId) {
             console.log(`[Reconciliation] No cached position for ${xmlId}. Cache keys:`, [...userNodePositions.value.keys()]);
        }

        // 2. If it's a detached node (root without incoming edges), stabilize it
        const isTarget = layout.edges.some((e: any) => e.target === node.id);
        if (!isTarget && xmlId) {
            // Check old positions to prevent jumping
            const oldPos = oldPositions.get(xmlId);
            if (oldPos) {
                 node.position = oldPos;
                 // Promote to user position so it sticks
                 userNodePositions.value.set(xmlId, oldPos);
            }
        }
    });

    nodes.value = layout.nodes;
    edges.value = layout.edges;
    
    if (isFirstLoad.value) {
        fitView();
        isFirstLoad.value = false;
    }
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


onConnect((params) => {
    addEdges({ ...params, type: 'default' });
    vscode.postMessage({
        type: 'reparent_node',
         // Backend expects: sourceId = Child (Node to move), targetId = Parent (Destination)
         // Vue Flow params: source = Parent, target = Child
        sourceId: params.target,
        targetId: params.source
    });
});

// Layout Graph
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 172;
const nodeHeight = 36;

// Helper to count visible attributes
function countAttributes(attributes: any) {
    if (!attributes) return 0;
    try {
        return Object.keys(attributes).filter(k => k !== 'ID' && k !== 'name').length;
    } catch (e) {
        console.error("Error counting attributes:", e);
        return 0;
    }
}

function getLayoutedElements(nodes: any[], edges: any[], direction = 'TB') {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    let height = nodeHeight;
    if (showPorts.value) {
        const attrCount = countAttributes(node.data.attributes);
        // Approx height per port (label + input + gap) ~ 30px? 
        // Style says 10px font, padding... let's say 28px per port to be safe
        if (attrCount > 0) {
            height += 8; // Top margin for ports container
            height += attrCount * 32; // Per port item
        }
    }
    dagreGraph.setNode(node.id, { width: nodeWidth, height: height });
  });
//...

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    // Shift dagre center to top-left for Vue Flow
    node.targetPosition = isHorizontal ? Position.Left : Position.Top;
    node.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;
    node.position = { 
        x: nodeWithPosition.x - nodeWidth / 2, 
        y: nodeWithPosition.y - nodeWithPosition.height / 2 
    };
  });

  return { nodes, edges };
}

// Drag and Drop
// Drag and Drop
function handleNodeDragStop(event: any) {
    const draggedNode = event.node;
    if (!draggedNode) return;

    // Cache the new position
    if (draggedNode.data?.xmlId) {
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
  vscode.postMessage({
    type: 'switchMode',
    mode: currentMode.value
  });
}

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
         const node = nodes.value.find((n: any) => n.id === event.node_name || n.data.originalName === event.node_name);
         if (node) {
             node.data = {
                 ...node.data,
                 status: event.current_status
             };
         }
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
    vscode.postMessage({
        type: 'editAttribute',
        nodeId: payload.nodeId,
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
            :delete-key-code="['Backspace', 'Delete']"
            @connect="onConnect" 
            @node-drag-stop="handleNodeDragStop"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            @node-context-menu="onNodeContextMenu"
            @edge-context-menu="onEdgeContextMenu"
          >
            <template #node-custom="props">
                <CustomNode 
                    :id="props.id"
                    :data="props.data" 
                    :source-position="props.sourcePosition" 
                    :target-position="props.targetPosition"
                    :show-ports="showPorts"
                    :definition="nodeLibrary[props.data.label] || nodeLibrary[props.data.originalName]"
                    :is-editing="editingNodeId === props.id"
                    @update-attribute="onUpdateAttribute"
                    @save-label="onSaveLabel"
                    @cancel-edit="onCancelEdit"
                    @request-edit="onRequestEdit"
                />
            </template>
            <Background />
            <Controls />

          </VueFlow>
      </div>
    </div>
    <ContextMenu 
        v-if="menu" 
        :x="menu.x" 
        :y="menu.y" 
        :type="menu.type" 
        @close="menu = null" 
        @delete="onDeleteFromMenu" 
        @rename="onRenameFromMenu"
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
