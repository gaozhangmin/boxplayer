const SOIA_WEBDAV_KEY_PREFIX = "soia-webdav://";
const SOIA_DLNA_KEY_PREFIX = "soia-dlna://";
const SOIA_SMB_KEY_PREFIX = "soia-smb://";

type PlaybackDisplaySource =
    | {
          kind: "local";
          path: string;
      }
    | {
          kind: "webdav";
          connectionId: string;
          filePath: string;
      }
    | {
          kind: "dlna";
          resourceUrl: string;
      }
    | {
          kind: "smb";
          url?: string;
          connectionId?: string;
          filePath?: string;
      };

const normalizeFilePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || trimmed === "/") return "/";
    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeading.replace(/\/+$/, "");
};

const parseWebdavKey = (
    key: string,
    prefix: string,
): {
    connectionId: string;
    filePath: string;
} | null => {
    if (!key.startsWith(prefix)) return null;
    const value = key.slice(prefix.length);
    const slashIndex = value.indexOf("/");
    if (slashIndex <= 0) return null;
    const connectionId = value.slice(0, slashIndex);
    const filePath = normalizeFilePath(value.slice(slashIndex));
    if (!connectionId || !filePath) return null;
    return { connectionId, filePath };
};

const parseDlnaKey = (
    key: string,
): {
    resourceUrl: string;
} | null => {
    if (!key.startsWith(SOIA_DLNA_KEY_PREFIX)) return null;
    const value = key.slice(SOIA_DLNA_KEY_PREFIX.length);
    const slashIndex = value.indexOf("/");
    if (slashIndex <= 0) return null;
    const encodedConnectionId = value.slice(0, slashIndex);
    const encodedParts = value.slice(slashIndex + 1).split("/");
    const encodedResourceUrl = encodedParts[0] ?? "";
    const encodedParentPath = encodedParts[1] ?? "";
    if (!encodedConnectionId || !encodedResourceUrl) return null;
    try {
        decodeURIComponent(encodedConnectionId);
        if (encodedParentPath) decodeURIComponent(encodedParentPath);
        return {
            resourceUrl: decodeURIComponent(encodedResourceUrl),
        };
    } catch {
        return null;
    }
};

const parsePlaybackDisplaySource = (key: string): PlaybackDisplaySource => {
    const soiaWebdav = parseWebdavKey(key, SOIA_WEBDAV_KEY_PREFIX);
    if (soiaWebdav) {
        return {
            kind: "webdav",
            connectionId: soiaWebdav.connectionId,
            filePath: soiaWebdav.filePath,
        };
    }

    const soiaDlna = parseDlnaKey(key);
    if (soiaDlna) {
        return {
            kind: "dlna",
            resourceUrl: soiaDlna.resourceUrl,
        };
    }

    const soiaSmb = parseWebdavKey(key, SOIA_SMB_KEY_PREFIX);
    if (soiaSmb) {
        try {
            return {
                kind: "smb",
                connectionId: decodeURIComponent(soiaSmb.connectionId),
                filePath: soiaSmb.filePath,
            };
        } catch {
            return {
                kind: "local",
                path: key,
            };
        }
    }

    if (/^smb:\/\//i.test(key)) {
        return {
            kind: "smb",
            url: key,
        };
    }

    return {
        kind: "local",
        path: key,
    };
};

export const normalizePlaybackKey = (key: string): string => key;

const formatWebdavDisplayHost = (connectionId: string): string => {
    const trimmed = connectionId.trim();
    if (!trimmed) return "webdav";
    const stripped = trimmed.replace(/^webdav-/i, "");
    return stripped || trimmed;
};

export const formatPathWithHomePrefix = (path: string): string => {
    const trimmed = path.trim();
    if (!trimmed) return path;
    const match = trimmed.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
    if (!match) return path;
    return `~${match[1] ?? ""}`;
};

export const getPlaybackDisplayPath = (key: string): string => {
    const source = parsePlaybackDisplaySource(key);
    if (source.kind === "webdav") {
        const host = formatWebdavDisplayHost(source.connectionId);
        const normalizedPath = source.filePath.replace(/^\/+/, "");
        return normalizedPath
            ? `webdav://${host}/${normalizedPath}`
            : `webdav://${host}`;
    }
    if (source.kind === "dlna") {
        return source.resourceUrl;
    }
    if (source.kind === "smb") {
        if (source.url) return source.url;
        const host = source.connectionId?.replace(/^smb-/i, "") || "smb";
        const normalizedPath = source.filePath?.replace(/^\/+/, "") ?? "";
        return normalizedPath ? `smb://${host}/${normalizedPath}` : `smb://${host}`;
    }
    return source.path;
};

export const getPlaybackDisplayPathWithHomePrefix = (key: string): string => {
    const display = getPlaybackDisplayPath(key);
    return display === key ? formatPathWithHomePrefix(display) : display;
};

export const getPlaybackDisplayNamePath = (key: string): string => {
    const source = parsePlaybackDisplaySource(key);
    if (source.kind === "webdav") return source.filePath;
    if (source.kind === "dlna") return source.resourceUrl;
    if (source.kind === "smb") return source.url ?? source.filePath ?? key;
    return source.path;
};

export const getPlaybackProtocolId = (key: string): string => {
    const source = parsePlaybackDisplaySource(key);
    if (source.kind !== "local") return source.kind;

    const normalized = source.path.trim().toLowerCase();
    if (normalized.startsWith("smb://")) return "smb";
    if (normalized.startsWith("ftps://")) return "ftps";
    if (normalized.startsWith("ftp://")) return "ftp";
    if (normalized.startsWith("https://")) return "https";
    if (normalized.startsWith("http://")) return "http";
    return "local";
};

export const isLikelyNetworkPlaybackKey = (key: string): boolean =>
    getPlaybackProtocolId(key) !== "local";
