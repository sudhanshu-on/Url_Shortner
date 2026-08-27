# ShortURL - Scalable High-Performance URL Shortener Service

ShortURL is a high-availability, low-latency URL Shortener service built with **TypeScript**, **Node.js**, **Express**, and an **in-memory LRU Cache architecture**. It is designed based on enterprise distributed system principles capable of scaling to millions of URL creations and billions of redirects per day with sub-100ms redirect latency.

---

## 🌟 Key Features

- **🚀 Low Latency Redirects (< 5ms)**: Uses an LRU (Least Recently Used) memory cache layer for hot URL lookups before falling back to persistent storage.
- **🎲 Base62 Encoding & Token Generation**: Generates 7-character non-guessable short codes (3.52+ Trillion unique key combinations).
- **🔤 Custom Alias Support**: Allows users to specify personalized slugs (e.g., `app.com/launch2026`).
- **⏳ Link Expiration (TTL)**: Optional expiration time (in seconds) after which short links return HTTP `410 Gone`.
- **📊 Real-Time Click Analytics & Telemetry**: Logs click counts, user agents, redirect latency, and cache hit/miss statistics.
- **🎨 Glassmorphism Web Dashboard**: Live interactive frontend to test shortening, copy links, test 302 redirects, and view system metrics.

---

## 🏗️ System Architecture & Workflow

```
+-------------------------------------------------------------------+
|                           Client Browser                          |
+---------------------------------+---------------------------------+
                                  |
                                  v
+---------------------------------+---------------------------------+
|                       Express Gateway (API)                       |
+------------------+------------------------------+-----------------+
                   |                              |
      1. POST /api/v1/shorten          2. GET /{short_code}
                   |                              |
                   v                              v
        +--------------------+          +--------------------+
        | Base62 Token Gen   |          |  Cache-First Lookup|
        | / Custom Alias Check          |    (LRU Cache)     |
        +---------+----------+          +---------+----------+
                  |                               |
                  | Cache Warmup         Cache Hit| Cache Miss
                  v                               v          v
        +--------------------+              +-------+  +------------+
        | In-Memory Cache &  |              | 302   |  | DB Storage |
        | Database Record    |              | Redir |  | Lookup     |
        +--------------------+              +-------+  +------------+
```

---

## 🛠️ Tech Stack & Prerequisites

- **Language**: TypeScript (ES2022 / NodeNext)
- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Tooling**: `tsc` (TypeScript Compiler), `ts-node`
- **Dependencies**: `express`, `cors`, `dotenv`

---

## 🚀 Quick Start Guide

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd Url_Shortner
npm install
```

### 2. Run in Development Mode
Runs the server directly with `ts-node`:
```bash
npm run dev
```

### 3. Build & Run Production Bundle
Compile TypeScript code into JavaScript (`dist/`) and run with Node:
```bash
npm run build
npm start
```
The server will start on **http://localhost:3000**.

---

## 📖 API Documentation & Usage

### 1. Create a Short URL
- **Endpoint**: `POST /api/v1/shorten`
- **Content-Type**: `application/json`

#### Request Body
```json
{
  "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "custom_alias": "jsdocs",   // Optional: 3-30 alphanumeric characters
  "ttl_seconds": 3600          // Optional: Link expires in 1 hour
}
```

#### Response (`201 Created`)
```json
{
  "short_code": "jsdocs",
  "short_url": "http://localhost:3000/jsdocs",
  "original_url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "expires_at": "2026-08-27T01:15:00.000Z",
  "created_at": "2026-08-27T00:15:00.000Z"
}
```

---

### 2. Redirect Short URL
- **Endpoint**: `GET /{short_code}`
- **Behavior**: Responds with an HTTP `302 Found` redirect header pointing to `original_url`.
- **Latency**: < 5ms for cached hot links.

---

### 3. Get Short URL Analytics
- **Endpoint**: `GET /api/v1/analytics/{short_code}`

#### Response (`200 OK`)
```json
{
  "short_code": "jsdocs",
  "original_url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "click_count": 42,
  "created_at": "2026-08-27T00:15:00.000Z",
  "expires_at": null,
  "recent_clicks": [
    {
      "timestamp": "2026-08-27T00:16:02.123Z",
      "userAgent": "Mozilla/5.0 ...",
      "latencyMs": "0.412ms",
      "cached": true
    }
  ]
}
```

---

### 4. System Telemetry & Cache Metrics
- **Endpoint**: `GET /api/v1/system/stats`

#### Response (`200 OK`)
```json
{
  "system_stats": {
    "totalShortened": 15,
    "totalRedirects": 1420,
    "cacheHits": 1390,
    "cacheMisses": 30
  },
  "cache_hit_rate": "97.9%",
  "active_records": 15,
  "cache_size": 15
}
```

---

## 📁 Project Structure

```
Url_Shortner/
├── src/
│   ├── types.ts       # TypeScript interfaces & types
│   ├── utils.ts       # Base62 encoder & LRU Cache implementation
│   └── server.ts      # Express server & REST API handlers
├── public/
│   ├── index.html     # Web Application Dashboard
│   └── 404.html       # Link Not Found / Expired page
├── dist/              # Compiled JavaScript output (generated by build)
├── tsconfig.json      # TypeScript compiler configuration
├── package.json       # Dependencies and npm scripts
└── README.md          # Project documentation
```

---

## 📊 System Capacity & Scaling Estimates

| Metric | Estimate |
|---|---|
| **Write Volume** | 1 Million URLs / day (~ 12 write QPS) |
| **Read Volume** | 1 Billion Redirects / day (~ 11,574 read QPS) |
| **5-Year Storage** | ~ 1.8 TB (1.825B records at ~ 1 KB / record) |
| **Cache RAM (80/20 Rule)** | ~ 100 GB RAM (Hot 20% URLs generating 80% traffic) |

---

## 📜 License
ISC License
