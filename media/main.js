const vscode = acquireVsCodeApi();

// --- State ---
let isVertical = true;
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

// --- Functions ---

function updateContent(text) {
    const container = document.getElementById('tree-container');
    container.innerHTML = '';
    document.getElementById('minimap').innerHTML = ''; // Clear minimap

    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const errorNode = xmlDoc.querySelector('parsererror');
    if (errorNode) {
        container.innerText = "Error parsing XML: " + errorNode.textContent;
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

    const data = parseXmlNode(rootXml);
    if (!data) return;

    // --- Index all BehaviorTrees ---
    treeDefinitions = {};
    const trees = xmlDoc.querySelectorAll('BehaviorTree');
    trees.forEach(tree => {
        const id = tree.getAttribute('ID');
        if (id) {
            treeDefinitions[id] = tree;
        }
    });

    initTree(data, container);
}

function parseXmlNode(xmlNode) {
    if (xmlNode.nodeType !== 1) return null;

    const node = {
        name: xmlNode.tagName,
        id: xmlNode.getAttribute('ID') || xmlNode.getAttribute('name') || '',
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
    zoomListener = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => {
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
    const nodeW = 140;
    const nodeH = 60;

    // Switch sizes based on layout
    const treeMap = d3.tree().nodeSize(isVertical ? [nodeW + 20, nodeH + 80] : [nodeH + 40, nodeW + 100]);
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
        .attr('height', nodeH)
        .attr('x', -nodeW / 2)
        .attr('y', -nodeH / 2)
        .style('opacity', 0); // Fade in

    // Icons
    nodeEnter.each(function (d) {
        const el = d3.select(this);
        let iconText = getIcon(d.data.name);
        if (iconText) {
            el.append("text")
                .attr("y", -15)
                .attr("class", "node-icon")
                .style("font-size", "16px")
                .style("fill", "#00bcd4")
                .text(iconText);
        }
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


    // Update Position
    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition().duration(duration)
        .attr('transform', d => {
            if (isVertical) return `translate(${d.x},${d.y})`;
            else return `translate(${d.y},${d.x})`;
        });

    nodeUpdate.select('rect')
        .style('stroke', d => d._children ? "#ff79c6" : null) // Highlight collapsed
        .style('opacity', 1);

    nodeUpdate.select('text').style("fill-opacity", 1);
    nodeUpdate.selectAll('text').style("fill-opacity", 1);


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

    const subTreeData = parseXmlNode(subTreeRootXml);

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

// Helper icons
function getIcon(name) {
    switch (name) {
        case "Sequence": return "→";
        case "Fallback": return "?";
        case "Parallel": return "⇉";
        case "Action": return "⚡";
        case "Condition": return "○";
        case "Decorator": return "◆";
        case "Control": return "❖";
        case "SubTree": return "📁";
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
