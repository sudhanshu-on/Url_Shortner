import mongoose, { Schema, Document } from 'mongoose';
import { UrlRecord, ClickLogEntry } from './types';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/url_shortener';

export interface IUrlDocument extends Document {
    shortCode: string;
    originalUrl: string;
    customAlias?: string | null;
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
    createdAt: { type: String, required: true },
    expiresAt: { type: String, default: null, index: true },
    clickCount: { type: Number, default: 0 },
    clicksLog: [ClickLogSchema]
});

export const UrlModel = mongoose.model<IUrlDocument>('Url', UrlSchema);

export async function initDatabase(): Promise<void> {
    if (mongoose.connection.readyState === 1) return;
    
    console.log(`[Database] Attempting connection to MongoDB at: ${MONGODB_URI}`);
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log(`[Database] ✅ Connected successfully to MongoDB (${MONGODB_URI})`);
    } catch (error: any) {
        console.error(`\n[Database Error] ❌ Could not connect to MongoDB.`);
        console.error(`Error details: ${error.message}`);
        console.error(`\n💡 How to resolve:`);
        console.error(`1. If using local MongoDB, start the service: 'sudo systemctl start mongod'`);
        console.error(`2. If using MongoDB Atlas / remote host, export your connection string:`);
        console.error(`   export MONGODB_URI="mongodb+srv://<user>:<password>@cluster.mongodb.net/url_shortener"\n`);
    }
}

export async function saveUrlRecord(record: UrlRecord): Promise<void> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) {
        throw new Error("Database connection not ready. Check MongoDB connection.");
    }
    const doc = new UrlModel({
        shortCode: record.shortCode,
        originalUrl: record.originalUrl,
        customAlias: record.customAlias,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        clickCount: record.clickCount,
        clicksLog: record.clicksLog || []
    });
    await doc.save();
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
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt || null,
        clickCount: doc.clickCount,
        clicksLog: doc.clicksLog || []
    };
}

export async function getAllUrlRecords(): Promise<UrlRecord[]> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return [];

    const docs = await UrlModel.find().sort({ _id: -1 }).lean();
    return docs.map(doc => ({
        id: doc._id.toString(),
        shortCode: doc.shortCode,
        originalUrl: doc.originalUrl,
        customAlias: doc.customAlias || null,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt || null,
        clickCount: doc.clickCount,
        clicksLog: doc.clicksLog || []
    }));
}

export async function recordClick(shortCode: string, entry: ClickLogEntry): Promise<void> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return;

    await UrlModel.updateOne(
        { shortCode },
        { 
            $inc: { clickCount: 1 },
            $push: { clicksLog: { $each: [entry], $slice: -20 } }
        }
    );
}

export async function getSystemStatsFromDb(): Promise<{ totalShortened: number; totalRedirects: number }> {
    await initDatabase();
    if (mongoose.connection.readyState !== 1) return { totalShortened: 0, totalRedirects: 0 };

    const totalShortened = await UrlModel.countDocuments();
    const aggregateResult = await UrlModel.aggregate([
        { $group: { _id: null, totalClicks: { $sum: "$clickCount" } } }
    ]);
    const totalRedirects = aggregateResult[0]?.totalClicks || 0;

    return {
        totalShortened,
        totalRedirects
    };
}