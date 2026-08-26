import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { UrlRecord, ClickLogEntry } from './types';

let dbInstance: Database | null = null;

export async function initDatabase(): Promise<Database> {
    if (dbInstance) return dbInstance;

    const dbPath = path.join(__dirname, '../urls.db');
    dbInstance = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Create tables
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT UNIQUE NOT NULL,
            original_url TEXT NOT NULL,
            custom_alias TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            click_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            user_agent TEXT,
            latency_ms TEXT,
            cached INTEGER,
            FOREIGN KEY(short_code) REFERENCES urls(short_code)
        );

        CREATE INDEX IF NOT EXISTS idx_short_code ON urls(short_code);
    `);

    return dbInstance;
}

export async function saveUrlRecord(record: UrlRecord): Promise<void> {
    const db = await initDatabase();
    await db.run(
        `INSERT INTO urls (short_code, original_url, custom_alias, created_at, expires_at, click_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.shortCode, record.originalUrl, record.customAlias, record.createdAt, record.expiresAt, record.clickCount]
    );
}

export async function getUrlRecord(shortCode: string): Promise<UrlRecord | null> {
    const db = await initDatabase();
    const row = await db.get(`SELECT * FROM urls WHERE short_code = ?`, [shortCode]);
    if (!row) return null;

    const clicks = await db.all(`SELECT * FROM clicks WHERE short_code = ? ORDER BY id DESC LIMIT 10`, [shortCode]);

    return {
        id: row.id,
        shortCode: row.short_code,
        originalUrl: row.original_url,
        customAlias: row.custom_alias,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        clickCount: row.click_count,
        clicksLog: clicks.map(c => ({
            timestamp: c.timestamp,
            userAgent: c.user_agent,
            latencyMs: c.latency_ms,
            cached: Boolean(c.cached)
        }))
    };
}

export async function getAllUrlRecords(): Promise<UrlRecord[]> {
    const db = await initDatabase();
    const rows = await db.all(`SELECT * FROM urls ORDER BY id DESC`);
    return rows.map(row => ({
        id: row.id,
        shortCode: row.short_code,
        originalUrl: row.original_url,
        customAlias: row.custom_alias,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        clickCount: row.click_count,
        clicksLog: []
    }));
}

export async function recordClick(shortCode: string, entry: ClickLogEntry): Promise<void> {
    const db = await initDatabase();
    await db.run(`UPDATE urls SET click_count = click_count + 1 WHERE short_code = ?`, [shortCode]);
    await db.run(
        `INSERT INTO clicks (short_code, timestamp, user_agent, latency_ms, cached)
         VALUES (?, ?, ?, ?, ?)`,
        [shortCode, entry.timestamp, entry.userAgent, entry.latencyMs, entry.cached ? 1 : 0]
    );
}

export async function getSystemStatsFromDb(): Promise<{ totalShortened: number; totalRedirects: number }> {
    const db = await initDatabase();
    const shortenedRow = await db.get(`SELECT COUNT(*) as count FROM urls`);
    const redirectsRow = await db.get(`SELECT COUNT(*) as count FROM clicks`);
    return {
        totalShortened: shortenedRow?.count || 0,
        totalRedirects: redirectsRow?.count || 0
    };
}
