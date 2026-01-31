<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';

const props = defineProps(['id', 'data', 'sourcePosition', 'targetPosition', 'showPorts']);
const emit = defineEmits(['update-attribute']);

const typeClass = computed(() => {
    return props.data.type?.toLowerCase() || 'default';
});

const statusColor = computed(() => {
  const status = props.data.status || 'IDLE';
  switch(status) {
    case 'RUNNING': return '#ffeb3b'; // Yellow border/glow
    case 'SUCCESS': return '#4caf50'; // Green
    case 'FAILURE': return '#f44336'; // Red
    default: return 'transparent'; 
  }
});

// Icons (Simple SVGs)
const icons = {
    control: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`, // Plus/Box
    decorator: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`, // Link
    condition: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`, // Question
    action: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`, // Play
    default: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`
};

const iconSvg = computed(() => {
    const key = props.data.type?.toLowerCase() as keyof typeof icons;
    return icons[key] || icons['default'];
});

const isLeaf = computed(() => {
    const type = props.data.type?.toLowerCase();
    return type === 'action' || type === 'condition';
});

const attributes = computed(() => {
    if (!props.data.attributes) return [];
    return Object.entries(props.data.attributes)
        .filter(([key]) => key !== 'ID' && key !== 'name')
        .map(([key, value]) => ({ key, value }));
});

function onAttributeChange(key: string, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    emit('update-attribute', {
        nodeId: props.id, 
        attr: key,
        value
    });
}

</script>

<template>
  <div class="custom-node" :class="typeClass" :style="{ borderColor: statusColor, boxShadow: statusColor !== 'transparent' ? `0 0 5px ${statusColor}` : 'none' }">
    <Handle type="target" :position="targetPosition || Position.Top" class="handle" />
    
    <div class="node-content">
        <div class="icon" v-html="iconSvg"></div>
        <div class="label">{{ data.label }}</div>
    </div>

    <div class="ports" v-if="showPorts && attributes.length > 0">
        <div v-for="attr in attributes" :key="attr.key" class="port-item">
            <span class="port-label">{{ attr.key }}:</span>
            <input 
                type="text" 
                :value="attr.value" 
                @change="onAttributeChange(attr.key, $event)"
                class="port-input"
            />
        </div>
    </div>

    <Handle type="source" :position="sourcePosition || Position.Bottom" class="handle" v-if="!isLeaf" />
  </div>
</template>

<style scoped>
.custom-node {
  padding: 8px 12px;
  border-radius: 6px;
  background: white;
  border: 2px solid #555;
  color: #333;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: 'Segoe UI', sans-serif;
  font-size: 12px;
  transition: all 0.2s ease;
}

.node-content {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.icon {
    display: flex;
    align-items: center;
    justify-content: center;
}

.label {
    flex: 1;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.handle {
    width: 8px;
    height: 8px;
    background: #555;
}

/* Type Colors */
.custom-node.control {
    background: #e3f2fd; /* Light Blue */
    border-color: #2196f3;
}
.custom-node.control .icon { color: #1976d2; }

.custom-node.decorator {
    background: #f3e5f5; /* Light Purple */
    border-color: #9c27b0;
}
.custom-node.decorator .icon { color: #7b1fa2; }

.custom-node.action {
    background: #e8f5e9; /* Light Green */
    border-color: #4caf50;
}
.custom-node.action .icon { color: #388e3c; }

.custom-node.condition {
    background: #fff3e0; /* Light Orange */
    border-color: #ff9800;
}
.custom-node.condition .icon { color: #f57c00; }

.ports {
    width: 100%;
    margin-top: 8px;
    border-top: 1px solid #eee;
    padding-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.port-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    width: 100%;
}

.port-label {
    color: #666;
    flex-shrink: 0;
}

.port-input {
    flex: 1;
    border: 1px solid #ddd;
    border-radius: 2px;
    padding: 2px 4px;
    font-size: 10px;
    min-width: 0; 
}

</style>
