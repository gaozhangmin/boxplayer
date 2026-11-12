<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
    duration: number;
    progressPercent: number;
    bufferedPercent: number;
    formatTime: (seconds: number) => string;
    controlsVisible?: boolean;
    showHoverTooltip?: boolean;
    alwaysShowScrubber?: boolean;
    disabled?: boolean;
    disabledReason?: string;
}>();

const emit = defineEmits<{
    (e: "seek", position: number): void;
}>();

const progressAreaRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const activePointerId = ref<number | null>(null);
const dragPercent = ref<number | null>(null);

const showHoverTime = ref(false);
const hoverTime = ref(0);
const hoverPercent = ref(0);

const clampRatio = (value: number) => Math.min(1, Math.max(0, value));

const getRatioFromClientX = (clientX: number) => {
    const container = progressAreaRef.value;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clampRatio((clientX - rect.left) / rect.width);
};

const updateHoverByClientX = (clientX: number) => {
    if (props.duration <= 0) {
        showHoverTime.value = false;
        return;
    }
    const ratio = getRatioFromClientX(clientX);
    hoverPercent.value = ratio * 100;
    hoverTime.value = ratio * props.duration;
    if (isDragging.value) {
        dragPercent.value = hoverPercent.value;
    }
    showHoverTime.value = true;
};

const updateHoverTime = (event: MouseEvent) => {
    if (isDragging.value) return;
    updateHoverByClientX(event.clientX);
};

const onMouseMove = (event: MouseEvent) => {
    if (props.alwaysShowScrubber) return;
    updateHoverTime(event);
};

const onMouseLeave = () => {
    if (props.alwaysShowScrubber) return;
    hideHoverTime();
};

const hideHoverTime = () => {
    if (isDragging.value) return;
    showHoverTime.value = false;
};

const stopDragging = (event?: PointerEvent) => {
    if (event && progressAreaRef.value?.hasPointerCapture(event.pointerId)) {
        progressAreaRef.value.releasePointerCapture(event.pointerId);
    }
    activePointerId.value = null;
    isDragging.value = false;
    dragPercent.value = null;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
};

const onPointerDown = (event: PointerEvent) => {
    if (props.disabled || event.button !== 0 || props.duration <= 0) return;
    activePointerId.value = event.pointerId;
    isDragging.value = true;
    progressAreaRef.value?.setPointerCapture(event.pointerId);
    updateHoverByClientX(event.clientX);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
};

const onWindowPointerMove = (event: PointerEvent) => {
    if (!isDragging.value || event.pointerId !== activePointerId.value) return;
    updateHoverByClientX(event.clientX);
};

const onWindowPointerUp = (event: PointerEvent) => {
    if (!isDragging.value || event.pointerId !== activePointerId.value) return;
    updateHoverByClientX(event.clientX);
    emit("seek", hoverTime.value);
    stopDragging(event);
};

const onWindowPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId.value) return;
    stopDragging(event);
    showHoverTime.value = false;
};

const onKeydown = () => {
    showHoverTime.value = false;
};

const displayProgressPercent = computed(() => {
    const percent =
        isDragging.value && dragPercent.value !== null
            ? dragPercent.value
            : props.progressPercent;
    return Math.min(100, Math.max(0, percent));
});

const displayBufferedPercent = computed(() => {
    const raw = Number.isFinite(props.bufferedPercent)
        ? props.bufferedPercent
        : 0;
    const buffered = Math.min(100, Math.max(0, raw));
    return Math.max(buffered, displayProgressPercent.value);
});

const bufferedAheadPercent = computed(() =>
    Math.max(0, displayBufferedPercent.value - displayProgressPercent.value),
);

watch(
    () => props.controlsVisible,
    (visible) => {
        if (visible === false && !isDragging.value) {
            hideHoverTime();
        }
    },
);

onMounted(() => {
    window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
    stopDragging();
    window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
    <div
        ref="progressAreaRef"
        class="progress-area"
        data-window-no-drag
        :class="{
            'is-dragging': isDragging,
            'always-show-scrubber': props.alwaysShowScrubber,
            'is-disabled': props.disabled,
        }"
        :aria-disabled="props.disabled"
        :aria-description="props.disabledReason"
        :data-disabled-reason="props.disabled ? props.disabledReason : undefined"
        :title="props.disabledReason"
        @pointerdown.prevent="onPointerDown"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
    >
        <div
            v-if="showHoverTime && props.showHoverTooltip !== false"
            class="time-tooltip"
            :style="{ left: hoverPercent + '%' }"
        >
            {{ formatTime(hoverTime) }}
        </div>
        <div class="progress-bg">
            <div
                v-if="bufferedAheadPercent > 0.05"
                class="progress-buffer-ahead"
                :style="{
                    left: displayProgressPercent + '%',
                    width: bufferedAheadPercent + '%',
                }"
            ></div>
            <div
                class="progress-current"
                :style="{ width: displayProgressPercent + '%' }"
            ></div>
        </div>
        <div
            class="scrubber-head"
            :style="{ left: displayProgressPercent + '%' }"
        ></div>
    </div>
</template>

<style scoped>
.progress-area {
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
    position: relative;
    touch-action: none;
}

.progress-area.is-disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.progress-area.is-disabled:hover .progress-bg {
    height: 6px;
}

.progress-area.is-disabled[data-disabled-reason]:hover::after {
    content: attr(data-disabled-reason);
    position: absolute;
    z-index: 6;
    bottom: calc(100% + 8px);
    left: 50%;
    width: max-content;
    max-width: min(260px, 70vw);
    padding: 6px 8px;
    border-radius: 5px;
    color: rgba(255, 255, 255, 0.94);
    background: rgba(16, 22, 30, 0.94);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    transform: translateX(-50%);
}

.progress-bg {
    height: 6px;
    width: 100%;
    background: rgba(57, 57, 57, 0.8);
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
    position: relative;
    overflow: hidden;
    transition: height 0.1s;
}

.progress-area:hover .progress-bg {
    height: 6px;
}

.progress-area.is-dragging .progress-bg {
    height: 6px;
}

.progress-area.always-show-scrubber .progress-bg {
    height: 6px;
}

.progress-current {
    height: 100%;
    background: #fff;
    position: relative;
    z-index: 2;
}

.progress-buffer-ahead {
    position: absolute;
    top: 0;
    height: 100%;
    background: #8d8d8d;
    z-index: 1;
    pointer-events: none;
}

.scrubber-head {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translate(-50%, -50%) scale(0.6);
    width: 8px;
    height: 8px;
    background: #fff;
    border: 1px solid rgba(236, 243, 255, 0.95);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(10, 22, 40, 0.2);
    opacity: 0;
    transition:
        transform 0.1s,
        opacity 0.1s;
    z-index: 3;
    pointer-events: none;
}

.progress-area:hover .scrubber-head {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.25);
}

.progress-area.is-dragging .scrubber-head {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.35);
}

.progress-area.always-show-scrubber .scrubber-head,
.progress-area.always-show-scrubber:hover .scrubber-head {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.15);
}

.time-tooltip {
    position: absolute;
    bottom: 12px;
    transform: translateX(-50%);
    background: rgba(28, 28, 28, 0.85);
    color: #fff;
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 6px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
}
</style>
