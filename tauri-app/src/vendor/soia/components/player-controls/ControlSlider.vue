<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";

const props = withDefaults(defineProps<{
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    showSign?: boolean;
    showReset?: boolean;
    precision?: number;
}>(), {
    showReset: true,
});

const emit = defineEmits<{
    (e: "change", value: number): void;
    (e: "reset"): void;
}>();

const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const clamp = (value: number) =>
    Math.min(props.max, Math.max(props.min, value));

const snapToStep = (value: number) => {
    if (!props.step || props.step <= 0) return value;
    const snapped = Math.round(value / props.step) * props.step;
    return Number(snapped.toFixed(6));
};

const percent = computed(() => {
    const range = props.max - props.min;
    if (range <= 0) return 0;
    return ((props.value - props.min) / range) * 100;
});

const formatValue = computed(() => {
    const precision =
        typeof props.precision === "number"
            ? props.precision
            : props.step && props.step < 1
              ? Math.max(0, props.step.toString().split(".")[1]?.length ?? 0)
              : 0;
    const value = clamp(props.value);
    const sign = props.showSign && value > 0 ? "+" : "";
    const text = value.toFixed(precision);
    return `${sign}${text}${props.unit ?? ""}`;
});

const stepValue = computed(() => (props.step && props.step > 0 ? props.step : 1));

const updateFromPointer = (clientX: number) => {
    const track = trackRef.value;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const rawValue = props.min + ratio * (props.max - props.min);
    const nextValue = clamp(snapToStep(rawValue));
    emit("change", nextValue);
};

const onPointerMove = (event: PointerEvent) => {
    if (!isDragging.value) return;
    updateFromPointer(event.clientX);
};

const stopDragging = () => {
    if (!isDragging.value) return;
    isDragging.value = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDragging);
};

const onPointerDown = (event: PointerEvent) => {
    isDragging.value = true;
    updateFromPointer(event.clientX);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
};

const nudge = (direction: -1 | 1) => {
    const nextValue = clamp(snapToStep(props.value + direction * stepValue.value));
    emit("change", nextValue);
};

onUnmounted(() => {
    stopDragging();
});
</script>

<template>
    <div class="control-slider">
        <div class="control-slider__label">
            <span>{{ label }}</span>
            <span class="control-slider__value">
                <button
                    class="control-slider__arrow"
                    type="button"
                    @click="nudge(-1)"
                    aria-label="Decrease"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15 6 9 12l6 6V6z" />
                    </svg>
                </button>
                <span class="control-slider__value-text">{{ formatValue }}</span>
                <button
                    class="control-slider__arrow"
                    type="button"
                    @click="nudge(1)"
                    aria-label="Increase"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="m9 6 6 6-6 6V6z" />
                    </svg>
                </button>
                <button
                    v-if="showReset !== false"
                    class="control-slider__reset"
                    type="button"
                    title="Reset"
                    aria-label="Reset"
                    @click="emit('reset')"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        height="12px"
                        viewBox="0 -960 960 960"
                        width="12px"
                        fill="currentColor"
                    >
                        <path
                            d="M440-122q-121-15-200.5-105.5T160-440q0-66 26-126.5T260-672l57 57q-38 34-57.5 79T240-440q0 88 56 155.5T440-202v80Zm80 0v-80q87-16 143.5-83T720-440q0-100-70-170t-170-70h-3l44 44-56 56-140-140 140-140 56 56-44 44h3q134 0 227 93t93 227q0 121-79.5 211.5T520-122Z"
                        />
                    </svg>
                </button>
            </span>
        </div>
        <div
            ref="trackRef"
            class="control-slider__track"
            data-window-no-drag
            @pointerdown.prevent="onPointerDown"
        >
            <div
                class="control-slider__fill"
                :style="{ width: percent + '%' }"
            ></div>
            <div
                class="control-slider__thumb"
                :style="{ left: percent + '%' }"
            ></div>
        </div>
    </div>
</template>

<style scoped>
.control-slider {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.control-slider__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.82);
}

.control-slider__value {
    color: rgba(255, 255, 255, 0.92);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: 0;
}

.control-slider__value-text {
    min-width: 50px;
    text-align: center;
}

.control-slider__arrow {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.control-slider__arrow svg {
    width: 16px;
    height: 16px;
}

.control-slider__arrow:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.95);
}

.control-slider__reset {
    width: 22px;
    height: 22px;
    margin-left: 4px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.control-slider__reset svg {
    width: 14px;
    height: 14px;
}

.control-slider__reset:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.95);
}

.control-slider__track {
    height: 12px;
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
}

.control-slider__fill {
    height: 3px;
    background: #8fb3ff;
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    border-radius: 999px;
}

.control-slider__track::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.25);
    border-radius: 999px;
}

.control-slider__thumb {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #8fb3ff;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 3px rgba(143, 179, 255, 0.2);
}
</style>
