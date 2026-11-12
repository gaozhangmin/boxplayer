export const getPathDisplayName = (path: string, fallback = ""): string => {
    if (!path) return fallback;
    const parts = path.split(/[/\\\\]/);
    return parts[parts.length - 1] || path || fallback;
};
