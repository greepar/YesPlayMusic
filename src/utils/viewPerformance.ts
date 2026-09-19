export const MAX_CACHED_VIEWS = 3;

export function isActiveView(current: string, candidate: string): boolean {
  return current === candidate;
}
