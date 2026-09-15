import { loggerGridLayoutIsCollisionFree } from './loggerGrid.js';
export function sharedBoundaries(layout, visible) {
    const result = [];
    for (const axis of ['x', 'y']) {
        const size = axis === 'x' ? 'w' : 'h';
        const cross = axis === 'x' ? 'y' : 'x';
        const crossSize = axis === 'x' ? 'h' : 'w';
        const positions = new Set(visible.map(id => {
            const rect = layout.items[id];
            return rect[axis] + rect[size];
        }));
        for (const position of positions) {
            const before = visible.filter(id => layout.items[id][axis] + layout.items[id][size] === position);
            const after = visible.filter(id => layout.items[id][axis] === position);
            const pending = new Set([...before, ...after]);
            while (pending.size) {
                const component = [pending.values().next().value];
                pending.delete(component[0]);
                for (let index = 0; index < component.length; index++) {
                    const rect = layout.items[component[index]];
                    for (const id of pending) {
                        const other = layout.items[id];
                        if (rect[cross] < other[cross] + other[crossSize] && other[cross] < rect[cross] + rect[crossSize]) {
                            component.push(id);
                            pending.delete(id);
                        }
                    }
                }
                const left = before.filter(id => component.includes(id));
                const right = after.filter(id => component.includes(id));
                if (!left.length || !right.length)
                    continue;
                const start = Math.min(...component.map(id => layout.items[id][cross]));
                const end = Math.max(...component.map(id => layout.items[id][cross] + layout.items[id][crossSize]));
                const covers = (ids) => {
                    let cursor = start;
                    for (const id of [...ids].sort((a, b) => layout.items[a][cross] - layout.items[b][cross])) {
                        const rect = layout.items[id];
                        if (rect[cross] !== cursor)
                            return false;
                        cursor += rect[crossSize];
                    }
                    return cursor === end;
                };
                if (!covers(left) || !covers(right))
                    continue;
                result.push({ id: `${axis}:${[...left].sort().join(',')}:${[...right].sort().join(',')}`, axis, position, start, end, before: left, after: right });
            }
        }
    }
    return result;
}
export function boundaryLimits(layout, boundary, minimums) {
    const size = boundary.axis === 'x' ? 'w' : 'h';
    return {
        min: Math.max(...boundary.before.map(id => layout.items[id][boundary.axis] + minimums[id][size])),
        max: Math.min(...boundary.after.map(id => layout.items[id][boundary.axis] + layout.items[id][size] - minimums[id][size]))
    };
}
export function resizeSharedBoundary(layout, boundary, requested, minimums, visible) {
    if (!Number.isFinite(requested))
        return null;
    const current = sharedBoundaries(layout, visible).find(item => item.id === boundary.id);
    if (!current)
        return null;
    const { min, max } = boundaryLimits(layout, current, minimums);
    if (min > max)
        return null;
    const position = Math.max(min, Math.min(max, Math.round(requested)));
    const delta = position - current.position;
    const size = current.axis === 'x' ? 'w' : 'h';
    const items = { ...layout.items };
    for (const id of current.before)
        items[id] = { ...items[id], [size]: items[id][size] + delta };
    for (const id of current.after)
        items[id] = { ...items[id], [current.axis]: position, [size]: items[id][size] - delta };
    const candidate = { ...layout, items };
    return loggerGridLayoutIsCollisionFree(candidate, visible) ? candidate : null;
}
export function dockAtEdge(layout, moving, target, edge, minimums, visible) {
    if (moving === target || !visible.includes(moving) || !visible.includes(target))
        return null;
    const itemsAfterRemoval = { ...layout.items };
    const former = sharedBoundaries(layout, visible).find(boundary => (boundary.before.length === 1 && boundary.before[0] === moving)
        || (boundary.after.length === 1 && boundary.after[0] === moving));
    if (former) {
        const size = former.axis === 'x' ? 'w' : 'h';
        const movingBefore = former.before.includes(moving);
        for (const id of movingBefore ? former.after : former.before) {
            const neighbor = itemsAfterRemoval[id];
            itemsAfterRemoval[id] = { ...neighbor,
                [former.axis]: movingBefore ? layout.items[moving][former.axis] : neighbor[former.axis],
                [size]: neighbor[size] + layout.items[moving][size] };
        }
    }
    const rect = itemsAfterRemoval[target];
    if (!rect)
        return null;
    const axis = edge === 'left' || edge === 'right' ? 'x' : 'y';
    const size = axis === 'x' ? 'w' : 'h';
    const crossSize = axis === 'x' ? 'h' : 'w';
    if (rect[size] < minimums[moving][size] + minimums[target][size]
        || rect[crossSize] < Math.max(minimums[moving][crossSize], minimums[target][crossSize]))
        return null;
    const first = edge === 'left' || edge === 'top' ? moving : target;
    const second = first === moving ? target : moving;
    const firstSize = Math.max(minimums[first][size], Math.min(rect[size] - minimums[second][size], Math.round(rect[size] / 2)));
    const items = {
        ...itemsAfterRemoval,
        [first]: { ...rect, [size]: firstSize },
        [second]: { ...rect, [axis]: rect[axis] + firstSize, [size]: rect[size] - firstSize }
    };
    const candidate = { ...layout, items };
    return loggerGridLayoutIsCollisionFree(candidate, visible) ? candidate : null;
}
//# sourceMappingURL=loggerSplitters.js.map