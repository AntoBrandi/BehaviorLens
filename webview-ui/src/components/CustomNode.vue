<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';

const props = defineProps(['id', 'data', 'sourcePosition', 'targetPosition', 'showPorts', 'definition', 'isEditing']);
const emit = defineEmits(['update-attribute', 'save-label', 'cancel-edit']);

const typeClass = computed(() => {
    return (props.data?.type || 'default').toLowerCase();
});

const statusColor = computed(() => {
    if (!props.data?.status) return 'transparent';
    const status = props.data.status.toUpperCase();
    if (status === 'SUCCESS') return '#4caf50';
    if (status === 'FAILURE') return '#f44336';
    if (status === 'RUNNING') return '#ffeb3b';
    return 'transparent';
});

const isLeaf = computed(() => {
    const type = (props.data?.type || '').toLowerCase();
    return type === 'action' || type === 'condition';
});

const iconSvg = computed(() => {
    const label = (props.data?.label || '').toLowerCase();
    const type = (props.data?.type || '').toLowerCase();
    
    // Specific Control Icons
    if (label.includes('sequence') || label === 'sequence') {
        return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M16.01 11H4v2h12.01v3L20 12l-3.99-4z" fill="currentColor"/></svg>'; // Arrow Right
    }
    if (label.includes('fallback') || label === 'fallback') {
        return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" fill="currentColor"/></svg>'; // Question Mark
    }
    if (label.includes('parallel')) {
        return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2v20M8 2v20M16 2v20" stroke="currentColor" stroke-width="2"/></svg>'; // Parallel lines (simplified)
    }

   // Generic Type Icons
   if (type === 'action') return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 2v11h3v9l7-12h-4l4-8z" fill="currentColor"/></svg>'; // Lightning Bolt
   if (type === 'condition') return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" fill="currentColor"/></svg>'; // Simple Question Mark
   if (type === 'control') return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2L2 22h20L12 2z" fill="currentColor" /></svg>'; // Default Control Triangle
   if (type === 'decorator') return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2l10 10-10 10-10-10z" fill="currentColor" /></svg>'; // Rhombus
   
   return '';
});

const displayedPorts = computed(() => {
    if (!props.data) return [];
    const existing = props.data.attributes || {};
    const ports = [];
    const seen = new Set<string>();

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

function onLabelSave(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (value.trim()) {
        emit('save-label', { nodeId: props.id, newLabel: value.trim() });
    } else {
        emit('cancel-edit');
    }
}

function onLabelCancel() {
    emit('cancel-edit');
}

// Focus directive
const vFocus = {
  mounted: (el: HTMLInputElement) => el.focus()
}
</script>

<template>
  <div class="custom-node" :class="typeClass" :style="{ borderColor: statusColor, boxShadow: statusColor !== 'transparent' ? `0 0 5px ${statusColor}` : 'none' }">
    <Handle type="target" :position="targetPosition || Position.Top" class="handle" />
    
    <div class="node-content">
        <div class="icon" v-html="iconSvg"></div>
        <div v-if="!isEditing" class="label" @dblclick="$emit('request-edit', id)">{{ data.label }}</div>
        <input 
            v-else
            v-focus
            class="label-input"
            type="text"
            :value="data.label"
            @blur="onLabelSave"
            @keydown.enter="onLabelSave"
            @keydown.escape="onLabelCancel"
            @mousedown.stop
        />
    </div>

    <div class="ports" v-if="showPorts && displayedPorts && displayedPorts.length > 0">
        <div v-for="attr in displayedPorts" :key="attr.key" class="port-item">
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

.label-input {
    flex: 1;
    font-family: inherit;
    font-size: inherit;
    font-weight: 600;
    text-align: center;
    border: 1px solid #2196f3;
    border-radius: 2px;
    padding: 0 4px;
    outline: none;
    background: rgba(255, 255, 255, 0.9);
    width: 60px; /* Min width */
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
