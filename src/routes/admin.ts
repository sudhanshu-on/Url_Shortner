import express, { Response } from 'express';
import { authenticateUser, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { getAdminSystemStatsFromDb } from '../db';
import { LRUCache } from '../utils';

const router = express.Router();

// Apply Authentication & Admin Authorization to all routes in this router
router.use(authenticateUser);
router.use(requireAdmin);

/**
 * GET /api/v1/admin/stats
 * Aggregate system-level metrics for admin dashboard
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response, next): Promise<any> => {
    try {
        const dbStats = await getAdminSystemStatsFromDb();
        const cacheInstance = (req.app.get('lruCache') as LRUCache<string, any>);
        const cacheHits = (req.app.get('cacheHits') as number) || 0;
        const cacheMisses = (req.app.get('cacheMisses') as number) || 0;

        const totalRequests = cacheHits + cacheMisses;
        const hitRate = totalRequests > 0 
            ? ((cacheHits / totalRequests) * 100).toFixed(1)
            : "100.0";

        return res.json({
            system_stats: {
                totalShortened: dbStats.totalShortened,
                totalRedirects: dbStats.totalRedirects,
                activeLinksCount: dbStats.activeLinksCount,
                expiredLinksCount: dbStats.expiredLinksCount,
                cacheHits,
                cacheMisses,
                cacheHitRate: `${hitRate}%`,
                cacheSize: cacheInstance ? cacheInstance.size() : 0,
                avgRedirectLatencyMs: dbStats.avgLatencyMs
            },
            top_links: dbStats.topLinks,
            recent_activity: dbStats.recentActivity
        });
    } catch (err) {
        next(err);
    }
});

export default router;
