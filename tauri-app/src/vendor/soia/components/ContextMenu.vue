<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { ContextMenuItem } from "../composables/usePlaybackContextMenu";

const props = defineProps<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}>();

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "close"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const menuStyle = ref({ left: "0px", top: "0px" });
const isMacOsPlatform =
    typeof navigator !== "undefined" && /mac|darwin/i.test(navigator.userAgent);

const openSubmenuId = ref<string | null>(null);
const submenuStyle = ref({ left: "0px", top: "0px" });
const submenuRef = ref<HTMLElement | null>(null);

const clampPosition = (value: number, size: number, viewportSize: number) =>
    Math.min(Math.max(8, viewportSize - size - 8), Math.max(8, value));

const updateMenuPosition = async () => {
    if (!props.open) return;
    menuStyle.value = {
        left: `${Math.max(8, props.x)}px`,
        top: `${Math.max(8, props.y)}px`,
    };

    await nextTick();

    const menu = menuRef.value;
    const width = menu?.offsetWidth ?? 150;
    const height = menu?.offsetHeight ?? Math.max(40, props.items.length * 34 + 10);

    menuStyle.value = {
        left: `${clampPosition(props.x, width, window.innerWidth)}px`,
        top: `${clampPosition(props.y, height, window.innerHeight)}px`,
    };
};

const updateSubmenuPosition = async (triggerEl: HTMLElement) => {
    await nextTick();
    const submenu = submenuRef.value;
    if (!submenu) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const submenuWidth = submenu.offsetWidth || 160;
    const submenuHeight = submenu.offsetHeight || 80;

    let left = triggerRect.right + 4;
    if (left + submenuWidth + 8 > window.innerWidth) {
        left = triggerRect.left - submenuWidth - 4;
    }
    left = Math.max(8, left);

    let top = triggerRect.top;
    top = clampPosition(top, submenuHeight, window.innerHeight);

    submenuStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
    };
};

const close = () => {
    if (props.open) {
        emit("close");
    }
};

const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
        if (openSubmenuId.value !== null) {
            openSubmenuId.value = null;
        } else {
            close();
        }
    }
};

const onItemClick = (item: ContextMenuItem, event: MouseEvent) => {
    if (item.disabled) return;
    if (item.children?.length) {
        openSubmenuId.value = openSubmenuId.value === item.id ? null : item.id;
        void updateSubmenuPosition(event.currentTarget as HTMLElement);
        return;
    }
    emit("select", item.id);
};

const onItemPointerEnter = (item: ContextMenuItem, event: MouseEvent) => {
    if (item.disabled) return;
    if (item.children?.length) {
        openSubmenuId.value = item.id;
        void updateSubmenuPosition(event.currentTarget as HTMLElement);
    } else {
        openSubmenuId.value = null;
    }
};

const onSubmenuItemClick = (child: ContextMenuItem) => {
    if (child.disabled) return;
    emit("select", child.id);
};

watch(
    () => [props.open, props.x, props.y, props.items.length],
    () => {
        void updateMenuPosition();
        openSubmenuId.value = null;
    },
);

onMounted(() => {
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
});

onUnmounted(() => {
    window.removeEventListener("click", close);
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
});
</script>

<template>
    <Teleport to="body">
        <div
            v-if="props.open"
            ref="menuRef"
            class="context-menu"
            :class="{ 'context-menu--macos': isMacOsPlatform }"
            :style="menuStyle"
            role="menu"
            @mousedown.prevent.stop
            @click.stop
            @contextmenu.prevent.stop
        >
            <button
                v-for="item in props.items"
                :key="item.id"
                class="context-menu__item"
                :class="{
                    'context-menu__item--with-icon': item.icon,
                    'context-menu__item--has-submenu': item.children?.length,
                    'context-menu__item--submenu-open': openSubmenuId === item.id,
                }"
                type="button"
                role="menuitem"
                :disabled="item.disabled"
                @click="onItemClick(item, $event)"
                @pointerenter="onItemPointerEnter(item, $event)"
            >
                <span
                    v-if="item.icon"
                    class="context-menu__icon"
                    aria-hidden="true"
                >
                    <svg
                        v-if="item.icon === 'heart'"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"
                        />
                    </svg>
                    <svg
                        v-else-if="item.icon === 'subtitle'"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M4 5h16" />
                        <path d="M4 19h16" />
                        <path d="M7 9h4" />
                        <path d="M13 9h4" />
                        <path d="M7 15h2" />
                        <path d="M11 15h6" />
                    </svg>
                    <svg
                        v-else-if="item.icon === 'settings'"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <circle cx="12" cy="12" r="3" />
                        <path
                            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.1-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.1.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.1.4 1.65 1.65 0 0 0-.6 1Z"
                        />
                    </svg>
                    <svg
                        v-else-if="item.icon === 'subtitle-advanced-settings'"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                    >
                        <path
                            d="M5 7q-.83 0-1.415-.585Q3 5.83 3 5q0-.83.585-1.415Q4.17 3 5 3q.83 0 1.415.585Q7 4.17 7 5q0 .83-.585 1.415Q5.83 7 5 7Zm0-2ZM2 6V4H1v2h1Zm21 0V4H8v2h15Zm-8 8q-.83 0-1.415-.585Q13 12.83 13 12q0-.83.585-1.415Q14.17 10 15 10q.83 0 1.415.585Q17 11.17 17 12q0 .83-.585 1.415Q15.83 14 15 14Zm0-2ZM12 13v-2H1v2h11Zm11 0v-2h-5v2h5ZM8 21q-.83 0-1.415-.585Q6 19.83 6 19q0-.83.585-1.415Q7.17 17 8 17q.83 0 1.415.585Q10 18.17 10 19q0 .83-.585 1.415Q8.83 21 8 21Zm0-2ZM5 20v-2H1v2h4Zm18 0v-2H11v2h12Z"
                        />
                    </svg>
                    <svg
                        v-else-if="item.icon === 'subtitle-search'"
                        viewBox="0 -960 960 960"
                        fill="currentColor"
                    >
                        <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
                    </svg>
                    <svg
                        v-else-if="item.icon === 'remote-control'"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <rect x="4.5" y="2.5" width="9" height="19" rx="2" />
                        <path d="M8 18.25h2" />
                        <path d="M16.5 9.25a4.5 4.5 0 0 1 0 5.5" />
                        <path d="M19 6.5a8 8 0 0 1 0 11" />
                    </svg>
                </span>
                {{ item.label }}
                <span
                    v-if="item.children?.length"
                    class="context-menu__chevron"
                    aria-hidden="true"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6" />
                    </svg>
                </span>
            </button>
        </div>

        <!-- Submenu -->
        <div
            v-if="props.open && openSubmenuId !== null"
            ref="submenuRef"
            class="context-menu context-menu--submenu"
            :class="{ 'context-menu--macos': isMacOsPlatform }"
            :style="submenuStyle"
            role="menu"
            @mousedown.prevent.stop
            @click.stop
            @contextmenu.prevent.stop
        >
            <template v-for="item in props.items" :key="item.id">
                <template v-if="item.id === openSubmenuId && item.children">
                    <button
                        v-for="child in item.children"
                        :key="child.id"
                        class="context-menu__item"
                        :class="{ 'context-menu__item--with-icon': child.icon }"
                        type="button"
                        role="menuitem"
                        :disabled="child.disabled"
                        @click="onSubmenuItemClick(child)"
                    >
                        <span
                            v-if="child.icon"
                            class="context-menu__icon"
                            aria-hidden="true"
                        >
                            <svg
                                v-if="child.icon === 'heart'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path
                                    d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"
                                />
                            </svg>
                            <svg
                                v-else-if="child.icon === 'subtitle'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M4 5h16" />
                                <path d="M4 19h16" />
                                <path d="M7 9h4" />
                                <path d="M13 9h4" />
                                <path d="M7 15h2" />
                                <path d="M11 15h6" />
                            </svg>
                            <svg
                                v-else-if="child.icon === 'settings'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <circle cx="12" cy="12" r="3" />
                                <path
                                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.1-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.1.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.1.4 1.65 1.65 0 0 0-.6 1Z"
                                />
                            </svg>
                            <svg
                                v-else-if="child.icon === 'subtitle-advanced-settings'"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path
                                    d="M5 7q-.83 0-1.415-.585Q3 5.83 3 5q0-.83.585-1.415Q4.17 3 5 3q.83 0 1.415.585Q7 4.17 7 5q0 .83-.585 1.415Q5.83 7 5 7Zm0-2ZM2 6V4H1v2h1Zm21 0V4H8v2h15Zm-8 8q-.83 0-1.415-.585Q13 12.83 13 12q0-.83.585-1.415Q14.17 10 15 10q.83 0 1.415.585Q17 11.17 17 12q0 .83-.585 1.415Q15.83 14 15 14Zm0-2ZM12 13v-2H1v2h11Zm11 0v-2h-5v2h5ZM8 21q-.83 0-1.415-.585Q6 19.83 6 19q0-.83.585-1.415Q7.17 17 8 17q.83 0 1.415.585Q10 18.17 10 19q0 .83-.585 1.415Q8.83 21 8 21Zm0-2ZM5 20v-2H1v2h4Zm18 0v-2H11v2h12Z"
                                />
                            </svg>
                            <svg
                                v-else-if="child.icon === 'subtitle-search'"
                                viewBox="0 -960 960 960"
                                fill="currentColor"
                            >
                                <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
                            </svg>
                        </span>
                        {{ child.label }}
                    </button>
                </template>
            </template>
        </div>
    </Teleport>
</template>

<style scoped>
:global(:root) {
    --context-menu-border: rgba(33, 45, 60, 0.12);
    --context-menu-background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.5)),
        rgba(247, 249, 252, 0.9);
    --context-menu-shadow:
        0 18px 42px rgba(33, 45, 60, 0.18),
        0 2px 8px rgba(33, 45, 60, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.9);
    --context-menu-macos-border: rgba(33, 45, 60, 0.11);
    --context-menu-macos-background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.36)),
        rgba(246, 248, 252, 0.58);
    --context-menu-macos-shadow:
        0 22px 56px rgba(33, 45, 60, 0.2),
        0 7px 18px rgba(33, 45, 60, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.95);
    --context-menu-item-color: rgba(33, 45, 60, 0.9);
    --context-menu-item-hover-bg: rgba(57, 108, 216, 0.9);
    --context-menu-item-hover-color: #fff;
    --context-menu-item-active-bg: rgba(73, 122, 211, 0.9);
    --context-menu-item-disabled-color: rgba(33, 45, 60, 0.36);
}

:global(:root:is([data-theme="dark"], [data-theme="graphite"])) {
    --context-menu-border: rgba(255, 255, 255, 0.16);
    --context-menu-background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0)),
        rgba(20, 22, 29, 0.94);
    --context-menu-shadow:
        0 18px 42px rgba(0, 0, 0, 0.42),
        0 2px 8px rgba(0, 0, 0, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
    --context-menu-macos-border: rgba(255, 255, 255, 0.2);
    --context-menu-macos-background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.03)),
        rgba(30, 32, 40, 0.62);
    --context-menu-macos-shadow:
        0 22px 56px rgba(0, 0, 0, 0.38),
        0 7px 18px rgba(0, 0, 0, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.18),
        inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    --context-menu-item-color: rgba(255, 255, 255, 0.9);
    --context-menu-item-hover-bg: rgba(86, 137, 232, 0.86);
    --context-menu-item-hover-color: #fff;
    --context-menu-item-active-bg: rgba(73, 122, 211, 0.9);
    --context-menu-item-disabled-color: rgba(255, 255, 255, 0.34);
}

@media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) {
        --context-menu-border: rgba(255, 255, 255, 0.16);
        --context-menu-background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0)),
            rgba(20, 22, 29, 0.94);
        --context-menu-shadow:
            0 18px 42px rgba(0, 0, 0, 0.42),
            0 2px 8px rgba(0, 0, 0, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        --context-menu-macos-border: rgba(255, 255, 255, 0.2);
        --context-menu-macos-background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.03)),
            rgba(30, 32, 40, 0.62);
        --context-menu-macos-shadow:
            0 22px 56px rgba(0, 0, 0, 0.38),
            0 7px 18px rgba(0, 0, 0, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.18),
            inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        --context-menu-item-color: rgba(255, 255, 255, 0.9);
        --context-menu-item-hover-bg: rgba(86, 137, 232, 0.86);
        --context-menu-item-hover-color: #fff;
        --context-menu-item-active-bg: rgba(73, 122, 211, 0.9);
        --context-menu-item-disabled-color: rgba(255, 255, 255, 0.34);
    }
}

.context-menu {
    position: fixed;
    z-index: 2600;
    display: grid;
    min-width: 156px;
    overflow: hidden;
    padding: 6px;
    border: 1px solid var(--context-menu-border);
    border-radius: 11px;
    background: var(--context-menu-background);
    box-shadow: var(--context-menu-shadow);
    backdrop-filter: blur(22px) saturate(1.18);
    -webkit-backdrop-filter: blur(22px) saturate(1.18);
    transform-origin: top left;
    animation: context-menu-pop 110ms ease-out;
}

.context-menu--macos {
    border-color: var(--context-menu-macos-border);
    background: var(--context-menu-macos-background);
    box-shadow: var(--context-menu-macos-shadow);
    backdrop-filter: blur(34px) saturate(1.85) brightness(1.04);
    -webkit-backdrop-filter: blur(34px) saturate(1.85) brightness(1.04);
}

.context-menu--submenu {
    z-index: 2601;
    animation: context-menu-pop 90ms ease-out;
}

.context-menu__item {
    width: 100%;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--context-menu-item-color);
    cursor: default;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.25;
    min-height: 30px;
    padding: 6px 12px;
    text-align: left;
    display: grid;
    align-items: center;
    transition:
        background-color 80ms ease,
        color 80ms ease;
}

.context-menu__item--with-icon {
    grid-template-columns: 16px 1fr;
    gap: 8px;
}

.context-menu__item--has-submenu {
    grid-template-columns: 16px 1fr 12px;
}

.context-menu__icon {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: currentColor;
    opacity: 0.88;
}

.context-menu__icon svg {
    width: 12px;
    height: 12px;
    display: block;
}

.context-menu__chevron {
    width: 12px;
    height: 12px;
    display: grid;
    place-items: center;
    opacity: 0.6;
}

.context-menu__chevron svg {
    width: 12px;
    height: 12px;
    display: block;
}

.context-menu__item:not(:disabled):hover,
.context-menu__item:not(:disabled):focus-visible,
.context-menu__item--submenu-open:not(:disabled) {
    background: var(--context-menu-item-hover-bg);
    color: var(--context-menu-item-hover-color);
    outline: none;
}

.context-menu__item:not(:disabled):active {
    background: var(--context-menu-item-active-bg);
}

.context-menu__item:disabled {
    color: var(--context-menu-item-disabled-color);
}

@keyframes context-menu-pop {
    from {
        opacity: 0;
        transform: scale(0.985) translateY(-2px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .context-menu {
        animation: none;
    }
}
</style>
