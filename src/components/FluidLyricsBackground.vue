<!-- Adapted from solstice23/refined-now-playing-netease (MIT).
     Copyright (c) 2022 solstice23. See public/licenses/refined-now-playing-netease.txt. -->
<template>
  <div
    class="fluid-background"
    :class="{ paused: !running, gpu: gpuReady }"
    aria-hidden="true"
  >
    <canvas
      ref="gpuCanvas"
      class="gpu-canvas"
      :class="{ visible: ready }"
    ></canvas>
    <svg width="0" height="0" class="fluid-filters">
      <defs>
        <filter
          :id="filterPrefix"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005"
            numOctaves="1"
            :seed="seed"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="400" />
        </filter>
      </defs>
    </svg>
    <div class="fluid-layer" :class="{ visible: ready }">
      <div
        class="fluid-rotation"
        :style="{
          filter: `saturate(1.5) brightness(0.8) url(#${filterPrefix})`,
        }"
      >
        <canvas
          v-for="quadrant in [0, 1, 2, 3]"
          :key="quadrant"
          :ref="element => setCanvas(element, quadrant)"
          :data-quadrant="quadrant"
          width="100"
          height="100"
          :style="{ animationDelay: `${quadrant * -5}s` }"
        ></canvas>
      </div>
    </div>
    <div class="fluid-overlay"></div>
  </div>
</template>

<script>
import { createFluidCoverTransition } from '@/utils/fluidCoverTransition';
import { createFluidGpuRenderer } from '@/utils/fluidGpuRenderer';

let nextBackgroundId = 0;

export default {
  name: 'FluidLyricsBackground',
  props: {
    imageUrl: { type: String, default: '' },
    active: { type: Boolean, default: false },
    playing: { type: Boolean, default: false },
  },
  data() {
    return {
      filterPrefix: `lyrics-fluid-${nextBackgroundId++}`,
      seed: Math.floor(Math.random() * 1000),
      ready: false,
      gpuReady: false,
      loadedUrl: '',
      pageVisible: document.visibilityState !== 'hidden',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
    };
  },
  computed: {
    running() {
      return (
        this.active && this.playing && this.pageVisible && !this.reducedMotion
      );
    },
  },
  watch: {
    running(value) {
      this.gpuRenderer?.setRunning(value);
    },
    imageUrl() {
      this.loadCover();
    },
    active() {
      if (!this.active) this.coverTransition?.finish();
      this.loadCover();
    },
  },
  created() {
    this.canvases = [];
    this.imageRequest = 0;
  },
  mounted() {
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.handleMotionChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.coverTransition = createFluidCoverTransition(this.canvases, 1200, () =>
      this.gpuRenderer?.invalidate()
    );
    try {
      this.gpuRenderer = createFluidGpuRenderer(
        this.$refs.gpuCanvas,
        this.canvases,
        {
          seed: this.seed,
          onReady: () => {
            this.gpuReady = true;
          },
          onFailure: this.disableGpu,
        }
      );
      this.gpuRenderer?.setRunning(this.running);
    } catch (_) {
      this.disableGpu();
    }
    this.loadCover();
  },
  beforeUnmount() {
    this.cancelImage();
    this.coverTransition?.dispose();
    this.gpuRenderer?.dispose();
    this.motionQuery.removeEventListener('change', this.handleMotionChange);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
  },
  methods: {
    disableGpu() {
      this.gpuReady = false;
      this.gpuRenderer?.dispose();
      this.gpuRenderer = null;
    },
    setCanvas(element, quadrant) {
      this.canvases[quadrant] = element;
    },
    handleMotionChange(event) {
      this.reducedMotion = event.matches;
      if (event.matches) this.coverTransition?.finish();
    },
    handleVisibilityChange() {
      this.pageVisible = document.visibilityState !== 'hidden';
      if (!this.pageVisible) this.coverTransition?.finish();
      this.loadCover();
    },
    cancelImage() {
      this.imageRequest += 1;
      if (!this.pendingImage) return;
      this.pendingImage.onload = null;
      this.pendingImage.onerror = null;
      this.pendingImage.src = '';
      this.pendingImage = null;
    },
    loadCover() {
      this.cancelImage();
      if (!this.imageUrl) {
        // Track metadata may briefly have no artwork. Hold the current colors
        // until the next cover arrives instead of fading to black in between.
        return;
      }
      if (!this.active || !this.pageVisible || this.loadedUrl === this.imageUrl)
        return;
      if (!this.coverTransition) return;
      const request = this.imageRequest;
      const url = this.imageUrl;
      const image = new Image();
      if (this.gpuRenderer) image.crossOrigin = 'anonymous';
      this.pendingImage = image;
      image.decoding = 'async';
      image.onload = () => {
        if (request !== this.imageRequest) return;
        this.coverTransition.transitionTo(image, !this.reducedMotion);
        this.loadedUrl = url;
        this.ready = true;
        this.pendingImage = null;
      };
      image.onerror = () => {
        if (
          request === this.imageRequest &&
          image.crossOrigin === 'anonymous'
        ) {
          this.disableGpu();
          image.crossOrigin = null;
          image.src = url;
          return;
        }
        if (request === this.imageRequest) this.pendingImage = null;
      };
      // Drawing needs no pixel readback, so even covers without CORS can render.
      image.src = url;
    },
  },
};
</script>

<style lang="scss" scoped>
.fluid-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #24232a;
  z-index: 0;
}

.fluid-filters {
  position: absolute;
}

.fluid-layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.9s ease;

  &.visible {
    opacity: 1;
  }
}

.fluid-rotation {
  position: absolute;
  width: 100vmax;
  height: 100vmax;
  left: calc(50% - 50vmax);
  top: calc(50% - 50vmax);
  animation: fluid-container-rotate 150s linear infinite;
}

canvas {
  position: absolute;
  width: 70.7vmax;
  height: 70.7vmax;
  left: calc(50% - 60.095vmax);
  top: calc(50% - 60.095vmax);
  animation: fluid-block-rotate 60s linear infinite;

  &[data-quadrant='1'],
  &[data-quadrant='3'] {
    left: calc(50% - 10.605vmax);
  }

  &[data-quadrant='2'],
  &[data-quadrant='3'] {
    top: calc(50% - 10.605vmax);
  }
}

canvas.gpu-canvas {
  visibility: hidden;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: none;
  opacity: 0;
  transition: opacity 0.9s ease;
  &.visible {
    opacity: 1;
  }
}

.gpu {
  canvas.gpu-canvas {
    visibility: visible;
  }
  .fluid-layer {
    visibility: hidden;
    .fluid-rotation,
    canvas {
      animation-play-state: paused;
    }
  }
  .fluid-overlay {
    backdrop-filter: none;
    background: transparent;
  }
}

.paused,
.fluid-layer:not(.visible) {
  .fluid-rotation,
  canvas {
    animation-play-state: paused;
  }
}

.fluid-overlay {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(64px);
  background: rgba(0, 0, 0, 0.3);
}

@keyframes fluid-block-rotate {
  to {
    transform: rotate(360deg);
  }
}

@keyframes fluid-container-rotate {
  from {
    transform: scale(1.2) rotate(0deg);
  }
  to {
    transform: scale(1.2) rotate(-360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fluid-layer {
    transition: none;
  }
  canvas.gpu-canvas {
    transition: none;
  }
}
</style>
