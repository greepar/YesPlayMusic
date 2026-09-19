import Vue, { VNodeDirective } from 'vue';
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

const states = new WeakMap<HTMLImageElement, VirtualImageState>();
const images = new Set<HTMLImageElement>();

function renderImage(image: HTMLImageElement, state: VirtualImageState): void {
  image.src =
    state.visible && state.source && !isRenderingSuspended()
      ? state.source
      : EMPTY_IMAGE;
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
        { rootMargin: '400px 0px', threshold: 0 }
      );

function updateImage(image: HTMLImageElement, source: unknown): void {
  const state = states.get(image);
  if (!state) return;
  state.source = typeof source === 'string' ? source : '';
  renderImage(image, state);
}

Vue.directive('virtual-image', {
  bind(image: HTMLImageElement, binding: VNodeDirective) {
    image.decoding = 'async';
    image.loading = 'lazy';
    states.set(image, {
      source: typeof binding.value === 'string' ? binding.value : '',
      visible: observer === null,
    });
    images.add(image);
    image.src =
      observer === null && binding.value ? binding.value : EMPTY_IMAGE;
    observer?.observe(image);
  },
  update(image: HTMLImageElement, binding: VNodeDirective) {
    if (binding.value !== binding.oldValue) updateImage(image, binding.value);
  },
  unbind(image: HTMLImageElement) {
    observer?.unobserve(image);
    images.delete(image);
    states.delete(image);
    image.src = EMPTY_IMAGE;
  },
});
