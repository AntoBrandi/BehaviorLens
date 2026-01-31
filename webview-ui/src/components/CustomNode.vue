<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';

const props = defineProps(['id', 'data', 'sourcePosition', 'targetPosition', 'showPorts', 'definition']);
const emit = defineEmits(['update-attribute']);

const typeClass = computed(() => {
    return props.data.type?.toLowerCase() || 'default';
});

// ... (color/icon logic unchanged) ...

// But replace attributes logic:
const attributes = computed(() => {
    const existing = props.data.attributes || {};
    const ports = [];

    // 1. Add existing attributes (excluding ID/name)
    // Create a map to avoid duplicates if definition also has them
    const seen = new Set<string>();

    // If we have a definition, start with its ports
    if (props.definition && props.definition.ports) {
        props.definition.ports.forEach((port: any) => {
             ports.push({
                 key: port.name,
                 value: existing[port.name] || port.default || '',
                 isDefault: !existing[port.name]
             });
             seen.add(port.name);
        });
    }

    // 2. Add any other existing attributes that weren't in definition
    Object.entries(existing).forEach(([key, value]) => {
        if (key !== 'ID' && key !== 'name' && !seen.has(key)) {
            ports.push({ key, value: value as string, isDefault: false });
        }
    });

    return ports;
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
