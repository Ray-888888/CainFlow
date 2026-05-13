/**
 * Arranges selected nodes, or all nodes when there is no selection, into a tidy
 * left-to-right workflow layout.
 */
export function createNodeAutoLayoutApi({
    state,
    pushHistory,
    updateAllConnections,
    scheduleSave,
    showToast
}) {
    const GRID_SIZE = 20;
    const COLUMN_GAP = 160;
    const ROW_GAP = 72;
    const COMPONENT_GAP = 140;
    const FALLBACK_NODE_WIDTH = 280;
    const FALLBACK_NODE_HEIGHT = 180;
    const RELAXATION_PASSES = 6;
    const PORT_ORDER_WEIGHT = 0.08;
    const FALLBACK_PORT_TOP = 58;
    const FALLBACK_PORT_GAP = 26;

    function snap(value) {
        return Math.round(value / GRID_SIZE) * GRID_SIZE;
    }

    function getNodeSize(node) {
        return {
            width: Number(node.width) > 0 ? Number(node.width) : (node.el?.offsetWidth || FALLBACK_NODE_WIDTH),
            height: Number(node.height) > 0 ? Number(node.height) : (node.el?.offsetHeight || FALLBACK_NODE_HEIGHT)
        };
    }

    function getTargetNodeIds() {
        const selectedIds = Array.from(state.selectedNodes).filter((id) => state.nodes.has(id));
        return selectedIds.length > 0 ? selectedIds : Array.from(state.nodes.keys());
    }

    function isNodeRunning(nodeId) {
        return state.runningNodeIds?.has(nodeId) || state.nodes.get(nodeId)?.el?.classList.contains('running');
    }

    function compareByCurrentPosition(a, b) {
        const nodeA = state.nodes.get(a);
        const nodeB = state.nodes.get(b);
        if (!nodeA || !nodeB) return 0;
        return (nodeA.x - nodeB.x) || (nodeA.y - nodeB.y) || a.localeCompare(b);
    }

    function getLayoutAnchor(nodeIds) {
        let minX = Infinity;
        let minY = Infinity;
        nodeIds.forEach((id) => {
            const node = state.nodes.get(id);
            if (!node) return;
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
        });
        return {
            x: snap(Number.isFinite(minX) ? minX : 0),
            y: snap(Number.isFinite(minY) ? minY : 0)
        };
    }

    function buildGraph(nodeIds) {
        const targetSet = new Set(nodeIds);
        const incomingCount = new Map(nodeIds.map((id) => [id, 0]));
        const incoming = new Map(nodeIds.map((id) => [id, []]));
        const outgoing = new Map(nodeIds.map((id) => [id, []]));
        const incomingEdges = new Map(nodeIds.map((id) => [id, []]));
        const outgoingEdges = new Map(nodeIds.map((id) => [id, []]));

        state.connections.forEach((connection) => {
            const fromId = connection.from?.nodeId;
            const toId = connection.to?.nodeId;
            if (!targetSet.has(fromId) || !targetSet.has(toId) || fromId === toId) return;

            outgoing.get(fromId)?.push(toId);
            incoming.get(toId)?.push(fromId);
            outgoingEdges.get(fromId)?.push(connection);
            incomingEdges.get(toId)?.push(connection);
            incomingCount.set(toId, (incomingCount.get(toId) || 0) + 1);
        });

        outgoing.forEach((targets) => targets.sort(compareByCurrentPosition));
        incoming.forEach((sources) => sources.sort(compareByCurrentPosition));
        outgoingEdges.forEach((connections) => connections.sort(compareConnectionsByTargetPort));
        incomingEdges.forEach((connections) => connections.sort(compareConnectionsBySourcePort));

        return { incomingCount, incoming, outgoing, incomingEdges, outgoingEdges };
    }

    function getPortElements(nodeId, direction) {
        const node = state.nodes.get(nodeId);
        if (typeof node?.el?.querySelectorAll !== 'function') return [];
        return Array.from(node.el.querySelectorAll(`.node-port[data-direction="${direction}"]`));
    }

    function getPortOrder(nodeId, portName, direction) {
        const ports = getPortElements(nodeId, direction);
        const index = ports.findIndex((portEl) => portEl.dataset.port === portName);
        return index >= 0 ? index : ports.length;
    }

    function getPortRelativeY(nodeId, portName, direction) {
        const node = state.nodes.get(nodeId);
        const portEl = typeof node?.el?.querySelector === 'function'
            ? node.el.querySelector(`.node-port[data-port="${portName}"][data-direction="${direction}"]`)
            : null;
        const dot = portEl?.querySelector('.port-dot');
        const zoom = Number(state.canvas?.zoom) > 0 ? Number(state.canvas.zoom) : 1;

        if (node?.el && dot?.getBoundingClientRect) {
            const nodeRect = node.el.getBoundingClientRect();
            const dotRect = dot.getBoundingClientRect();
            const relativeY = (dotRect.top + dotRect.height / 2 - nodeRect.top) / zoom;
            if (Number.isFinite(relativeY) && relativeY >= 0) return relativeY;
        }

        return FALLBACK_PORT_TOP + getPortOrder(nodeId, portName, direction) * FALLBACK_PORT_GAP;
    }

    function compareConnectionsByTargetPort(a, b) {
        const toIdA = a.to?.nodeId || '';
        const toIdB = b.to?.nodeId || '';
        const targetCompare = compareByCurrentPosition(toIdA, toIdB);
        if (targetCompare !== 0) return targetCompare;
        return (getPortOrder(toIdA, a.to?.port, 'input') - getPortOrder(toIdB, b.to?.port, 'input')) ||
            (getPortOrder(a.from?.nodeId, a.from?.port, 'output') - getPortOrder(b.from?.nodeId, b.from?.port, 'output')) ||
            (a.id || '').localeCompare(b.id || '');
    }

    function compareConnectionsBySourcePort(a, b) {
        const fromIdA = a.from?.nodeId || '';
        const fromIdB = b.from?.nodeId || '';
        const sourceCompare = compareByCurrentPosition(fromIdA, fromIdB);
        if (sourceCompare !== 0) return sourceCompare;
        return (getPortOrder(fromIdA, a.from?.port, 'output') - getPortOrder(fromIdB, b.from?.port, 'output')) ||
            (getPortOrder(a.to?.nodeId, a.to?.port, 'input') - getPortOrder(b.to?.nodeId, b.to?.port, 'input')) ||
            (a.id || '').localeCompare(b.id || '');
    }

    function assignLayers(nodeIds, graph = buildGraph(nodeIds)) {
        const incomingCount = new Map(graph.incomingCount);
        const { outgoing } = graph;
        const queue = nodeIds
            .filter((id) => incomingCount.get(id) === 0)
            .sort(compareByCurrentPosition);
        const layers = new Map(nodeIds.map((id) => [id, 0]));
        const processed = new Set();

        while (queue.length > 0) {
            const id = queue.shift();
            processed.add(id);

            outgoing.get(id)?.forEach((targetId) => {
                layers.set(targetId, Math.max(layers.get(targetId) || 0, (layers.get(id) || 0) + 1));
                incomingCount.set(targetId, incomingCount.get(targetId) - 1);
                if (incomingCount.get(targetId) === 0) {
                    queue.push(targetId);
                    queue.sort(compareByCurrentPosition);
                }
            });
        }

        // Cycles cannot be fully topologically sorted; keep them tidy by current x order.
        nodeIds
            .filter((id) => !processed.has(id))
            .sort(compareByCurrentPosition)
            .forEach((id, index) => {
                layers.set(id, Math.max(layers.get(id) || 0, index));
            });

        return layers;
    }

    function getGridColumnCount(nodeIds) {
        return Math.max(1, Math.ceil(Math.sqrt(nodeIds.length)));
    }

    function calculateBounds(positions, nodeIds) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        nodeIds.forEach((id) => {
            const position = positions.get(id);
            const node = state.nodes.get(id);
            if (!position || !node) return;
            const size = getNodeSize(node);
            minX = Math.min(minX, position.x);
            minY = Math.min(minY, position.y);
            maxX = Math.max(maxX, position.x + size.width);
            maxY = Math.max(maxY, position.y + size.height);
        });

        return {
            minX: Number.isFinite(minX) ? minX : 0,
            minY: Number.isFinite(minY) ? minY : 0,
            maxX: Number.isFinite(maxX) ? maxX : 0,
            maxY: Number.isFinite(maxY) ? maxY : 0,
            width: Number.isFinite(maxX - minX) ? maxX - minX : 0,
            height: Number.isFinite(maxY - minY) ? maxY - minY : 0
        };
    }

    function translatePositions(positions, dx, dy) {
        const translated = new Map();
        positions.forEach((position, id) => {
            translated.set(id, {
                x: snap(position.x + dx),
                y: snap(position.y + dy)
            });
        });
        return translated;
    }

    function layoutGrid(nodeIds) {
        const columns = getGridColumnCount(nodeIds);
        const sortedIds = [...nodeIds].sort(compareByCurrentPosition);
        const columnWidths = Array(columns).fill(FALLBACK_NODE_WIDTH);
        const rowHeights = [];

        sortedIds.forEach((id, index) => {
            const size = getNodeSize(state.nodes.get(id));
            const column = index % columns;
            const row = Math.floor(index / columns);
            columnWidths[column] = Math.max(columnWidths[column], size.width);
            rowHeights[row] = Math.max(rowHeights[row] || FALLBACK_NODE_HEIGHT, size.height);
        });

        const columnX = [];
        columnWidths.forEach((width, index) => {
            columnX[index] = index === 0 ? 0 : columnX[index - 1] + columnWidths[index - 1] + COLUMN_GAP;
        });
        const rowY = [];
        rowHeights.forEach((height, index) => {
            rowY[index] = index === 0 ? 0 : rowY[index - 1] + rowHeights[index - 1] + ROW_GAP;
        });

        return new Map(sortedIds.map((id, index) => [
            id,
            {
                x: snap(columnX[index % columns]),
                y: snap(rowY[Math.floor(index / columns)])
            }
        ]));
    }

    function groupByLayer(nodeIds, layers) {
        const grouped = new Map();
        let minLayer = Infinity;
        nodeIds.forEach((id) => {
            const layer = layers.get(id) || 0;
            minLayer = Math.min(minLayer, layer);
            if (!grouped.has(layer)) grouped.set(layer, []);
            grouped.get(layer).push(id);
        });

        const normalized = new Map();
        grouped.forEach((ids, layer) => {
            normalized.set(layer - minLayer, ids.sort(compareByCurrentPosition));
        });
        return normalized;
    }

    function calculateLayerOrders(grouped, graph) {
        const orderedLayers = Array.from(grouped.keys()).sort((a, b) => a - b);
        const orders = new Map(orderedLayers.map((layer) => [layer, [...grouped.get(layer)]]));
        const indexById = new Map();

        function refreshIndexes() {
            indexById.clear();
            orders.forEach((ids) => {
                ids.forEach((id, index) => indexById.set(id, index));
            });
        }

        function getIncomingEdgeWeight(edge) {
            const sourceId = edge.from?.nodeId;
            const sourceIndex = indexById.get(sourceId);
            if (sourceIndex === undefined) return null;
            return sourceIndex +
                getPortOrder(sourceId, edge.from?.port, 'output') * PORT_ORDER_WEIGHT +
                getPortOrder(edge.to?.nodeId, edge.to?.port, 'input') * PORT_ORDER_WEIGHT * 0.1;
        }

        function getOutgoingEdgeWeight(edge) {
            const targetId = edge.to?.nodeId;
            const targetIndex = indexById.get(targetId);
            if (targetIndex === undefined) return null;
            return targetIndex +
                getPortOrder(targetId, edge.to?.port, 'input') * PORT_ORDER_WEIGHT +
                getPortOrder(edge.from?.nodeId, edge.from?.port, 'output') * PORT_ORDER_WEIGHT * 0.1;
        }

        function sortLayerByEdges(layer, edgeGetter, weightGetter) {
            const ids = orders.get(layer);
            if (!ids) return;
            ids.sort((a, b) => {
                const aWeights = edgeGetter(a).map(weightGetter).filter((weight) => weight !== null);
                const bWeights = edgeGetter(b).map(weightGetter).filter((weight) => weight !== null);
                if (aWeights.length === 0 && bWeights.length === 0) return 0;
                if (aWeights.length === 0) return 1;
                if (bWeights.length === 0) return -1;
                const aWeight = aWeights.reduce((sum, weight) => sum + weight, 0) / aWeights.length;
                const bWeight = bWeights.reduce((sum, weight) => sum + weight, 0) / bWeights.length;
                return (aWeight - bWeight) || compareByCurrentPosition(a, b);
            });
            refreshIndexes();
        }

        refreshIndexes();
        for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
            orderedLayers.forEach((layer) => sortLayerByEdges(
                layer,
                (id) => graph.incomingEdges.get(id) || [],
                getIncomingEdgeWeight
            ));
            [...orderedLayers].reverse().forEach((layer) => sortLayerByEdges(
                layer,
                (id) => graph.outgoingEdges.get(id) || [],
                getOutgoingEdgeWeight
            ));
        }

        return { orderedLayers, orders };
    }

    function placeLayerByTargets(ids, targets, positions) {
        const desiredTops = ids.map((id, index) => {
            const size = getNodeSize(state.nodes.get(id));
            const fallback = positions.get(id)?.y ?? 0;
            const targetCenter = targets.get(id);
            return Number.isFinite(targetCenter) ? targetCenter - size.height / 2 : fallback + index * 0.001;
        });

        const placed = [];
        ids.forEach((id, index) => {
            const size = getNodeSize(state.nodes.get(id));
            const previous = index > 0 ? placed[index - 1] + getNodeSize(state.nodes.get(ids[index - 1])).height + ROW_GAP : -Infinity;
            placed[index] = Math.max(desiredTops[index], previous);
            positions.set(id, {
                x: positions.get(id)?.x || 0,
                y: placed[index]
            });
        });

        for (let index = ids.length - 2; index >= 0; index -= 1) {
            const id = ids[index];
            const size = getNodeSize(state.nodes.get(id));
            const nextTop = placed[index + 1];
            placed[index] = Math.min(placed[index], nextTop - ROW_GAP - size.height);
            positions.set(id, {
                x: positions.get(id)?.x || 0,
                y: placed[index]
            });
        }
    }

    function relaxLayerPositions(orderedLayers, orders, graph, positions) {
        function getDesiredCenterFromIncomingEdge(id, edge) {
            const sourceId = edge.from?.nodeId;
            const sourcePosition = positions.get(sourceId);
            if (!sourcePosition) return null;
            const size = getNodeSize(state.nodes.get(id));
            const sourcePortY = getPortRelativeY(sourceId, edge.from?.port, 'output');
            const targetPortY = getPortRelativeY(id, edge.to?.port, 'input');
            return sourcePosition.y + sourcePortY - targetPortY + size.height / 2;
        }

        function getDesiredCenterFromOutgoingEdge(id, edge) {
            const targetId = edge.to?.nodeId;
            const targetPosition = positions.get(targetId);
            if (!targetPosition) return null;
            const size = getNodeSize(state.nodes.get(id));
            const sourcePortY = getPortRelativeY(id, edge.from?.port, 'output');
            const targetPortY = getPortRelativeY(targetId, edge.to?.port, 'input');
            return targetPosition.y + targetPortY - sourcePortY + size.height / 2;
        }

        function buildTargets(ids, edgeGetter, centerGetter) {
            const targets = new Map();
            ids.forEach((id) => {
                const centers = edgeGetter(id)
                    .map((edge) => centerGetter(id, edge))
                    .filter((center) => center !== null && Number.isFinite(center));
                if (centers.length === 0) return;
                const averageCenter = centers.reduce((sum, center) => sum + center, 0) / centers.length;
                targets.set(id, averageCenter);
            });
            return targets;
        }

        for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
            orderedLayers.slice(1).forEach((layer) => {
                const ids = orders.get(layer) || [];
                placeLayerByTargets(
                    ids,
                    buildTargets(ids, (id) => graph.incomingEdges.get(id) || [], getDesiredCenterFromIncomingEdge),
                    positions
                );
            });

            orderedLayers.slice(0, -1).reverse().forEach((layer) => {
                const ids = orders.get(layer) || [];
                placeLayerByTargets(
                    ids,
                    buildTargets(ids, (id) => graph.outgoingEdges.get(id) || [], getDesiredCenterFromOutgoingEdge),
                    positions
                );
            });
        }
    }

    function layoutConnectedComponent(nodeIds) {
        const graph = buildGraph(nodeIds);
        const layers = assignLayers(nodeIds, graph);
        const grouped = groupByLayer(nodeIds, layers);
        const { orderedLayers, orders } = calculateLayerOrders(grouped, graph);
        const columnX = new Map();
        const positions = new Map();
        let x = 0;

        orderedLayers.forEach((layer, layerIndex) => {
            const ids = orders.get(layer) || [];
            const width = ids.reduce((max, id) => Math.max(max, getNodeSize(state.nodes.get(id)).width), FALLBACK_NODE_WIDTH);
            columnX.set(layer, x);
            x += width + COLUMN_GAP;

            let y = 0;
            ids.forEach((id) => {
                const size = getNodeSize(state.nodes.get(id));
                positions.set(id, {
                    x: columnX.get(layer),
                    y
                });
                y += size.height + ROW_GAP;
            });

            if (layerIndex > 0) {
                const previousLayer = orderedLayers[layerIndex - 1];
                const currentHeight = Math.max(0, y - ROW_GAP);
                const previousBounds = calculateBounds(positions, orders.get(previousLayer) || []);
                const offset = previousBounds.minY + previousBounds.height / 2 - currentHeight / 2;
                ids.forEach((id) => {
                    const position = positions.get(id);
                    positions.set(id, { ...position, y: position.y + offset });
                });
            }
        });

        relaxLayerPositions(orderedLayers, orders, graph, positions);

        const bounds = calculateBounds(positions, nodeIds);
        return translatePositions(positions, -bounds.minX, -bounds.minY);
    }

    function findConnectedComponents(nodeIds) {
        const graph = buildGraph(nodeIds);
        const adjacency = new Map(nodeIds.map((id) => [id, new Set()]));
        nodeIds.forEach((id) => {
            graph.outgoing.get(id)?.forEach((targetId) => {
                adjacency.get(id)?.add(targetId);
                adjacency.get(targetId)?.add(id);
            });
        });

        const visited = new Set();
        const components = [];
        [...nodeIds].sort(compareByCurrentPosition).forEach((id) => {
            if (visited.has(id)) return;
            const component = [];
            const stack = [id];
            visited.add(id);

            while (stack.length > 0) {
                const current = stack.pop();
                component.push(current);
                adjacency.get(current)?.forEach((nextId) => {
                    if (visited.has(nextId)) return;
                    visited.add(nextId);
                    stack.push(nextId);
                });
            }

            components.push(component.sort(compareByCurrentPosition));
        });

        return components;
    }

    function hasInternalConnections(nodeIds) {
        const targetSet = new Set(nodeIds);
        return state.connections.some((connection) => {
            return targetSet.has(connection.from?.nodeId) && targetSet.has(connection.to?.nodeId);
        });
    }

    function getComponentSortKey(nodeIds) {
        return nodeIds.reduce((key, id) => {
            const node = state.nodes.get(id);
            if (!node) return key;
            return {
                x: Math.min(key.x, node.x),
                y: Math.min(key.y, node.y)
            };
        }, { x: Infinity, y: Infinity });
    }

    function calculatePositions(nodeIds) {
        const anchor = getLayoutAnchor(nodeIds);
        const connectedComponents = [];
        const looseNodeIds = [];

        findConnectedComponents(nodeIds).forEach((component) => {
            if (hasInternalConnections(component)) connectedComponents.push(component);
            else looseNodeIds.push(...component);
        });

        const layoutBlocks = connectedComponents
            .sort((a, b) => {
                const keyA = getComponentSortKey(a);
                const keyB = getComponentSortKey(b);
                return (keyA.y - keyB.y) || (keyA.x - keyB.x) || a[0].localeCompare(b[0]);
            })
            .map((component) => ({
                ids: component,
                positions: layoutConnectedComponent(component)
            }));

        if (looseNodeIds.length > 0) {
            layoutBlocks.push({
                ids: looseNodeIds.sort(compareByCurrentPosition),
                positions: layoutGrid(looseNodeIds)
            });
        }

        const positions = new Map();
        let y = anchor.y;
        layoutBlocks.forEach((block) => {
            const bounds = calculateBounds(block.positions, block.ids);
            const translated = translatePositions(block.positions, anchor.x - bounds.minX, y - bounds.minY);
            translated.forEach((position, id) => positions.set(id, position));
            y += bounds.height + COMPONENT_GAP;
        });

        return positions;
    }

    function applyPositions(positions) {
        positions.forEach((position, id) => {
            const node = state.nodes.get(id);
            if (!node) return;
            node.x = position.x;
            node.y = position.y;
            node.el.style.left = `${position.x}px`;
            node.el.style.top = `${position.y}px`;
        });
    }

    function autoArrangeNodes() {
        const targetNodeIds = getTargetNodeIds();
        const runningCount = targetNodeIds.filter((id) => isNodeRunning(id)).length;
        const nodeIds = targetNodeIds.filter((id) => !isNodeRunning(id));
        if (runningCount > 0) {
            showToast(runningCount > 1 ? `有 ${runningCount} 个节点正在运行，已跳过这些节点` : '节点正在运行，已跳过该节点', 'warning');
        }
        if (nodeIds.length === 0) {
            showToast('画布中没有可排列的节点', 'info');
            return false;
        }

        pushHistory();
        const positions = calculatePositions(nodeIds);
        applyPositions(positions);
        updateAllConnections();
        scheduleSave();
        showToast(state.selectedNodes.size > 0 ? `已排列 ${nodeIds.length} 个选中节点` : `已排列 ${nodeIds.length} 个节点`, 'success');
        return true;
    }

    return {
        autoArrangeNodes
    };
}
