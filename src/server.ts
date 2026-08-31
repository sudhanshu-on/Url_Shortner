import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { generateRandomBase62, LRUCache } from './utils';
import { UrlRecord, ShortenRequest } from './types';
import { 
    initDatabase, 
    saveUrlRecord, 
    getUrlRecord, 
    getUserUrlRecords,
    deleteUserUrlRecord,
    recordClick
} from './db';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import { authenticateUser, AuthenticatedRequest } from './middleware/auth';
import { apiRateLimiter, authRateLimiter, redirectRateLimiter, shortenRateLimiter } from './middleware/rateLimit';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// LRU Cache for hot URL lookups
const cache = new LRUCache<string, UrlRecord>(1000);
let cacheHits = 0;
let cacheMisses = 0;

// Share cache instance & counters with admin routes
app.set('lruCache', cache);
app.set('cacheHits', cacheHits);
app.set('cacheMisses', cacheMisses);

// Initialize DB on server start
initDatabase().then(() => {
    console.log("[Database] Database connection established.");
}).catch(err => {
    console.error("[Database Error] Failed to initialize database:", err);
});

function isValidUrl(stringUrl: string): boolean {
    try {
        const url = new URL(stringUrl);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;
    }
}

function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
    if (!expiresAt) return false;

    const expiryTime = Date.parse(expiresAt);
    return Number.isFinite(expiryTime) && expiryTime <= now;
}

function shouldSkipShortCodeRoute(shortCode: string): boolean {
    return shortCode.includes('.') ||
        shortCode === 'api' ||
        shortCode === 'dashboard' ||
        shortCode === 'admin' ||
        shortCode === 'login';
}

// --- AUTH ROUTES ---
app.use('/api/v1/auth', authRateLimiter, authRoutes);

// --- ADMIN ROUTES ---
app.use('/api/v1/admin', apiRateLimiter, adminRoutes);

// --- PROTECTED USER URL ROUTES ---

/**
 * 1. POST /api/v1/shorten
 * Create Short URL (Authenticated User required)
 * Automatically binds ownerId to req.user.id
 */
app.post('/api/v1/shorten', apiRateLimiter, shortenRateLimiter, authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    const { url, custom_alias, ttl_seconds } = req.body;
    const userId = req.user!.id;

    if (!url || !isValidUrl(url)) {
        return res.status(400).json({ error: "Invalid URL provided. Please include http:// or https://" });
    }

    let shortCode: string | null = custom_alias ? custom_alias.trim() : null;

    if (shortCode) {
        if (!/^[a-zA-Z0-9_-]{3,30}$/.test(shortCode)) {
            return res.status(400).json({ error: "Custom alias must be 3-30 alphanumeric characters." });
        }
        const existing = await getUrlRecord(shortCode);
        if (existing) {
            return res.status(409).json({ error: `Custom alias '${shortCode}' is already taken.` });
        }
    } else {
        let attempts = 0;
        do {
            shortCode = generateRandomBase62(7);
            attempts++;
            const existing = await getUrlRecord(shortCode);
            if (!existing) break;
        } while (attempts < 10);
    }

    const now = new Date();
    const ttlParsed = ttl_seconds ? parseInt(ttl_seconds.toString()) : 0;
    const expiresAt = ttlParsed > 0 
        ? new Date(now.getTime() + ttlParsed * 1000).toISOString()
        : null;

    const recordInput: UrlRecord = {
        id: null,
        shortCode,
        originalUrl: url,
        customAlias: custom_alias || null,
        ownerId: userId, // Securely set from req.user.id
        createdAt: now.toISOString(),
        expiresAt,
        clickCount: 0,
        clicksLog: []
    };

    const savedRecord = await saveUrlRecord(recordInput);
    cache.set(shortCode, savedRecord);

    const protocol = req.protocol;
    const host = req.get('host');
    const shortUrl = `${protocol}://${host}/${shortCode}`;

    return res.status(201).json({
        short_code: shortCode,
        short_url: shortUrl,
        original_url: url,
        expires_at: expiresAt,
        created_at: savedRecord.createdAt
    });
});

/**
 * 2. GET /api/v1/links
 * Fetch User's Recent Links ONLY (Scoped by req.user.id)
 */
app.get('/api/v1/links', apiRateLimiter, authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    const userId = req.user!.id;
    const userRecords = await getUserUrlRecords(userId);

    return res.json(userRecords.map(record => ({
        short_code: record.shortCode,
        original_url: record.originalUrl,
        click_count: record.clickCount,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        is_expired: isExpired(record.expiresAt)
    })));
});

/**
 * 3. GET /api/v1/analytics/:short_code
 * Get Analytics for a link owned by the authenticated user (Prevents IDOR)
 */
app.get('/api/v1/analytics/:short_code', apiRateLimiter, authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    const short_code = Array.isArray(req.params.short_code) ? req.params.short_code[0] : req.params.short_code;
    const userId = req.user!.id;

    let record = cache.get(short_code);
    if (!record) {
        record = await getUrlRecord(short_code);
        if (record) cache.set(short_code, record);
    }

    if (!record) {
        return res.status(404).json({ error: "Short URL not found" });
    }

    // Ownership check (Unless user is ADMIN)
    if (record.ownerId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden. You do not own this URL." });
    }

    return res.json({
        short_code: record.shortCode,
        original_url: record.originalUrl,
        click_count: record.clickCount,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        is_expired: isExpired(record.expiresAt),
        recent_clicks: record.clicksLog.slice(-10)
    });
});

/**
 * 4. DELETE /api/v1/links/:short_code
 * Delete short URL (Ownership verified)
 */
app.delete('/api/v1/links/:short_code', apiRateLimiter, authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    const short_code = Array.isArray(req.params.short_code) ? req.params.short_code[0] : req.params.short_code;
    const userId = req.user!.id;

    const record = await getUrlRecord(short_code);
    if (!record) {
        return res.status(404).json({ error: "Short URL not found" });
    }

    if (record.ownerId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden. You cannot delete this URL." });
    }

    await deleteUserUrlRecord(short_code, userId);
    cache.delete(short_code);

    return res.json({ message: "Short link deleted successfully." });
});

// --- PUBLIC ROUTE ---

/**
 * 5. GET /{short_code}
 * PUBLIC 302 REDIRECT ENGINE (No Auth Required)
 * Flow: LRU Memory Cache -> MongoDB -> Warm Cache -> 302 Redirect (or 410 Expired)
 */
app.get('/:short_code', (req: Request, _res: Response, next: NextFunction) => {
    const short_code = Array.isArray(req.params.short_code)
    ? req.params.short_code[0] 
    : req.params.short_code;

    if (shouldSkipShortCodeRoute(short_code)) {
        return next('route');
    }

    return redirectRateLimiter(req, _res, next);
}, async (req: Request, res: Response): Promise<any> => {
    const short_code = Array.isArray(req.params.short_code) ? req.params.short_code[0] : req.params.short_code;
    const startTime = process.hrtime();

    let record = cache.get(short_code);
    let fromCache = true;

    if (!record) {
        fromCache = false;
        cacheMisses++;
        app.set('cacheMisses', cacheMisses);
        record = await getUrlRecord(short_code);
    } else {
        cacheHits++;
        app.set('cacheHits', cacheHits);
    }

    if (!record) {
        return res.status(404).sendFile(path.join(__dirname, '../public', '404.html'));
    }

    // Check link expiration (TTL)
    if (isExpired(record.expiresAt)) {
        return res.status(410).send(`
            <div style="font-family:sans-serif; text-align:center; padding: 50px; background:#0f172a; color:#fff; min-height:100vh;">
                <h1 style="color:#e11d48; font-size: 2.5rem;">410 Link Expired</h1>
                <p style="color:#9ca3af;">This shortened URL reached its expiration time and is no longer available.</p>
                <br/>
                <a href="/login" style="color:#38bdf8; text-decoration:none; font-weight:bold;">Return to Home</a>
            </div>
        `);
    }

    const diff = process.hrtime(startTime);
    const latencyMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(3);

    const clickEntry = {
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent') || 'Unknown',
        latencyMs: `${latencyMs}ms`,
        cached: fromCache
    };

    record.clickCount++;
    record.clicksLog.push(clickEntry);
    cache.set(short_code, record);

    await recordClick(short_code, clickEntry);

    return res.redirect(302, record.originalUrl);
});

// SPA Route Handlers
app.get('/dashboard', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

app.get('/admin', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

app.get('/login', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`[TypeScript Server] Running on http://localhost:${PORT}`);
});
