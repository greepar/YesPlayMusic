const EMPTY_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function sizedImageUrl(url: string | undefined, size: number): string {
  if (!url) return EMPTY_IMAGE;
  const secureUrl = url.replace(/^http:/, 'https:');
  const separator = secureUrl.includes('?') ? '&' : '?';
  return `${secureUrl}${separator}param=${size}y${size}`;
}

export function activeImageUrl(url: string, active: boolean): string {
  return active ? url : EMPTY_IMAGE;
}

export function coverShadowStyle(
  url: string,
  active: boolean,
  circular: boolean
): Record<string, string> {
  const styles: Record<string, string> = {};
  if (active) styles.backgroundImage = `url(${url})`;
  if (circular) styles.borderRadius = '50%';
  return styles;
}

/**
 * Populate Chromium's HTTP cache without constructing or decoding an Image.
 */
export async function warmCoverHttpCache(
  url: string | undefined,
  size = 224
): Promise<void> {
  if (!url || typeof fetch !== 'function') return;
  try {
    const response = await fetch(sizedImageUrl(url, size), {
      cache: 'force-cache',
      credentials: 'omit',
    });
    await response.blob();
  } catch {
    // Cover preloading is best-effort and must never affect audio caching.
  }
}
