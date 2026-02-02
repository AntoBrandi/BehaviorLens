<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    x: number;
    y: number;
    type: 'node' | 'edge';
    showExpand?: boolean;
}>();

const emit = defineEmits(['close', 'delete', 'rename', 'expand']);

function onDelete() {
  emit('delete');
  emit('close');
}

function onRename() {
  emit('rename');
  emit('close');
}

const style = computed(() => ({
  top: `${props.y}px`,
  left: `${props.x}px`,
}));
</script>

<template>
  <div class="context-menu" :style="style" @click.stop>
    <div class="menu-item" v-if="type === 'node'" @click="onRename">
      Rename Node
    </div>
    <div class="menu-item" v-if="showExpand" @click="$emit('expand')">Expand</div>
    <div class="menu-item" @click="onDelete">
      Delete {{ type }}
    </div>
  </div>
  <div class="context-menu-overlay" @click="$emit('close')"></div>
</template>

<style scoped>
.context-menu {
  position: absolute;
  z-index: 100;
  background: var(--vscode-menu-background);
  color: var(--vscode-menu-foreground);
  border: 1px solid var(--vscode-menu-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  padding: 4px 0;
  min-width: 120px;
}
.menu-item {
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
.menu-item:hover {
  background: var(--vscode-menu-selectionBackground);
  color: var(--vscode-menu-selectionForeground);
}
.context-menu-overlay {
    position: fixed;
    top: 0; 
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 99;
    background: transparent;
}
</style>
