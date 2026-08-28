import { Request, Response, NextFunction } from 'express';

type RateLimitBucket = {
    count: number;
    resetAt: number;
};

type RateLimitOptions = {
    windowMs: number;
    maxRequests: number;
    message: string;
    keyPrefix: string;
};

const buckets = new Map<string, RateLimitBucket>();

function getClientKey(req: Request, keyPrefix: string): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0];

    return `${keyPrefix}:${forwardedIp?.trim() || req.ip || req.socket.remoteAddress || 'unknown'}`;
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
    if (!value) return fallback;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createRateLimiter(options: RateLimitOptions) {
    return (req: Request, res: Response, next: NextFunction): any => {
        const now = Date.now();
        const key = getClientKey(req, options.keyPrefix);
        const existing = buckets.get(key);

        if (!existing || existing.resetAt <= now) {
            const resetAt = now + options.windowMs;
            buckets.set(key, { count: 1, resetAt });

            res.setHeader('RateLimit-Limit', options.maxRequests.toString());
            res.setHeader('RateLimit-Remaining', (options.maxRequests - 1).toString());
            res.setHeader('RateLimit-Reset', Math.ceil(resetAt / 1000).toString());
            return next();
        }

        const remaining = Math.max(options.maxRequests - existing.count - 1, 0);
        res.setHeader('RateLimit-Limit', options.maxRequests.toString());
        res.setHeader('RateLimit-Remaining', remaining.toString());
        res.setHeader('RateLimit-Reset', Math.ceil(existing.resetAt / 1000).toString());

        if (existing.count >= options.maxRequests) {
            const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfterSeconds.toString());

            return res.status(429).json({
                error: options.message,
                retry_after_seconds: retryAfterSeconds
            });
        }

        existing.count++;
        return next();
    };
}

export const authRateLimiter = createRateLimiter({
    keyPrefix: 'auth',
    windowMs: toPositiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    maxRequests: toPositiveInteger(process.env.AUTH_RATE_LIMIT_MAX, 20),
    message: 'Too many authentication attempts. Please try again later.'
});

export const apiRateLimiter = createRateLimiter({
    keyPrefix: 'api',
    windowMs: toPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    maxRequests: toPositiveInteger(process.env.API_RATE_LIMIT_MAX, 120),
    message: 'Too many API requests. Please slow down and try again shortly.'
});

export const shortenRateLimiter = createRateLimiter({
    keyPrefix: 'shorten',
    windowMs: toPositiveInteger(process.env.SHORTEN_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    maxRequests: toPositiveInteger(process.env.SHORTEN_RATE_LIMIT_MAX, 20),
    message: 'Too many short links created. Please wait a moment before creating more.'
});

export const redirectRateLimiter = createRateLimiter({
    keyPrefix: 'redirect',
    windowMs: toPositiveInteger(process.env.REDIRECT_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    maxRequests: toPositiveInteger(process.env.REDIRECT_RATE_LIMIT_MAX, 300),
    message: 'Too many redirect requests. Please try again shortly.'
});
