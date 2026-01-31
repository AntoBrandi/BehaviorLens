<script setup lang="ts">
import { ref } from 'vue';
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

// Vue Flow
const { onConnect, addEdges, onNodeDragStop, fitView, setNodes, setEdges, applyNodeChanges, applyEdgeChanges, removeNodes, removeEdges } = useVueFlow();
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

// Type Inference Logic
function getNodeType(tagName: string): string {
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
            node.position = userNodePositions.value.get(xmlId);
            return;
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
    return Object.keys(attributes).filter(k => k !== 'ID' && k !== 'name').length;
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
    const siblingNodes = nodes.value.filter((n: any) => siblingIds.includes(n.id));
    
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
  
  vscode.postMessage({
    type: 'add_node',
    nodeType: nodeType,
  });
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
    </div>

    <div class="dnd-flow" @drop="onDrop" @dragover="onDragOver">
      <div class="sidebar" v-if="currentMode === 'editor'">
         <div class="description">Drag nodes to the pane</div>
         <div class="dndnode input" draggable="true" @dragstart="onDragStart($event, 'Sequence')">Sequence</div>
         <div class="dndnode input" draggable="true" @dragstart="onDragStart($event, 'Fallback')">Fallback</div>
         <div class="dndnode default" draggable="true" @dragstart="onDragStart($event, 'Action')">Action</div>
         <div class="dndnode output" draggable="true" @dragstart="onDragStart($event, 'Condition')">Condition</div>
      </div>
      <div class="flow-container">
          <VueFlow 
            v-model:nodes="nodes" 
            v-model:edges="edges" 
            :fit-view-on-init="true"
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
                    @update-attribute="onUpdateAttribute"
                />
            </template>
            <Background />
            <Controls />
            <ContextMenu 
                v-if="menu" 
                :x="menu.x" 
                :y="menu.y" 
                :type="menu.type" 
                @close="menu = null" 
                @delete="onDeleteFromMenu" 
            />
          </VueFlow>
      </div>
    </div>
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
    height: 100%;
}
.sidebar {
    width: 200px;
    border-right: 1px solid var(--vscode-panel-border);
    padding: 10px;
    background: var(--vscode-sideBar-background);
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
.flow-container {
  flex: 1;
}
</style>
