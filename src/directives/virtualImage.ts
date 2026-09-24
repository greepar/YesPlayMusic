import type { App, DirectiveBinding } from 'vue';
import { sizedImageUrl } from '@/utils/imagePerformance';
import {
  isRenderingSuspended,
  onRenderingStateChange,
} from '@/utils/renderLifecycle';

const EMPTY_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

interface VirtualImageState {
  source: string;
  visible: boolean;
}

/**
 * 解析指令的值。可以用参数指定封面尺寸，例如 `v-virtual-image:224="url"`。
 *
 * 注意：Vue 2 的 `|` 过滤器语法只在插值和 v-bind 中有效，写在自定义指令里会被当成按位或，
 * 所以不要写 `v-virtual-image="url | resizeImage(224)"`，请使用参数。
 */
function resolveSource(value: unknown, arg?: string): string {
  if (typeof value !== 'string' || value === '') return '';
  const size = arg === undefined ? NaN : Number.parseInt(arg, 10);
  return Number.isFinite(size) && size > 0 ? sizedImageUrl(value, size) : value;
}

const states = new WeakMap<HTMLImageElement, VirtualImageState>();
const images = new Set<HTMLImageElement>();

// 已经加载过的图片地址。滚出视口再滚回来、或列表行被回收重建时，图片会从缓存里
// 立即出来，这时不需要再淡入；只有真正要等网络的图片才淡入。
const MAX_LOADED_SOURCES = 2000;
const loadedSources = new Set<string>();

function rememberLoadedSource(source: string): void {
  loadedSources.delete(source);
  loadedSources.add(source);
  if (loadedSources.size > MAX_LOADED_SOURCES) {
    loadedSources.delete(loadedSources.values().next().value as string);
  }
}

/** 真实图片加载完成后打上标记，由 CSS 负责淡入；换回占位图时清除 */
function handleLoad(this: HTMLImageElement): void {
  const source = this.getAttribute('src');
  if (!source || source === EMPTY_IMAGE) return;
  rememberLoadedSource(source);
  this.dataset.loaded = '';
}

function setImageSource(image: HTMLImageElement, source: string): void {
  delete image.dataset.loaded;
  image.src = source;
  if (source === EMPTY_IMAGE) return;
  // 加载过的地址，或浏览器内存缓存里已经有的图片，直接显示不做淡入
  if (loadedSources.has(source) || image.complete) {
    image.dataset.instant = '';
  } else {
    delete image.dataset.instant;
  }
}

const pendingImages = new Set<HTMLImageElement>();
let pendingFrame = 0;

function commitImages(): void {
  pendingFrame = 0;
  pendingImages.forEach(image => {
    pendingImages.delete(image);
    const state = states.get(image);
    if (!state) return;
    const next =
      state.visible && state.source && !isRenderingSuspended()
        ? state.source
        : EMPTY_IMAGE;
    if (image.getAttribute('src') === next) return;
    setImageSource(image, next);
  });
}

function renderImage(image: HTMLImageElement, state: VirtualImageState): void {
  const next =
    state.visible && state.source && !isRenderingSuspended()
      ? state.source
      : EMPTY_IMAGE;
  if (image.getAttribute('src') === next) return;
  pendingImages.add(image);
  if (!pendingFrame) pendingFrame = requestAnimationFrame(commitImages);
}

onRenderingStateChange(() => {
  images.forEach(image => {
    const state = states.get(image);
    if (state) renderImage(image, state);
  });
});

const observer =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            const image = entry.target as HTMLImageElement;
            const state = states.get(image);
            if (!state) return;
            state.visible = entry.isIntersecting;
            renderImage(image, state);
          });
        },
        // Start the network/decode work before the row enters the viewport.
        // The element-level containment rules keep those completions from
        // repainting the rest of a long page.
        { rootMargin: '1200px 0px', threshold: 0 }
      );

function updateImage(image: HTMLImageElement, source: string): void {
  const state = states.get(image);
  if (!state) return;
  state.source = source;
  renderImage(image, state);
}

export function installVirtualImage(app: App): void {
app.directive('virtual-image', {
  beforeMount(image: HTMLImageElement, binding: DirectiveBinding) {
    image.decoding = 'async';
    // IntersectionObserver owns lazy loading. Native lazy loading would add a
    // second, browser-dependent threshold and defeat the explicit preload band.
    image.loading = 'eager';
    image.dataset.virtualImage = '';
    image.addEventListener('load', handleLoad);
    const source = resolveSource(binding.value, binding.arg);
    states.set(image, {
      source,
      visible: observer === null,
    });
    images.add(image);
    setImageSource(image, observer === null && source ? source : EMPTY_IMAGE);
    observer?.observe(image);
  },
  mounted(image: HTMLImageElement) {
    image.loading = 'eager';
  },
  updated(image: HTMLImageElement, binding: DirectiveBinding) {
    if (binding.value !== binding.oldValue || binding.arg !== binding.oldArg) {
      updateImage(image, resolveSource(binding.value, binding.arg));
    }
  },
  unmounted(image: HTMLImageElement) {
    image.removeEventListener('load', handleLoad);
    observer?.unobserve(image);
    pendingImages.delete(image);
    images.delete(image);
    states.delete(image);
    image.src = EMPTY_IMAGE;
  },
});
}
