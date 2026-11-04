// Animate layout changes from the current visible position, including when a
// resize or another track interrupts a move already in progress.
export function createLayoutMotion(element, container) {
  let previous = null;
  let animation = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function refresh() {
    if (!element.getClientRects().length || !element.offsetWidth) {
      animation?.cancel();
      animation = null;
      previous = null;
      return;
    }

    const rect = element.getBoundingClientRect();
    const origin = container.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(element).transform
    );
    // Ignore the page's own opening/closing animation and our current offset.
    const next = {
      x: rect.left - origin.left - transform.m41,
      y: rect.top - origin.top - transform.m42,
    };
    const last = previous;
    previous = next;
    if (!last) return;
    if (Math.abs(last.x - next.x) < 0.5 && Math.abs(last.y - next.y) < 0.5)
      return;

    const x = last.x + transform.m41 - next.x;
    const y = last.y + transform.m42 - next.y;
    animation?.cancel();
    animation = null;
    if (reducedMotion.matches) return;
    animation = element.animate(
      [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
    animation.onfinish = () => {
      animation = null;
    };
  }

  const observer = new ResizeObserver(refresh);
  observer.observe(container);
  observer.observe(element);
  refresh();

  return {
    refresh,
    disconnect() {
      observer.disconnect();
      animation?.cancel();
    },
  };
}
