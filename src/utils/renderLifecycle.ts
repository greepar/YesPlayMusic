export type RenderingStateListener = (suspended: boolean) => void;

const listeners = new Set<RenderingStateListener>();
let renderingSuspended = false;

export function isRenderingSuspended(): boolean {
  return renderingSuspended;
}

export function setRenderingSuspended(suspended: boolean): void {
  if (renderingSuspended === suspended) return;
  renderingSuspended = suspended;
  document.documentElement.classList.toggle(
    'renderer-suspended',
    renderingSuspended
  );
  listeners.forEach(listener => listener(renderingSuspended));
}

export function onRenderingStateChange(
  listener: RenderingStateListener
): () => void {
  listeners.add(listener);
  listener(renderingSuspended);
  return () => listeners.delete(listener);
}
