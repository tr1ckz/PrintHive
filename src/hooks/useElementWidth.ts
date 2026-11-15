import { useLayoutEffect, useState } from 'react';

/**
 * Live content-box width of an element, via a callback ref so it keeps
 * working when the element mounts late (e.g. after a loading state).
 * Layout that depends on the space a component actually gets — not the
 * viewport — reads this: the dashboard column count must respond to the
 * sidebar collapsing as well as to the window resizing.
 */
export function useElementWidth<T extends HTMLElement>(fallback: number): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    if (!node) return;

    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') {
        setWidth(next);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width];
}

export default useElementWidth;
