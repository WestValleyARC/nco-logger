export const loggerGridRectsOverlap = (left, right) => left.x < right.x + right.w && left.x + left.w > right.x
    && left.y < right.y + right.h && left.y + left.h > right.y;
export function loggerGridLayoutIsCollisionFree(layout, visibleIds) {
    for (let i = 0; i < visibleIds.length; i += 1) {
        const left = layout.items[visibleIds[i]];
        if (!left)
            return false;
        for (let j = i + 1; j < visibleIds.length; j += 1) {
            const right = layout.items[visibleIds[j]];
            if (!right || loggerGridRectsOverlap(left, right))
                return false;
        }
    }
    return true;
}
export function replaceLoggerGridItem(layout, itemId, nextItem, visibleIds) {
    if (!layout.items[itemId])
        return null;
    const candidate = {
        ...layout,
        items: { ...layout.items, [itemId]: { ...nextItem } }
    };
    return loggerGridLayoutIsCollisionFree(candidate, visibleIds) ? candidate : null;
}
const loggerGridRectArea = (rect) => rect.w * rect.h;
const loggerGridOverlapArea = (left, right) => Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
export function swapLoggerGridItemAtPosition(layout, itemId, requested, bounds, visibleIds) {
    const item = layout.items[itemId];
    if (!item)
        return null;
    const gridWidth = bounds.maxX + item.w;
    const gridHeight = bounds.maxY + item.h;
    const requestedItem = { ...item, x: requested.x, y: requested.y };
    const targets = visibleIds.filter(otherId => {
        if (otherId === itemId)
            return false;
        const other = layout.items[otherId];
        if (!other)
            return false;
        const overlap = loggerGridOverlapArea(requestedItem, other);
        return overlap * 2 >= Math.min(loggerGridRectArea(requestedItem), loggerGridRectArea(other));
    });
    if (targets.length !== 1)
        return null;
    const targetId = targets[0];
    const target = layout.items[targetId];
    const movedItem = { ...item, x: target.x, y: target.y };
    const movedTarget = { ...target, x: item.x, y: item.y };
    const withinBounds = (rect) => rect.x >= 0 && rect.y >= 0
        && rect.x + rect.w <= gridWidth && rect.y + rect.h <= gridHeight;
    if (!withinBounds(movedItem) || !withinBounds(movedTarget))
        return null;
    const candidate = {
        ...layout,
        items: { ...layout.items, [itemId]: movedItem, [targetId]: movedTarget }
    };
    return loggerGridLayoutIsCollisionFree(candidate, visibleIds) ? candidate : null;
}
export function findLoggerGridItemPosition(layout, itemId, requested, previous, bounds, visibleIds) {
    const item = layout.items[itemId];
    if (!item)
        return null;
    const clamp = (value, maximum) => Math.min(maximum, Math.max(0, Math.round(value)));
    const target = { x: clamp(requested.x, bounds.maxX), y: clamp(requested.y, bounds.maxY) };
    const prior = { x: clamp(previous.x, bounds.maxX), y: clamp(previous.y, bounds.maxY) };
    const tryAt = (x, y) => replaceLoggerGridItem(layout, itemId, { ...item, x, y }, visibleIds);
    const swapped = swapLoggerGridItemAtPosition(layout, itemId, target, bounds, visibleIds);
    if (swapped)
        return swapped;
    const positions = [];
    for (let y = 0; y <= bounds.maxY; y += 1) {
        for (let x = 0; x <= bounds.maxX; x += 1)
            positions.push({ x, y });
    }
    positions.sort((left, right) => {
        const requestedDistance = (position) => ((position.x - target.x) ** 2) + ((position.y - target.y) ** 2);
        const previousDistance = (position) => ((position.x - prior.x) ** 2) + ((position.y - prior.y) ** 2);
        return requestedDistance(left) - requestedDistance(right)
            || previousDistance(left) - previousDistance(right)
            || Math.abs(left.y - target.y) - Math.abs(right.y - target.y)
            || Math.abs(left.x - target.x) - Math.abs(right.x - target.x)
            || left.y - right.y
            || left.x - right.x;
    });
    for (const position of positions) {
        const candidate = tryAt(position.x, position.y);
        if (candidate)
            return candidate;
    }
    return null;
}
//# sourceMappingURL=loggerGrid.js.map