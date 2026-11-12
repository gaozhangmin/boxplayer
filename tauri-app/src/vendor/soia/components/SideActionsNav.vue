<script setup lang="ts">
type SideActionId = "home" | "history" | "network" | "settings";

const props = defineProps<{
    isPlaybackActive: boolean;
    activePanel: SideActionId;
    navActivePanel: SideActionId | null;
}>();

const emit = defineEmits<{
    navigate: [panel: SideActionId];
}>();

const getTitle = (panel: SideActionId) => {
    const panelName = panel[0].toUpperCase() + panel.slice(1);
    return panelName;
};

const onNavigate = (panel: SideActionId) => {
    emit("navigate", panel);
};
</script>

<template>
    <nav class="side-actions ui-surface" aria-label="Primary">
        <button
            class="side-actions__btn"
            :class="{ 'side-actions__btn--active': navActivePanel === 'home' }"
            type="button"
            :title="getTitle('home')"
            :aria-label="getTitle('home')"
            @click="onNavigate('home')"
        >
            <svg
                class="side-actions__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M3 10.5L12 3l9 7.5" />
                <path d="M5 10v10h14V10" />
                <path d="M9 20v-6h6v6" />
            </svg>
        </button>
        <button
            class="side-actions__btn"
            :class="{
                'side-actions__btn--active': navActivePanel === 'history',
            }"
            type="button"
            :title="getTitle('history')"
            :aria-label="getTitle('history')"
            @click="onNavigate('history')"
        >
            <svg
                class="side-actions__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v6l4 2" />
            </svg>
        </button>
        <button
            class="side-actions__btn"
            :class="{
                'side-actions__btn--active': navActivePanel === 'network',
            }"
            type="button"
            :title="getTitle('network')"
            :aria-label="getTitle('network')"
            @click="onNavigate('network')"
        >
            <svg
                class="side-actions__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M2 12h20" />
                <path d="M12 3c3 3.5 3 14.5 0 18" />
                <path d="M12 3c-3 3.5-3 14.5 0 18" />
            </svg>
        </button>
        <button
            class="side-actions__btn"
            :class="{
                'side-actions__btn--active': navActivePanel === 'settings',
            }"
            type="button"
            :title="getTitle('settings')"
            :aria-label="getTitle('settings')"
            @click="onNavigate('settings')"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="side-actions__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <g transform="rotate(30 12 12)">
                    <path d="M8.4 5.76 C8.81 5.53 9.42 4.16 9.81 3.84 C10.2 3.51 11.53 2.75 12 2.75 C12.47 2.75 13.8 3.51 14.19 3.84 C14.58 4.16 15.19 5.53 15.6 5.76 C16.01 6 17.5 5.85 17.98 6.02 C18.45 6.2 19.77 6.96 20.01 7.38 C20.25 7.79 20.25 9.31 20.16 9.81 C20.07 10.31 19.2 11.53 19.2 12 C19.2 12.47 20.07 13.69 20.16 14.19 C20.25 14.69 20.25 16.21 20.01 16.63 C19.77 17.04 18.45 17.8 17.98 17.98 C17.5 18.15 16.01 18 15.6 18.24 C15.19 18.47 14.58 19.84 14.19 20.16 C13.8 20.49 12.47 21.25 12 21.25 C11.53 21.25 10.2 20.49 9.81 20.16 C9.42 19.84 8.81 18.47 8.4 18.24 C7.99 18 6.5 18.15 6.02 17.98 C5.55 17.8 4.23 17.04 3.99 16.63 C3.75 16.21 3.75 14.69 3.84 14.19 C3.93 13.69 4.8 12.47 4.8 12 C4.8 11.53 3.93 10.31 3.84 9.81 C3.75 9.31 3.75 7.79 3.99 7.37 C4.23 6.96 5.55 6.2 6.02 6.02 C6.5 5.85 7.99 6 8.4 5.76 Z" />
                    <circle cx="12" cy="12" r="3" />
                </g>
            </svg>
        </button>
    </nav>
</template>

<style scoped>
.side-actions {
    position: fixed;
    left: 24px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    z-index: 120;
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    overflow: hidden;
}

.side-actions__btn {
    border: none;
    background: transparent;
    color: var(--text-color);
    padding: 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background-color 0.2s ease;
    white-space: nowrap;
    position: relative;
}

.side-actions__btn + .side-actions__btn {
    border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.side-actions__btn:hover {
    background: rgba(0, 0, 0, 0.14);
}

.side-actions__btn--active {
    background: rgba(0, 0, 0, 0.08);
}

.side-actions__btn--active .side-actions__icon {
    transform: scale(1.05);
}

.side-actions__icon {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme]) .side-actions {
        border-color: rgba(255, 255, 255, 0.2);
    }

    :root:not([data-theme]) .side-actions__btn {
        color: #f6f6f6;
    }

    :root:not([data-theme]) .side-actions__btn + .side-actions__btn {
        border-top-color: rgba(255, 255, 255, 0.12);
    }

    :root:not([data-theme]) .side-actions__btn:hover {
        background: rgba(255, 255, 255, 0.16);
    }

    :root:not([data-theme]) .side-actions__btn--active {
        background: rgba(255, 255, 255, 0.12);
    }
}

:root[data-theme="dark"] .side-actions,
:root[data-theme="graphite"] .side-actions {
    border-color: rgba(255, 255, 255, 0.2);
}

:root[data-theme="dark"] .side-actions__btn,
:root[data-theme="graphite"] .side-actions__btn {
    color: #f6f6f6;
}

:root[data-theme="dark"] .side-actions__btn + .side-actions__btn,
:root[data-theme="graphite"] .side-actions__btn + .side-actions__btn {
    border-top-color: rgba(255, 255, 255, 0.12);
}

:root[data-theme="dark"] .side-actions__btn:hover,
:root[data-theme="graphite"] .side-actions__btn:hover {
    background: rgba(255, 255, 255, 0.16);
}

:root[data-theme="dark"] .side-actions__btn--active,
:root[data-theme="graphite"] .side-actions__btn--active {
    background: rgba(255, 255, 255, 0.12);
}
</style>
