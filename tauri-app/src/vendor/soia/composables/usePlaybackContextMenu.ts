export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: "heart" | "settings" | "subtitle" | "subtitle-advanced-settings" | "subtitle-search" | "remote-control";
    disabled?: boolean;
    children?: ContextMenuItem[];
};
