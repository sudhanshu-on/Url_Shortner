export type UserRole = 'USER' | 'ADMIN';

export interface IUser {
    id: string;
    email: string;
    username: string;
    role: UserRole;
    createdAt: string;
}

export interface AuthUserPayload {
    id: string;
    email: string;
    username: string;
    role: UserRole;
}

export interface UrlRecord {
    id: string | null;
    shortCode: string;
    originalUrl: string;
    customAlias: string | null;
    ownerId: string | null;
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
    activeLinksCount: number;
    expiredLinksCount: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: string;
    avgRedirectLatencyMs: string;
}
