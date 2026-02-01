const vscode = acquireVsCodeApi();

// --- State ---
let isVertical = true;
let showPorts = false;
let rootData = null;
let treeDefinitions = {};
let svg, g, minimapSvg, minimapG;
let zoomListener;
let width, height;
let duration = 500; // transition duration

// --- Initialization ---
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            updateContent(message.text);
            break;
    }
});

document.getElementById('btn-layout').addEventListener('click', () => {
    isVertical = !isVertical;
    document.getElementById('btn-layout').innerText = isVertical ? "Layout: Vertical" : "Layout: Horizontal";
    if (rootData) {
        update(rootData);
        fitView();
        document.getElementById('minimap').innerHTML = '';
        initMinimap(rootData.data);
    }
});

document.getElementById('btn-fit').addEventListener('click', fitView);

document.getElementById('btn-ports').addEventListener('click', () => {
    showPorts = !showPorts;
    document.getElementById('btn-ports').innerText = showPorts ? "Hide Ports" : "Show Ports";
    if (rootData) {
        update(rootData);
    }
});

// --- Functions ---

function updateContent(text) {
    const container = document.getElementById('tree-container');

    // Parse XML first
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const errorNode = xmlDoc.querySelector('parsererror');
    if (errorNode) {
        container.innerHTML = "Error parsing XML: " + errorNode.textContent;
        return;
    }

    // --- Find Root (Respecting main_tree_to_execute) ---
    let rootXml = null;
    let mainTreeId = null;

    if (xmlDoc.documentElement.tagName === 'root') {
        const mainTreeAttr = xmlDoc.documentElement.getAttribute('main_tree_to_execute');
        if (mainTreeAttr) mainTreeId = mainTreeAttr;
    }

    if (mainTreeId) {
        rootXml = xmlDoc.querySelector(`BehaviorTree[ID="${mainTreeId}"]`);
    }

    if (!rootXml) {
        rootXml = xmlDoc.querySelector('BehaviorTree');
    }

    // Fallback logic
    if (!rootXml) {
        if (xmlDoc.documentElement.tagName !== 'root' && xmlDoc.documentElement.tagName !== 'BehaviorTree') {
            rootXml = xmlDoc.documentElement;
        } else if (xmlDoc.documentElement.tagName === 'BehaviorTree') {
            rootXml = xmlDoc.documentElement;
        }
    }

    if (!rootXml) {
        container.innerText = "No BehaviorTree found.";
        return;
    }

    // --- Index all BehaviorTrees ---
    treeDefinitions = {};
    const trees = xmlDoc.querySelectorAll('BehaviorTree');
    trees.forEach(tree => {
        const id = tree.getAttribute('ID');
        if (id) {
            treeDefinitions[id] = tree;
        }
    });

    // --- Compute Global Indices for Uniqueness ---
    const allElements = xmlDoc.querySelectorAll('*');
    const counts = {}; // key -> count

    allElements.forEach(el => {
        const key = el.getAttribute('name') || el.getAttribute('ID');
        if (key) {
            if (counts[key] === undefined) counts[key] = 0;
            el._occurrenceIndex = counts[key]; // Attach directly to DOM node
            counts[key]++;
        } else {
            el._occurrenceIndex = 0;
        }
    });

    const data = parseXmlNode(rootXml);
    if (!data) return;

    if (!rootData) {
        // Initial Load
        container.innerHTML = ''; // Start clean
        initTree(data, container);
    } else {
        // Soft Update
        const newRoot = d3.hierarchy(data);
        newRoot.x0 = rootData.x0; // inherit root pos
        newRoot.y0 = rootData.y0;

        syncState(rootData, newRoot);

        rootData = newRoot;
        update(rootData);
        // Minimap update
        document.getElementById('minimap').innerHTML = '';
        initMinimap(data);
    }
}

function syncState(oldNode, newNode) {
    // 1. Copy D3 internal State (Essential for smooth transitions)
    if (oldNode.x !== undefined) newNode.x0 = oldNode.x;
    if (oldNode.y !== undefined) newNode.y0 = oldNode.y;
    // Copy the internal D3 ID to ensure 'update' transition instead of 'enter'
    if (oldNode.id !== undefined) newNode.id = oldNode.id;

    // 2. Preserve Collapse State
    if (oldNode._children && !oldNode.children) {
        // Old node was collapsed.
        if (newNode.children) {
            newNode._children = newNode.children;
            newNode.children = null;
        }
    }

    // 3. Recurse to children
    const oldCh = oldNode.children || oldNode._children || [];
    const newCh = newNode.children || newNode._children || []; // newNode starts expanded (children is set)

    // We assume structure is mostly preserved during attribute edits.
    // Matching by index is often safer than IDs for non-unique or missing IDs (like Sequence nodes)
    // especially since 'updateContent' is called on text edit which usually preserves order.

    // To be more robust: Match by ID if BOTH have ID. Else match by index.
    // But since we have the "non-unique ID" issue, Index might effectively be better for this tree structure.

    // Keep track of which old children have been matched to avoid double usage
    const matchedOldIndices = new Set();

    for (let i = 0; i < newCh.length; i++) {
        const newC = newCh[i];
        let foundIndex = -1;

        // 1. Try to match by explicit ID
        if (newC.data.id) {
            foundIndex = oldCh.findIndex((oldC, idx) =>
                !matchedOldIndices.has(idx) && oldC.data.id === newC.data.id
            );
        }

        // 2. Fallback: Try to match by Name (greedy, in order)
        // This handles the case where we just have a list of similar nodes (e.g. Sequence)
        // and identifying them by name is the best we can do.
        if (foundIndex === -1 && newC.data.name) {
            foundIndex = oldCh.findIndex((oldC, idx) =>
                !matchedOldIndices.has(idx) && oldC.data.name === newC.data.name
            );
        }

        if (foundIndex !== -1) {
            matchedOldIndices.add(foundIndex);
            syncState(oldCh[foundIndex], newC);
        }
    }
}

function parseXmlNode(xmlNode) {
    if (xmlNode.nodeType !== 1) return null;

    const node = {
        name: xmlNode.tagName,
        id: xmlNode.getAttribute('name') || xmlNode.getAttribute('ID') || '',
        occurrenceIndex: xmlNode._occurrenceIndex !== undefined ? xmlNode._occurrenceIndex : 0,
        attributes: {},
        children: []
    };

    for (let i = 0; i < xmlNode.attributes.length; i++) {
        const attr = xmlNode.attributes[i];
        node.attributes[attr.name] = attr.value;
    }

    for (let i = 0; i < xmlNode.children.length; i++) {
        const child = parseXmlNode(xmlNode.children[i]);
        if (child) {
            node.children.push(child);
        }
    }
    return node;
}

function initTree(data, container) {
    width = container.clientWidth;
    height = container.clientHeight;

    // Zoom behavior
    zoomListener = d3.zoom()
        .scaleExtent([0.1, 4])
        .filter(function (event) {
            // Check if valid target for zoom (ignore inputs)
            return !event.target.tagName.match(/^input|textarea|select|option/i) && !event.button;
        })
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            updateMinimapRect(event.transform);
        });

    svg = d3.select(container).append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(zoomListener)
        .on("dblclick.zoom", null); // Disable double click zoom

    g = svg.append("g");

    // Initialize Root
    rootData = d3.hierarchy(data);
    rootData.x0 = height / 2;
    rootData.y0 = 0;

    // Collapse helper (optional: initially collapse deep levels?)
    // rootData.children.forEach(collapse);

    update(rootData);
    initMinimap(data);
    fitView();
}

function update(source) {
    // Layout config
    const baseNodeH = 70;
    const baseNodeW = 140;

    // --- Pre-calculate dimensions ---
    // We want the tree to be responsive to the content.
    // Calculate max width needed for ports across all visible nodes to set a standard width, 
    // OR calculate per-node width. D3 Tree loves fixed or uniform-ish sizing for collision.
    // Let's find the max width required by any node currently visible.

    let maxTextW = baseNodeW;
    let maxPortsCount = 0;

    rootData.descendants().forEach(d => {
        // Name width (approx)
        const nameLen = (d.data.name || "").length * 9;
        const idLen = (d.data.id || "").length * 7;
        let w = Math.max(nameLen, idLen, baseNodeW);

        // Ports width
        if (showPorts && d.data.attributes) {
            let pCount = 0;
            // Inputs take space, let's assume a min width for good UX
            const minPortW = 180;
            if (Object.keys(d.data.attributes).length > 2) w = Math.max(w, minPortW);

            for (const [key, value] of Object.entries(d.data.attributes)) {
                if (key === 'ID' || key === 'name') continue;
                // Calculate rough width: Label + Input
                const labelLen = key.length * 7;
                const valueLen = value.length * 7;
                // We want input to be editable, so give it some room
                const rowWidth = labelLen + Math.max(valueLen, 50) + 40;
                w = Math.max(w, rowWidth);
                pCount++;
            }
            maxPortsCount = Math.max(maxPortsCount, pCount);
        }

        maxTextW = Math.max(maxTextW, w);
    });

    const nodeW = maxTextW;
    // Max Height needed
    const portRowHeight = 22; // Slightly taller for input
    const maxNodeH = showPorts ? baseNodeH + (maxPortsCount * portRowHeight) + 10 : baseNodeH;

    // Switch sizes based on layout
    const treeMap = d3.tree().nodeSize(isVertical ? [nodeW + 40, maxNodeH + 60] : [maxNodeH + 40, nodeW + 100]);
    const treeData = treeMap(rootData);

    const nodes = treeData.descendants();
    const links = treeData.links();

    // --- Transitions ---

    // Normalize properties for fixed depth if needed
    // nodes.forEach(d => { d.y = d.depth * 100; });

    // 1. Nodes
    const node = g.selectAll('g.node')
        .data(nodes, d => d.id || (d.id = ++i)); // Using internal ID if no data ID unique enough

    const nodeEnter = node.enter().append('g')
        .attr('class', d => "node " + d.data.name)
        .attr('transform', d => {
            if (isVertical) return `translate(${source.x0},${source.y0})`;
            else return `translate(${source.y0},${source.x0})`;
        })
        .on('click', click);

    // Node Rect
    nodeEnter.append('rect')
        .attr('width', nodeW)
        // Height will be updated in merge, start small
        .attr('height', baseNodeH)
        .attr('x', -nodeW / 2)
        .attr('y', -35) // Fixed top centering relative to link

        .style('opacity', 0); // Fade in

    // Icons
    nodeEnter.each(function (d) {
        const el = d3.select(this);
        // Infer Type
        const numChildren = (d.data.children || []).length;
        // If it has hidden children in _children, it's definitely a parent (Control/Decorator)
        // But d.data.children might be the parsed XML children? 
        // d.data.children is populated in parseXmlNode. 
        // d.children and d._children are D3 properties.
        // Let's use d.data.children.length to be safe about "is it a leaf in the text" vs "is it collapsed".
        const dataChildrenCount = (d.data.children && d.data.children.length) || 0;

        const type = getNodeType(d.data.name, dataChildrenCount);
        d.data._type = type; // Store for usage in rect styling matching

        let iconText = getIcon(d.data.name, type);
        if (iconText) {
            el.append("text")
                .attr("y", -15)
                .attr("class", "node-icon")
                .style("font-size", "16px")
                .style("fill", "#00bcd4")
                .text(iconText);
        }

        // Add type class for CSS styling
        d3.select(this).classed(type, true);
    });

    // Text Name
    nodeEnter.append('text')
        .attr("dy", "0.31em")
        .attr("class", "node-name")
        .text(d => d.data.name)
        .style("fill-opacity", 0);

    // Text Type/ID
    nodeEnter.append('text')
        .attr("dy", "1.5em")
        .attr("class", "node-type")
        .text(d => d.data.id ? d.data.id : "")
        .style("fill-opacity", 0);

    // Ports (Initial)
    nodeEnter.each(function (d) {
        if (!showPorts) return;
        renderPorts(d3.select(this), d, nodeW);
    });


    // Update Position
    const nodeUpdate = nodeEnter.merge(node);

    // Update classes (in case node type changed?? unlikely dynamic, but good practice)
    nodeUpdate.each(function (d) {
        if (d.data._type) d3.select(this).classed(d.data._type, true);
    });

    nodeUpdate.transition().duration(duration)
        .attr('transform', d => {
            if (isVertical) return `translate(${d.x},${d.y})`;
            else return `translate(${d.y},${d.x})`;
        });

    nodeUpdate.select('rect').transition().duration(duration)
        .attr('width', nodeW) // Update width on transition
        .attr('x', -nodeW / 2) // Update x centering
        .attr('height', d => {
            if (!showPorts) return baseNodeH;
            let count = 0;
            if (d.data.attributes) {
                for (const k in d.data.attributes) {
                    if (k !== 'ID' && k !== 'name') count++;
                }
            }
            return count > 0 ? baseNodeH + (count * 22) + 10 : baseNodeH;
        })
        .attr('y', d => {
            return -35; // Keep fixed top relative to link connection
        })
        .style('stroke', d => d._children ? "#ff79c6" : null) // Highlight collapsed
        .style('opacity', 1);

    nodeUpdate.select('text').style("fill-opacity", 1);
    nodeUpdate.selectAll('text').style("fill-opacity", 1);

    // Update ports visibility
    // nodeUpdate.selectAll('.node-port').style("fill-opacity", showPorts ? 1 : 0); // Removed as foreignObject is used

    nodeUpdate.selectAll('.node-port-fo').remove();

    // Re-append ports
    nodeUpdate.each(function (d) {
        if (!showPorts) return;
        renderPorts(d3.select(this), d, nodeW);
    });


    // Exit
    const nodeExit = node.exit().transition().duration(duration)
        .attr('transform', d => {
            if (isVertical) return `translate(${source.x},${source.y})`;
            else return `translate(${source.y},${source.x})`;
        })
        .remove();

    nodeExit.select('rect').style('opacity', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    // 2. Links
    const link = g.selectAll('path.link')
        .data(links, d => d.target.id);

    // Enter
    const linkEnter = link.enter().insert('path', "g")
        .attr("class", "link")
        .attr('d', d => {
            const o = { x: source.x0, y: source.y0 };
            return diagonal(o, o);
        });

    // Update
    const linkUpdate = linkEnter.merge(link);
    linkUpdate.transition().duration(duration)
        .attr('d', d => diagonal(d.source, d.target));

    // Exit
    link.exit().transition().duration(duration)
        .attr('d', d => {
            const o = { x: source.x, y: source.y };
            return diagonal(o, o);
        })
        .remove();


    // Stash old positions
    nodes.forEach(d => {
        d.x0 = d.x;
        d.y0 = d.y;
    });
}

function renderPorts(el, d, nodeW) {
    const params = d.data.attributes;
    let count = 0;
    const itemHeight = 22;
    // Start y below text
    const startY = 30;

    for (const [key, value] of Object.entries(params)) {
        if (key === 'ID' || key === 'name') continue;

        const fo = el.append("foreignObject")
            .attr("class", "node-port-fo")
            .attr("x", -nodeW / 2 + 10)
            .attr("y", startY + (count * itemHeight))
            .attr("width", nodeW - 20)
            .attr("height", 20); // slightly less than row height

        const div = fo.append("xhtml:div")
            .attr("class", "port-container");

        div.append("span")
            .attr("class", "port-label")
            .text(key + ": ");

        const input = div.append("input")
            .attr("class", "port-input")
            .attr("value", value)
            .on("change", function (event) {
                // Post message
                // We need to stop propagation to prevent zoom logic from messing up??
                // Actually D3 zoom is on SVG, input events usually bubble.
                // But we want to handle the change.
                const newValue = this.value; // 'this' is input
                vscode.postMessage({
                    type: 'editAttribute',
                    nodeId: d.data.id,
                    occurrenceIndex: d.data.occurrenceIndex,
                    attr: key,
                    value: newValue
                });
            })
            .on("dblclick", (e) => e.stopPropagation()) // Prevent header-like double click behavior
            .on("mousedown", (e) => e.stopPropagation()) // Allow text selection without dragging map
            // Stop key propagation to prevent VS Code / D3 interference
            .on("keydown", function (e) {
                if (e.key === 'Enter') {
                    this.blur(); // Commit change
                }
                e.stopPropagation();
            })
            .on("keypress", (e) => e.stopPropagation())
            .on("keyup", (e) => e.stopPropagation())
            .on("click", (e) => e.stopPropagation());

        count++;
    }
}



// Custom diagonal generator
function diagonal(s, d) {
    if (isVertical) {
        return `M ${s.x} ${s.y}
                C ${s.x} ${(s.y + d.y) / 2},
                  ${d.x} ${(s.y + d.y) / 2},
                  ${d.x} ${d.y}`;
    } else {
        return `M ${s.y} ${s.x}
                C ${(s.y + d.y) / 2} ${s.x},
                  ${(s.y + d.y) / 2} ${d.x},
                  ${d.y} ${d.x}`;
    }
}

// Toggle Children on Click
function click(event, d) {
    if (d.data.name === 'SubTree' && !d.children && !d._children) {
        // Try to expand SubTree
        expandSubTree(d);
        return;
    }

    if (d.children) {
        d._children = d.children;
        d.children = null;
    } else {
        d.children = d._children;
        d._children = null;
    }
    update(d);
    // Refresh minimap to reflect collapse/expand state if using rootData layout.
    // Since initMinimap uses raw data, it might not reflect collapse state unless we pass layout hierarchy.
    // However, for consistency with the requested feature (expansion), we ensure it's called.
    // Note: initMinimap currently builds off raw 'data', so standard collapse/expand (which just hides children in d3) 
    // might not be reflected in minimap unless we change initMinimap to use d3.hierarchy state or similar.
    // But the user specifically asked about "expanding a subtree" which adds new data.
    if (rootData) updateMinimap(rootData);
}

function expandSubTree(d) {
    const subTreeId = d.data.id;
    if (!subTreeId || !treeDefinitions[subTreeId]) {
        console.warn("SubTree definition not found:", subTreeId);
        return;
    }

    // Parse the referenced tree
    const subTreeRootXml = treeDefinitions[subTreeId].querySelector(':scope > *'); // First child of <BehaviorTree> (e.g. Sequence)
    if (!subTreeRootXml) return;

    // We need indices for the subtree too? 
    // The subtree nodes are part of the main doc, so they were indexed in the initial pass?
    // YES, querySelectorAll('*') covered them.
    // BUT we need access to that indexMap here. 
    // `treeDefinitions` holds raw XML nodes. We can re-calculate or better, attach index to xmlNode directly in the first pass?
    // JS Objects are extensible.

    // Quick fix: re-calculate or just attach `_index` property to DOM nodes in the initial pass.
    // Let's modify the initial pass to attach `_occurrenceIndex` to the Element object itself.
    // Wait, modify `parseXmlNode` to read from property if map missing?

    // Actually, `parseXmlNode` relies on `indexMap`. We don't have it here.
    // Let's rely on attached property.

    const subTreeData = parseXmlNode(subTreeRootXml); // Will fail to get index if map missing.

    // REVISIT: For now, SubTree expansion might lose edit capability if we don't fix this.
    // Let's attach to XML node.

    // Create hierarchy for new data
    const newNodes = d3.hierarchy(subTreeData);
    newNodes.parent = d;
    // newNodes.depth and height are handled in the loop below


    // Fix depths of all descendants
    newNodes.descendants().forEach(desc => {
        desc.depth = desc.depth + d.depth + 1;
        // desc.parent logic handled by d3.hierarchy BUT we are splicing it in
    });

    // Assign as child
    d.children = [newNodes];
    d.data.children = [subTreeData]; // Keep data consistent

    update(d);
    updateMinimap(rootData);
}

function updateMinimap(data) {
    // Re-initialize minimap with current data structure
    document.getElementById('minimap').innerHTML = '';

    // We need to clone the current layout hierarchy to respect 'collapsed' state.
    // D3's 'hierarchy' from raw data doesn't know about collapsed nodes (stored in _children).
    // So we manually rebuild a hierarchy based on the VISIBLE children of the current rootData.
    const visibleData = copyVisibleHierarchy(rootData);
    initMinimap(visibleData);
}

function copyVisibleHierarchy(source) {
    // Determine children: if 'children' is null/undefined, it's a leaf OR collapsed.
    // If 'children' exists, it's expanded.
    // We create a simple object structure that d3.hierarchy can consume.
    const node = {
        name: source.data.name,
        id: source.data.id || source.id,
        children: []
    };

    if (source.children) {
        node.children = source.children.map(child => copyVisibleHierarchy(child));
    }

    return node;
}

// --- Node Types and Icons ---

const CONTROLS = new Set([
    'Sequence', 'Fallback', 'Parallel', 'ReactiveSequence', 'ReactiveFallback',
    'SequenceStar', 'FallbackStar', 'IfThenElse', 'WhileDo', 'Switch2', 'Switch3', 'Switch4', 'Switch5', 'Switch6'
]);

const DECORATORS = new Set([
    'Inverter', 'ForceSuccess', 'ForceFailure', 'Repeat', 'RetryUntilSuccessful', 'KeepRunningUntilFailure',
    'Delay', 'TimeLimit', 'BlackboardCheckDecorator', 'SubTree', 'Root' // SubTree behaves like a decorator/leaf technically
]);

// Helper to determine node type
function getNodeType(name, childCount) {
    if (CONTROLS.has(name)) return "Control";
    if (DECORATORS.has(name)) return "Decorator";
    if (name.endsWith("Action")) return "Action"; // Common convention
    if (name.endsWith("Condition")) return "Condition"; // Common convention

    // Heuristics
    if (childCount > 0) return "Control";
    return "Action"; // Default leaf is action
}

// Helper icons
function getIcon(name, type) {
    // Specific Overrides
    switch (name) {
        case "Sequence": return "→";
        case "Fallback": return "?";
        case "Parallel": return "⇉";
        case "ReactiveSequence": return "R→";
        case "ReactiveFallback": return "R?";
        case "Inverter": return "!";
        case "ForceSuccess": return "✓";
        case "ForceFailure": return "✕";
        case "SubTree": return "📁";
    }

    // Generic by Type
    switch (type) {
        case "Control": return "❖";
        case "Decorator": return "◆";
        case "Condition": return "○";
        case "Action": return "⚡";
        default: return "";
    }
}

// Global ID counter
let i = 0;

// Fit View
function fitView() {
    if (!g || !rootData) return;
    // Simple reset for now, ideally calculate bounding box
    svg.transition().duration(750).call(zoomListener.transform, d3.zoomIdentity.translate(width / 2, 50).scale(1));
}

// --- Minimap ---
function initMinimap(data) {
    const container = document.getElementById('minimap');
    const w = 200, h = 150;

    minimapSvg = d3.select(container).append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${w} ${h}`);

    minimapG = minimapSvg.append("g");

    // Render static simplified tree
    const root = d3.hierarchy(data);

    // Switch size args based on layout
    const tree = d3.tree().size(isVertical ? [w - 20, h - 20] : [h - 20, w - 20]);
    tree(root);

    // Links
    const linkGen = isVertical
        ? d3.linkVertical().x(d => d.x + 10).y(d => d.y + 10)
        : d3.linkHorizontal().x(d => d.y + 10).y(d => d.x + 10);

    minimapG.selectAll(".link")
        .data(root.links())
        .enter().append("path")
        .attr("class", "link")
        .style("stroke-width", "1px")
        .attr("d", linkGen);

    // Nodes (Dots)
    minimapG.selectAll(".node")
        .data(root.descendants())
        .enter().append("circle")
        .attr("r", 2)
        .attr("fill", "#00bcd4")
        .attr("cx", d => (isVertical ? d.x : d.y) + 10)
        .attr("cy", d => (isVertical ? d.y : d.x) + 10);

    // Viewport Rect (Optional: logic to update this rect based on zoom)
    // For MVP, just static map
}

function updateMinimapRect(transform) {
    // TODO: Implement viewport rectangle tracking
}
