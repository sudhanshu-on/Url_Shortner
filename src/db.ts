import mongoose, { Schema, Document } from 'mongoose';
import { UrlRecord, ClickLogEntry, IUser, UserRole } from './types';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/url_shortener';

// --- USER SCHEMA ---
export interface IUserDocument extends Document {
    email: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    createdAt: string;
}

const UserSchema = new Schema<IUserDocument>({
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER', required: true },
    createdAt: { type: String, required: true }
});

export const UserModel = mongoose.model<IUserDocument>('User', UserSchema);

// --- URL SCHEMA ---
export interface IUrlDocument extends Document {
    shortCode: string;
    originalUrl: string;
    customAlias?: string | null;
    ownerId?: mongoose.Types.ObjectId | null;
    createdAt: string;
    expiresAt?: string | null;
    clickCount: number;
    clicksLog: ClickLogEntry[];
}

const ClickLogSchema = new Schema<ClickLogEntry>({
    timestamp: { type: String, required: true },
    userAgent: { type: String, default: 'Unknown' },
    latencyMs: { type: String, required: true },
    cached: { type: Boolean, required: true }
}, { _id: false });

const UrlSchema = new Schema<IUrlDocument>({
    shortCode: { type: String, required: true, unique: true, index: true },
    originalUrl: { type: String, required: true },
    customAlias: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    createdAt: { type: String, required: true },
    expiresAt: { type: String, default: null, index: true },
    clickCount: { type: Number, default: 0 },
    clicksLog: [ClickLogSchema]
});

// Compound index for ownerId + createdAt queries
UrlSchema.index({ ownerId: 1, createdAt: -1 });

export const UrlModel = mongoose.model<IUrlDocument>('Url', UrlSchema);

// Database initialization
let connectionPromise: Promise<typeof mongoose> | null = null;

export async function initDatabase(): Promise<void> {
    // Already connected
    if (mongoose.connection.readyState === 1) {
        return;
    }

    // Connection is already being established
    if (connectionPromise) {
        await connectionPromise;
        return;
    }

    console.log('[Database] Attempting connection to MongoDB...');

    connectionPromise = mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
    });

    try {
        await connectionPromise;
        console.log('[Database] ✅ Connected successfully to MongoDB');
    } catch (error: any) {
        console.error('[Database Error] ❌ Could not connect to MongoDB');
        console.error(`Error details: ${error.message}`);

        // Allow a future request to retry
        connectionPromise = null;

        throw error;
    }
}

// export async function initDatabase(): Promise<void> {
//     if (mongoose.connection.readyState === 1) return;
    
//     console.log(`[Database] Attempting connection to MongoDB.`);
//     try {
//         await mongoose.connect(MONGODB_URI, {
//             serverSelectionTimeoutMS: 5000
//         });
//         console.log(`[Database] ✅ Connected successfully to MongoDB`);
//     } catch (error: any) {
//         console.error(`\n[Database Error] ❌ Could not connect to MongoDB.`);
//         console.error(`Error details: ${error.message}`);
//         throw error; //changed here
// }
// }

// URL Database Functions with Owner Scoping
export async function saveUrlRecord(record: UrlRecord): Promise<UrlRecord> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) {
        throw new Error("Database connection not ready. Check MongoDB connection.");
    }
    const doc = new UrlModel({
        shortCode: record.shortCode,
        originalUrl: record.originalUrl,
        customAlias: record.customAlias,
        ownerId: record.ownerId ? new mongoose.Types.ObjectId(record.ownerId) : null,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        clickCount: record.clickCount,
        clicksLog: record.clicksLog || []
    });
    const saved = await doc.save();
    return {
        ...record,
        id: saved._id.toString()
    };
}

export async function getUrlRecord(shortCode: string): Promise<UrlRecord | null> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return null; 
    const doc = await UrlModel.findOne({ shortCode }).lean();
    if (!doc) return null;

    return {
        id: doc._id.toString(),
        shortCode: doc.shortCode,
        originalUrl: doc.originalUrl,
        customAlias: doc.customAlias || null,
        ownerId: doc.ownerId ? doc.ownerId.toString() : null,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt || null,
        clickCount: doc.clickCount,
        clicksLog: doc.clicksLog || []
    };
}

export async function getUserUrlRecords(ownerId: string): Promise<UrlRecord[]> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return [];

    const docs = await UrlModel.find({ ownerId: new mongoose.Types.ObjectId(ownerId) })
        .sort({ _id: -1 })
        .lean();

    return docs.map(doc => ({
        id: doc._id.toString(),
        shortCode: doc.shortCode,
        originalUrl: doc.originalUrl,
        customAlias: doc.customAlias || null,
        ownerId: doc.ownerId ? doc.ownerId.toString() : null,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt || null,
        clickCount: doc.clickCount,
        clicksLog: doc.clicksLog || []
    }));
}

export async function deleteUserUrlRecord(shortCode: string, ownerId: string): Promise<boolean> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return false;

    const result = await UrlModel.deleteOne({ 
        shortCode, 
        ownerId: new mongoose.Types.ObjectId(ownerId) 
    });
    return result.deletedCount > 0;
}

export async function recordClick(shortCode: string, entry: ClickLogEntry): Promise<void> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return; 

    await UrlModel.updateOne(
        { shortCode },
        { 
            $inc: { clickCount: 1 },
            $push: { clicksLog: { $each: [entry], $slice: -50 } }
        }
    );
}

// Admin Aggregated Analytics
export async function getAdminSystemStatsFromDb(): Promise<{ 
    totalShortened: number; 
    totalRedirects: number;
    activeLinksCount: number;
    expiredLinksCount: number;
    topLinks: Array<{ shortCode: string; originalUrl: string; clickCount: number }>;
    recentActivity: Array<{ shortCode: string; timestamp: string; latencyMs: string; cached: boolean }>;
    avgLatencyMs: string;
}> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) {
        return {
            totalShortened: 0,
            totalRedirects: 0,
            activeLinksCount: 0,
            expiredLinksCount: 0,
            topLinks: [],
            recentActivity: [],
            avgLatencyMs: "0.00ms"
        };
    }

    const nowIso = new Date().toISOString();
    const totalShortened = await UrlModel.countDocuments();
    
    // Count active vs expired links
    const expiredLinksCount = await UrlModel.countDocuments({
        expiresAt: { $ne: null, $lt: nowIso }
    });
    const activeLinksCount = totalShortened - expiredLinksCount;

    // Aggregate total redirects & calculate average latency
    const aggregateResult = await UrlModel.aggregate([
        { $unwind: "$clicksLog" },
        {
            $group: {
                _id: null,
                totalClicks: { $sum: 1 },
                avgLatency: {
                    $avg: {
                        $toDouble: {
                            $replaceAll: { input: "$clicksLog.latencyMs", find: "ms", replacement: "" }
                        }
                    }
                }
            }
        }
    ]);

    const totalRedirects = aggregateResult[0]?.totalClicks || 0;
    const avgLatencyVal = aggregateResult[0]?.avgLatency ? aggregateResult[0].avgLatency.toFixed(2) : "0.50";

    // Top 5 most clicked links
    const topDocs = await UrlModel.find({}, { shortCode: 1, originalUrl: 1, clickCount: 1 })
        .sort({ clickCount: -1 })
        .limit(5)
        .lean();

    const topLinks = topDocs.map(d => ({
        shortCode: d.shortCode,
        originalUrl: d.originalUrl,
        clickCount: d.clickCount
    }));

    // Recent system activity (last 10 clicks across all URLs)
    const recentActivityDocs = await UrlModel.aggregate([
        { $unwind: "$clicksLog" },
        { $sort: { "clicksLog.timestamp": -1 } },
        { $limit: 10 },
        {
            $project: {
                _id: 0,
                shortCode: "$shortCode",
                timestamp: "$clicksLog.timestamp",
                latencyMs: "$clicksLog.latencyMs",
                cached: "$clicksLog.cached"
            }
        }
    ]);

    return {
        totalShortened,
        totalRedirects,
        activeLinksCount,
        expiredLinksCount,
        topLinks,
        recentActivity: recentActivityDocs,
        avgLatencyMs: `${avgLatencyVal}ms`
    };
}