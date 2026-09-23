<template>
  <div ref="contextMenu" class="context-menu">
    <transition name="context-menu">
      <div
        v-if="showMenu"
        ref="menu"
        class="menu"
        tabindex="-1"
        :style="{ top: top, left: left }"
        @click="handleMenuClick"
      >
        <slot></slot>
      </div>
    </transition>
  </div>
</template>

<script>
import { mapState } from 'vuex';

// 全局单例记录当前打开的 ContextMenu 组件实例，杜绝多菜单并存
let activeContextMenu = null;

export default {
  name: 'ContextMenu',
  data() {
    return {
      showMenu: false,
      top: '0px',
      left: '0px',
    };
  },
  computed: {
    ...mapState(['player']),
  },
  beforeUnmount() {
    this.unbindGlobalEvents();
  },
  methods: {
    setMenu(top, left) {
      let heightOffset = this.player.enabled ? 64 : 0;
      let largestHeight =
        window.innerHeight - this.$refs.menu.offsetHeight - heightOffset;
      let largestWidth = window.innerWidth - this.$refs.menu.offsetWidth - 25;
      if (top > largestHeight) top = largestHeight;
      if (left > largestWidth) left = largestWidth;
      this.top = top + 'px';
      this.left = left + 'px';
    },

    bindGlobalEvents() {
      window.addEventListener('pointerdown', this.handleOutsidePointer, true);
      window.addEventListener('contextmenu', this.handleOutsidePointer, true);
      window.addEventListener('wheel', this.handleOutsideWheel, {
        passive: true,
      });
      window.addEventListener('blur', this.closeMenu);
    },

    unbindGlobalEvents() {
      window.removeEventListener('pointerdown', this.handleOutsidePointer, true);
      window.removeEventListener('contextmenu', this.handleOutsidePointer, true);
      window.removeEventListener('wheel', this.handleOutsideWheel);
      window.removeEventListener('blur', this.closeMenu);
    },

    closeMenu() {
      if (!this.showMenu) return;
      this.showMenu = false;
      this.unbindGlobalEvents();
      if (activeContextMenu === this) {
        activeContextMenu = null;
      }
      if (this.$parent.closeMenu !== undefined) {
        this.$parent.closeMenu();
      }
      this.$store.commit('enableScrolling', true);
    },

    handleMenuClick(e) {
      // 点击菜单动作项时自动关闭（排除 header 预览）
      if (e.target.closest('.item:not(.header)')) {
        this.closeMenu();
      }
    },

    handleOutsidePointer(e) {
      if (this.$refs.menu && !this.$refs.menu.contains(e.target)) {
        this.closeMenu();
      }
    },

    handleOutsideWheel(e) {
      if (this.$refs.menu && !this.$refs.menu.contains(e.target)) {
        this.closeMenu();
      }
    },

    openMenu(e) {
      // 全局互斥：关闭任何先前已打开的菜单
      if (activeContextMenu && activeContextMenu !== this) {
        activeContextMenu.closeMenu();
      }
      activeContextMenu = this;

      // 预设光标坐标，防止初次或再次打开时从旧位置跳跃产生位移闪烁
      this.top = e.y + 'px';
      this.left = e.x + 'px';
      this.showMenu = true;

      this.$nextTick(() => {
        if (this.$refs.menu) {
          this.$refs.menu.focus();
          this.setMenu(e.y, e.x);
          setTimeout(() => {
            if (this.showMenu) {
              this.bindGlobalEvents();
            }
          }, 0);
        }
      });
      e.preventDefault();
      this.$store.commit('enableScrolling', false);
    },
  },
};
</script>

<!-- Menu entries are supplied through a slot. Vue 3 does not apply this
component's scope attribute to slotted nodes, so these container-qualified
selectors must remain global to style the slot content. -->
<style lang="scss">
.context-menu {
  width: 100%;
  height: 100%;
  user-select: none;
}

.menu {
  position: fixed;
  min-width: 136px;
  max-width: 240px;
  list-style: none;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.12),
    0 2px 8px -2px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  box-sizing: border-box;
  padding: 6px;
  z-index: 1000;
  -webkit-app-region: no-drag;
  transform-origin: top left;
  transition: background 150ms ease-out;

  &:focus {
    outline: none;
  }
}

/* ContextMenu 缓动微弹弹出与优雅渐隐消失 */
.context-menu-enter-active {
  transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.context-menu-leave-active {
  transition: opacity 0.12s cubic-bezier(0.4, 0, 1, 1),
    transform 0.12s cubic-bezier(0.4, 0, 1, 1) !important;
  pointer-events: none;
}

.context-menu-enter-from {
  opacity: 0 !important;
  transform: scale(0.92) translateY(-4px) !important;
}

.context-menu-enter-to {
  opacity: 1 !important;
  transform: scale(1) translateY(0) !important;
}

.context-menu-leave-from {
  opacity: 1 !important;
  transform: scale(1) translateY(0) !important;
}

.context-menu-leave-to {
  opacity: 0 !important;
  transform: scale(0.96) translateY(-2px) !important;
}

[data-theme='dark'] {
  .menu {
    background: rgba(36, 36, 36, 0.78);
    backdrop-filter: blur(16px) contrast(120%) brightness(60%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.08);
  }
  .menu .item:hover {
    color: var(--color-text);
  }
}

@supports (-moz-appearance: none) {
  .menu {
    background-color: var(--color-body-bg) !important;
  }
}

.menu .item {
  font-weight: 600;
  font-size: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: default;
  color: var(--color-text);
  display: flex;
  align-items: center;
  &:hover {
    color: var(--color-primary);
    background: var(--color-primary-bg-for-transparent);
    transition: opacity 125ms ease-out, transform 125ms ease-out;
  }
  &:active {
    opacity: 0.75;
    transform: scale(0.95);
  }

  .svg-icon {
    height: 16px;
    width: 16px;
    margin-right: 5px;
  }
}

hr {
  margin: 4px 10px;
  background: rgba(128, 128, 128, 0.18);
  height: 1px;
  box-shadow: none;
  border: none;
}

.item-info {
  padding: 10px 10px;
  display: flex;
  align-items: center;
  color: var(--color-text);
  cursor: default;
  img {
    height: 38px;
    width: 38px;
    border-radius: 4px;
  }
  .info {
    margin-left: 10px;
  }
  .title {
    font-size: 16px;
    font-weight: 600;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
    word-break: break-all;
  }
  .subtitle {
    font-size: 12px;
    opacity: 0.68;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
    word-break: break-all;
  }
}
</style>
