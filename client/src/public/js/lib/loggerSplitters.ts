import { loggerGridLayoutIsCollisionFree, type LoggerGridLayout, type LoggerGridRect } from './loggerGrid.js';

export type SharedBoundary = {
    id: string;
    axis: 'x' | 'y';
    position: number;
    start: number;
    end: number;
    before: string[];
    after: string[];
};
export type PaneMinimums = Record<string, { w: number; h: number }>;

// Adjacency is the relationship: deriving it from persisted rectangles means a
// hidden, moved or removed pane cannot leave a stale splitter behind.
export function sharedBoundaries(layout: LoggerGridLayout, visible: readonly string[]): SharedBoundary[] {
    const result: SharedBoundary[] = [];
    for (const axis of ['x', 'y'] as const) {
        const size = axis === 'x' ? 'w' : 'h';
        const cross = axis === 'x' ? 'y' : 'x';
        const crossSize = axis === 'x' ? 'h' : 'w';
        const positions = new Set(visible.map(id => {
            const rect = layout.items[id]!;
            return rect[axis] + rect[size];
        }));
        for (const position of positions) {
            const before = visible.filter(id => layout.items[id]![axis] + layout.items[id]![size] === position);
            const after = visible.filter(id => layout.items[id]![axis] === position);
            const pending = new Set([...before, ...after]);
            while (pending.size) {
                const component = [pending.values().next().value as string];
                pending.delete(component[0]!);
                for (let index = 0; index < component.length; index++) {
                    const rect = layout.items[component[index]!]!;
                    for (const id of pending) {
                        const other = layout.items[id]!;
                        if (rect[cross] < other[cross] + other[crossSize] && other[cross] < rect[cross] + rect[crossSize]) {
                            component.push(id);
                            pending.delete(id);
                        }
                    }
                }
                const left = before.filter(id => component.includes(id));
                const right = after.filter(id => component.includes(id));
                if (!left.length || !right.length) continue;
                const start = Math.min(...component.map(id => layout.items[id]![cross]));
                const end = Math.max(...component.map(id => layout.items[id]![cross] + layout.items[id]![crossSize]));
                const covers = (ids: string[]) => {
                    let cursor = start;
                    for (const id of [...ids].sort((a, b) => layout.items[a]![cross] - layout.items[b]![cross])) {
                        const rect = layout.items[id]!;
                        if (rect[cross] !== cursor) return false;
                        cursor += rect[crossSize];
                    }
                    return cursor === end;
                };
                if (!covers(left) || !covers(right)) continue;
                result.push({ id: `${axis}:${[...left].sort().join(',')}:${[...right].sort().join(',')}`, axis, position, start, end, before: left, after: right });
            }
        }
    }
    return result;
}

export function boundaryLimits(layout: LoggerGridLayout, boundary: SharedBoundary, minimums: PaneMinimums): { min: number; max: number } {
    const size = boundary.axis === 'x' ? 'w' : 'h';
    return {
        min: Math.max(...boundary.before.map(id => layout.items[id]![boundary.axis] + minimums[id]![size])),
        max: Math.min(...boundary.after.map(id => layout.items[id]![boundary.axis] + layout.items[id]![size] - minimums[id]![size]))
    };
}

export function resizeSharedBoundary(layout: LoggerGridLayout, boundary: SharedBoundary, requested: number, minimums: PaneMinimums, visible: readonly string[]): LoggerGridLayout | null {
    if (!Number.isFinite(requested)) return null;
    const current = sharedBoundaries(layout, visible).find(item => item.id === boundary.id);
    if (!current) return null;
    const { min, max } = boundaryLimits(layout, current, minimums);
    if (min > max) return null;
    const position = Math.max(min, Math.min(max, Math.round(requested)));
    const delta = position - current.position;
    const size = current.axis === 'x' ? 'w' : 'h';
    const items = { ...layout.items };
    for (const id of current.before) items[id] = { ...items[id]!, [size]: items[id]![size] + delta };
    for (const id of current.after) items[id] = { ...items[id]!, [current.axis]: position, [size]: items[id]![size] - delta };
    const candidate = { ...layout, items };
    return loggerGridLayoutIsCollisionFree(candidate, visible) ? candidate : null;
}

export function dockAtEdge(layout: LoggerGridLayout, moving: string, target: string, edge: 'left' | 'right' | 'top' | 'bottom', minimums: PaneMinimums, visible: readonly string[]): LoggerGridLayout | null {
    if (moving === target || !visible.includes(moving) || !visible.includes(target)) return null;
    // Heal the vacated split by expanding its neighbors into the old rectangle.
    // Derivation also handles a pane opposite an entire stacked column.
    const itemsAfterRemoval = { ...layout.items };
    const former = sharedBoundaries(layout, visible).find(boundary =>
        (boundary.before.length === 1 && boundary.before[0] === moving)
        || (boundary.after.length === 1 && boundary.after[0] === moving));
    if (former) {
        const size = former.axis === 'x' ? 'w' : 'h';
        const movingBefore = former.before.includes(moving);
        for (const id of movingBefore ? former.after : former.before) {
            const neighbor = itemsAfterRemoval[id]!;
            itemsAfterRemoval[id] = { ...neighbor,
                [former.axis]: movingBefore ? layout.items[moving]![former.axis] : neighbor[former.axis],
                [size]: neighbor[size] + layout.items[moving]![size] };
        }
    }
    const rect = itemsAfterRemoval[target];
    if (!rect) return null;
    const axis = edge === 'left' || edge === 'right' ? 'x' : 'y';
    const size = axis === 'x' ? 'w' : 'h';
    const crossSize = axis === 'x' ? 'h' : 'w';
    if (rect[size] < minimums[moving]![size] + minimums[target]![size]
        || rect[crossSize] < Math.max(minimums[moving]![crossSize], minimums[target]![crossSize])) return null;
    const first = edge === 'left' || edge === 'top' ? moving : target;
    const second = first === moving ? target : moving;
    const firstSize = Math.max(minimums[first]![size], Math.min(rect[size] - minimums[second]![size], Math.round(rect[size] / 2)));
    const items: Record<string, LoggerGridRect> = {
        ...itemsAfterRemoval,
        [first]: { ...rect, [size]: firstSize },
        [second]: { ...rect, [axis]: rect[axis] + firstSize, [size]: rect[size] - firstSize }
    };
    const candidate = { ...layout, items };
    return loggerGridLayoutIsCollisionFree(candidate, visible) ? candidate : null;
}
