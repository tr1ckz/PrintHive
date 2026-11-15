/**
 * Column flow for the dashboard: widgets keep their natural height and are
 * packed into equal-width columns, so there is no fixed row grid for content
 * to overflow and no dead space under short widgets.
 *
 * Placement: the first N widgets head the N columns left to right (so the
 * user's top priorities read across the top row); the remaining widgets go
 * wherever keeps the columns most even, and each column lists its widgets in
 * the user's order.
 *
 * Heights are estimates derived from the data each widget will render (row
 * counts), not DOM measurements, so the arrangement is known before first
 * paint and does not reshuffle as widgets mount.
 */
export const FLOW_GAP = 12;

/**
 * Columns by available width. Thresholds keep every widget between roughly
 * 320px and 520px wide — the range their content is designed for.
 */
export function columnCountForWidth(width: number): number {
  if (width < 640) return 1;
  if (width < 1000) return 2;
  if (width < 1500) return 3;
  if (width < 2100) return 4;
  return 5;
}

export function distributeIntoColumns<T extends string>(
  ids: T[],
  columnCount: number,
  estimateHeight: (id: T) => number,
): T[][] {
  const count = Math.max(1, Math.min(columnCount, ids.length || 1));
  if (count === 1) {
    return [[...ids]];
  }

  const cost = (id: T) => estimateHeight(id) + FLOW_GAP;
  const heads = ids.slice(0, count);
  const rest = ids.slice(count);
  const baseHeights = heads.map(cost);

  // Exhaustive search over where the remaining widgets go. The dashboard has
  // at most ten widgets, so this is a few thousand cheap iterations at worst.
  let bestAssignment: number[] = rest.map(() => 0);
  let bestMax = Number.POSITIVE_INFINITY;
  let bestSpread = Number.POSITIVE_INFINITY;
  const assignment = new Array<number>(rest.length).fill(0);
  const heights = [...baseHeights];

  const search = (index: number) => {
    if (index === rest.length) {
      const max = Math.max(...heights);
      const spread = max - Math.min(...heights);
      if (max < bestMax || (max === bestMax && spread < bestSpread)) {
        bestMax = max;
        bestSpread = spread;
        bestAssignment = [...assignment];
      }
      return;
    }
    const itemCost = cost(rest[index]);
    for (let column = 0; column < count; column += 1) {
      if (heights[column] + itemCost > bestMax) continue;
      heights[column] += itemCost;
      assignment[index] = column;
      search(index + 1);
      heights[column] -= itemCost;
    }
  };
  search(0);

  const columns: T[][] = heads.map((id) => [id]);
  rest.forEach((id, index) => {
    columns[bestAssignment[index]].push(id);
  });
  return columns;
}
