<template>
  <div
    ref="root"
    class="vue-slider"
    role="slider"
    tabindex="0"
    :aria-valuemin="min"
    :aria-valuemax="effectiveMax"
    :aria-valuenow="displayValue"
    :style="rootStyle"
    @pointerdown="startDrag"
    @keydown="handleKeydown"
  >
    <div class="vue-slider-rail">
      <div class="vue-slider-process" :style="processStyle"></div>
      <div class="vue-slider-dot" :style="dotStyle">
        <div class="vue-slider-dot-handle"></div>
        <div
          v-if="tooltip !== 'none'"
          class="vue-slider-dot-tooltip vue-slider-dot-tooltip-top"
        >
          <div
            class="vue-slider-dot-tooltip-wrapper"
            :class="{ 'vue-slider-dot-tooltip-wrapper-show': dragging }"
          >
            <div class="vue-slider-dot-tooltip-inner">
              {{ formattedValue }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AppSlider',
  props: {
    modelValue: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    interval: { type: Number, default: 1 },
    dotSize: { type: Number, default: 14 },
    height: { type: Number, default: 4 },
    lazy: { type: Boolean, default: false },
    dragOnClick: { type: Boolean, default: true },
    duration: { type: Number, default: 0 },
    silent: { type: Boolean, default: false },
    tooltip: { type: String, default: 'active' },
    tooltipFormatter: { type: Function, default: null },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      dragging: false,
      dragValue: this.modelValue,
    };
  },
  computed: {
    effectiveMax() {
      return Math.max(this.min, Number(this.max) || this.min);
    },
    displayValue() {
      return this.clamp(this.dragging ? this.dragValue : this.modelValue);
    },
    percentage() {
      const range = this.effectiveMax - this.min;
      return range > 0 ? ((this.displayValue - this.min) / range) * 100 : 0;
    },
    rootStyle() {
      const halfDot = this.dotSize / 2;
      return {
        height: `${this.height}px`,
        padding: `${halfDot}px 0`,
        boxSizing: 'content-box',
      };
    },
    processStyle() {
      return { width: `${this.percentage}%` };
    },
    dotStyle() {
      return {
        width: `${this.dotSize}px`,
        height: `${this.dotSize}px`,
        left: `${this.percentage}%`,
        transform: 'translate(-50%, -50%)',
      };
    },
    formattedValue() {
      return this.tooltipFormatter
        ? this.tooltipFormatter(this.displayValue)
        : this.displayValue;
    },
  },
  beforeUnmount() {
    this.stopListening();
  },
  methods: {
    clamp(value) {
      return Math.min(
        this.effectiveMax,
        Math.max(this.min, Number(value) || 0)
      );
    },
    valueFromPointer(event) {
      const rect = this.$refs.root.getBoundingClientRect();
      const ratio = rect.width
        ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        : 0;
      const value = this.min + ratio * (this.effectiveMax - this.min);
      const steps = Math.round((value - this.min) / this.interval);
      return this.clamp(this.min + steps * this.interval);
    },
    startDrag(event) {
      if (event.button !== 0 || this.effectiveMax <= this.min) return;
      event.preventDefault();
      this.dragging = true;
      this.updateFromPointer(event);
      window.addEventListener('pointermove', this.updateFromPointer);
      window.addEventListener('pointerup', this.finishDrag, { once: true });
      window.addEventListener('pointercancel', this.finishDrag, { once: true });
    },
    updateFromPointer(event) {
      this.dragValue = this.valueFromPointer(event);
      if (!this.lazy) this.$emit('update:modelValue', this.dragValue);
    },
    finishDrag(event) {
      if (!this.dragging) return;
      this.dragValue = this.valueFromPointer(event);
      this.dragging = false;
      this.$emit('update:modelValue', this.dragValue);
      this.$emit('change', this.dragValue);
      this.stopListening();
    },
    stopListening() {
      window.removeEventListener('pointermove', this.updateFromPointer);
      window.removeEventListener('pointerup', this.finishDrag);
      window.removeEventListener('pointercancel', this.finishDrag);
    },
    handleKeydown(event) {
      const direction =
        event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
            ? -1
            : 0;
      if (!direction) return;
      event.preventDefault();
      const value = this.clamp(this.modelValue + direction * this.interval);
      this.$emit('update:modelValue', value);
      this.$emit('change', value);
    },
  },
};
</script>

<style scoped>
.vue-slider {
  position: relative;
  box-sizing: content-box;
  user-select: none;
  display: block;
  width: 100%;
  cursor: pointer;
  touch-action: none;
}

.vue-slider-rail {
  position: relative;
  width: 100%;
  height: 100%;
  transition-property: width, height, left, right, top, bottom;
}

.vue-slider-process {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  z-index: 1;
}

.vue-slider-dot {
  position: absolute;
  top: 50%;
  z-index: 5;
}

.vue-slider-dot-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
}
</style>
