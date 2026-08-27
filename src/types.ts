export interface UrlRecord {
    id: string | null;
    shortCode: string;
    originalUrl: string;
    customAlias: string | null;
    createdAt: string;
    expiresAt: string | null;
    clickCount: number;
    clicksLog: ClickLogEntry[];
}

export interface ClickLogEntry {
    timestamp: string;
    userAgent: string;
    latencyMs: string;
    cached: boolean;
}

export interface ShortenRequest {
    url: string;
    custom_alias?: string;
    ttl_seconds?: number | string;
}

export interface SystemStats {
    totalShortened: number;
    totalRedirects: number;
    cacheHits: number;
    cacheMisses: number;
}
