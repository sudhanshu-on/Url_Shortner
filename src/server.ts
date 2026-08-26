import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { generateRandomBase62, LRUCache } from './utils';
import { UrlRecord, ShortenRequest } from './types';
import { 
    initDatabase, 
    saveUrlRecord, 
    getUrlRecord, 
    getAllUrlRecords, 
    recordClick, 
    getSystemStatsFromDb 
} from './db';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// LRU Cache for hot URL lookups
const cache = new LRUCache<string, UrlRecord>(1000);

let cacheHits = 0;
let cacheMisses = 0;

// Initialize DB on server start
initDatabase().then(() => {
    console.log("[Database] SQLite database initialized (urls.db). Zero seed data loaded.");
}).catch(err => {
    console.error("[Database Error] Failed to initialize SQLite DB", err);
});

function isValidUrl(stringUrl: string): boolean {
    try {
        const url = new URL(stringUrl);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;
    }
}

// 1. Create Short URL Endpoint
app.post('/api/v1/shorten', async (req: Request<{}, {}, ShortenRequest>, res: Response): Promise<any> => {
    const { url, custom_alias, ttl_seconds } = req.body;

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

    const record: UrlRecord = {
        id: 0, // Assigned by SQLite
        shortCode,
        originalUrl: url,
        customAlias: custom_alias || null,
        createdAt: now.toISOString(),
        expiresAt,
        clickCount: 0,
        clicksLog: []
    };

    // Save to persistent database & warm LRU Cache
    await saveUrlRecord(record);
    cache.set(shortCode, record);

    const protocol = req.protocol;
    const host = req.get('host');
    const shortUrl = `${protocol}://${host}/${shortCode}`;

    return res.status(201).json({
        short_code: shortCode,
        short_url: shortUrl,
        original_url: url,
        expires_at: expiresAt,
        created_at: record.createdAt
    });
});

// 2. Short URL Analytics Endpoint
app.get('/api/v1/analytics/:short_code', async (req: Request, res: Response): Promise<any> => {
    const short_code = Array.isArray(req.params.short_code) ? req.params.short_code[0] : req.params.short_code;
    
    let record = cache.get(short_code);
    if (record) {
        cacheHits++;
    } else {
        cacheMisses++;
        record = await getUrlRecord(short_code);
        if (record) cache.set(short_code, record);
    }

    if (!record) {
        return res.status(404).json({ error: "Short URL not found" });
    }

    return res.json({
        short_code: record.shortCode,
        original_url: record.originalUrl,
        click_count: record.clickCount,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        recent_clicks: record.clicksLog.slice(-10)
    });
});

// 3. Get All Active Stored Links Endpoint
app.get('/api/v1/links', async (_req: Request, res: Response): Promise<any> => {
    const records = await getAllUrlRecords();
    return res.json(records.map(record => ({
        short_code: record.shortCode,
        original_url: record.originalUrl,
        click_count: record.clickCount,
        created_at: record.createdAt,
        expires_at: record.expiresAt
    })));
});

// 4. System Stats Endpoint
app.get('/api/v1/system/stats', async (_req: Request, res: Response) => {
    const dbStats = await getSystemStatsFromDb();
    const totalRequests = cacheHits + cacheMisses;
    const hitRate = totalRequests > 0 
        ? ((cacheHits / totalRequests) * 100).toFixed(1)
        : "100";

    res.json({
        system_stats: {
            totalShortened: dbStats.totalShortened,
            totalRedirects: dbStats.totalRedirects,
            cacheHits,
            cacheMisses
        },
        cache_hit_rate: `${hitRate}%`,
        active_records: dbStats.totalShortened,
        cache_size: cache.size()
    });
});

// 5. Redirect Engine Endpoint (GET /{short_code})
app.get('/:short_code', async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    const short_code = Array.isArray(req.params.short_code) ? req.params.short_code[0] : req.params.short_code;

    if (short_code.includes('.') || short_code === 'api' || short_code === 'favicon.ico') {
        return next();
    }

    const startTime = process.hrtime();

    let record = cache.get(short_code);
    let fromCache = true;

    if (!record) {
        fromCache = false;
        cacheMisses++;
        record = await getUrlRecord(short_code);
    } else {
        cacheHits++;
    }

    if (!record) {
        return res.status(404).sendFile(path.join(__dirname, '../public', '404.html'));
    }

    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
        return res.status(410).send(`
            <div style="font-family:sans-serif; text-align:center; padding: 50px;">
                <h1 style="color:#e11d48;">410 Link Expired</h1>
                <p>This shortened URL reached its expiration time and is no longer available.</p>
                <a href="/">Go to Home</a>
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

    // Async record click in DB & update local record memory
    record.clickCount++;
    record.clicksLog.push(clickEntry);
    cache.set(short_code, record);

    await recordClick(short_code, clickEntry);

    return res.redirect(302, record.originalUrl);
});

app.listen(PORT, () => {
    console.log(`[TypeScript Server] Running on http://localhost:${PORT}`);
});
