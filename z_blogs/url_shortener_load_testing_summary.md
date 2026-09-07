# URL Shortener Backend --- Load Testing & MongoDB Troubleshooting Summary

## 1. Project Context

We worked on a URL-shortener backend with a redirect endpoint:

`GET /:short_code`

The redirect flow uses:

-   Express + TypeScript
-   MongoDB Atlas
-   Mongoose
-   An in-memory cache
-   Redis/rate-limiter-style protection around the redirect route
-   k6 for load testing
-   Deployment on a serverless environment (the logs show `/var/task`,
    consistent with Vercel/serverless execution)

The main goal of this phase was to determine whether the redirect
endpoint can handle concurrent traffic reliably and to diagnose failures
appearing under load.

------------------------------------------------------------------------

# 2. Redirect Endpoint

The redirect route essentially performs this sequence:

1.  Extract `short_code` from the request.
2.  Skip the route for reserved/static paths using
    `shouldSkipShortCodeRoute()`.
3.  Pass the request through `redirectRateLimiter`.
4.  Start a high-resolution timer.
5.  Check the in-memory cache.
6.  If the URL is not cached:
    -   Increment cache-miss metrics.
    -   Query MongoDB using `getUrlRecord(short_code)`.
7.  If no URL exists, return `404`.
8.  Check expiration using `isExpired(record.expiresAt)`.
9.  Create a click log entry containing:
    -   timestamp
    -   user agent
    -   latency
    -   whether the request came from cache
10. Increment the in-memory click count.
11. Update the cache.
12. Persist the click using `recordClick()`.
13. Return `302` redirect to the original URL.

Important observation:

The endpoint currently does a database write before completing the
redirect:

`await recordClick(short_code, clickEntry);`

Only after that does it execute:

`res.redirect(302, record.originalUrl);`

This is important for performance because every successful redirect can
result in a MongoDB write.

------------------------------------------------------------------------

# 3. MongoDB Read Logic

The database read function is:

``` ts
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
```

The `.lean()` call is good for a read-heavy endpoint because Mongoose
does not need to create a full Mongoose document object.

------------------------------------------------------------------------

# 4. MongoDB Click Write Logic

The click is persisted with:

``` ts
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
```

This performs two database operations atomically in one `updateOne`:

-   `$inc` increments `clickCount`
-   `$push` adds the latest click log and keeps only the latest 50
    entries

The `$slice: -50` is useful because it prevents `clicksLog` from growing
forever.

------------------------------------------------------------------------

# 5. Original MongoDB Connection Problem

The original connection initialization was:

``` ts
export async function initDatabase(): Promise<void> {
    if (mongoose.connection.readyState === 1) return;

    console.log(`[Database] Attempting connection to MongoDB.`);
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log(`[Database] ✅ Connected successfully to MongoDB`);
    } catch (error: any) {
        console.error(`\n[Database Error] ❌ Could not connect to MongoDB.`);
        console.error(`Error details: ${error.message}`);
    }
}
```

The major issue was that multiple serverless requests could call
`initDatabase()` at approximately the same time while the connection was
not yet established.

That can create a connection storm.

The MongoDB Atlas dashboard confirmed this problem.

------------------------------------------------------------------------

# 6. MongoDB Atlas Connection Limit

The Atlas dashboard showed:

`Connections: 498 / 500`

and later:

`362 / 500 (72%)`

The Free cluster has a connection limit of 500.

This was the key clue.

The problem was not simply:

> "MongoDB cannot handle 50 or 75 users."

The deeper problem was:

> Many concurrent/serverless executions were creating or attempting to
> create MongoDB connections instead of efficiently reusing an existing
> connection.

Once the connection limit was approached, MongoDB started rejecting
connections.

This produced errors such as:

``` text
MongoNetworkError:
SSL routines:ssl3_read_bytes:
tlsv1 alert internal error:
SSL alert number 80
```

and authentication/connection failures.

------------------------------------------------------------------------

# 7. Why the SSL Error Was Misleading

The error looked like an SSL/TLS problem:

``` text
tlsv1 alert internal error
SSL alert number 80
```

But the Atlas connection graph showed the much more important signal:

`498 / 500 connections`

So the TLS error was not necessarily evidence that the certificate or
TLS configuration was wrong.

Under connection pressure, the MongoDB client could fail during
connection establishment and surface a low-level network/TLS error.

The correct diagnosis was connection management under serverless
concurrency.

------------------------------------------------------------------------

# 8. Connection Reuse Fix

The connection logic was changed toward a cached/shared connection
strategy.

The important principle is:

> Do not create a new MongoDB connection for every request.

Instead:

-   Reuse an already-connected Mongoose connection.
-   If a connection is already being established, reuse the same
    connection promise.
-   Only create a new connection when there is no usable existing
    connection.

A robust pattern is:

``` ts
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function initDatabase(): Promise<typeof mongoose> {
    if (mongoose.connection.readyState === 1) {
        return mongoose;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    console.log("[Database] Attempting connection to MongoDB...");

    connectionPromise = mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
        minPoolSize: 0,
        maxIdleTimeMS: 30000
    });

    try {
        await connectionPromise;
        console.log("[Database] ✅ Connected successfully to MongoDB");
        return mongoose;
    } catch (error: any) {
        console.error("[Database Error] ❌ Could not connect to MongoDB");
        console.error("Error details:", error.message);

        connectionPromise = null;
        throw error;
    }
}
```

The exact options can be tuned later, but the critical improvement is
the shared `connectionPromise`.

------------------------------------------------------------------------

# 9. Why the Shared Promise Matters

Imagine 50 requests arrive at nearly the same time.

Without a connection promise:

``` text
Request 1 -> connect()
Request 2 -> connect()
Request 3 -> connect()
Request 4 -> connect()
...
Request 50 -> connect()
```

With a shared promise:

``` text
Request 1 -> starts connect()
Request 2 -> waits for same promise
Request 3 -> waits for same promise
Request 4 -> waits for same promise
...
Request 50 -> waits for same promise
```

So there is one connection establishment operation instead of many
simultaneous attempts.

This is especially important in serverless deployments.

------------------------------------------------------------------------

# 10. Atlas Credits

The MongoDB Atlas billing page showed:

-   Promotional credits: `$50`
-   Used: `$0`
-   Available: `$50`

The important distinction is that credits are not themselves a
performance fix.

They can be used to upgrade the MongoDB cluster to a paid tier with
better resources/capacity, but throwing money at the database should not
be the first fix.

We first fixed the application-level connection-management problem.

The Atlas dashboard initially showed a Free cluster:

-   AWS / Mumbai (`ap-south-1`)
-   Replica Set --- 3 nodes
-   512 MB storage
-   Shared resources
-   500 connection limit

------------------------------------------------------------------------

# 11. Load Testing With k6

The load test was executed with:

``` bash
k6 run load-test/redirect-test.js
```

The test used multiple virtual-user levels:

-   10 VUs
-   25 VUs
-   50 VUs
-   75 VUs
-   100 VUs

Each test ran for approximately 30 seconds.

The expected response was:

`302`

------------------------------------------------------------------------

# 12. Early Load-Test Results

Initially, we saw unstable behavior.

At one point, even relatively low concurrency could produce HTTP 500
errors.

Example:

``` text
10 VUs
checks_failed: 7.72%
HTTP 500 responses
```

At 75 VUs we saw failures as well.

This correlated with the MongoDB connection problem.

The important lesson was:

> A load test failing at 50 or 75 VUs does not automatically mean
> Express cannot handle 50 or 75 concurrent users.

The application may be failing because one dependency is exhausted.

In this case, MongoDB connections were the bottleneck.

------------------------------------------------------------------------

# 13. Successful 10 VU Test

After the connection-management changes, a 10 VU test produced:

``` text
checks_total:       541
checks_succeeded:   100%
checks_failed:      0%

http_reqs:          541
http_req_failed:    0%

avg latency:        553.63ms
median:             453.72ms
p(90):              518.64ms
p(95):              637.98ms
max:                4.42s
```

All requests returned `302`.

This is a stable result.

------------------------------------------------------------------------

# 14. Successful 25 VU Test

The 25 VU test produced:

``` text
checks_total:       1503
checks_succeeded:   100%
checks_failed:      0%

http_reqs:          1503
http_req_failed:    0%

avg latency:        498.87ms
median:             447.18ms
p(90):              477.23ms
p(95):              547.85ms
max:                4.42s
```

Again:

`100% 302 responses`

This showed that the connection problem was no longer immediately
breaking the application at 25 VUs.

------------------------------------------------------------------------

# 15. Successful 50 VU Test

One successful 50 VU run produced:

``` text
checks_total:       2239
checks_succeeded:   100%
checks_failed:      0%

http_reqs:          2239
http_req_failed:    0%

avg latency:        672.14ms
median:             514.95ms
p(90):              918.69ms
p(95):              1.41s
max:                4.31s
```

All 2239 checks succeeded.

This is a significant improvement compared with the earlier 50 VU
failures.

------------------------------------------------------------------------

# 16. Successful 75 VU Test

The latest successful 75 VU run produced:

``` text
checks_total:       2388
checks_succeeded:   100%
checks_failed:      0%

http_reqs:          2388
http_req_failed:    0%

avg latency:        986.87ms
median:             622.11ms
p(90):              2.15s
p(95):              3.01s
max:                5.39s
```

All requests returned `302`.

This means the system is currently surviving the 75-VU test without HTTP
failures.

However, latency is increasing substantially.

That means the system is stable at this load, but performance is
degrading.

------------------------------------------------------------------------

# 17. Successful 100 VU Test

The latest 100 VU run produced:

``` text
checks_total:       2523
checks_succeeded:   100%
checks_failed:      0%

http_reqs:          2523
http_req_failed:    0%

avg latency:        1.24s
median:             990ms
p(90):              2.73s
p(95):              3.90s
max:                7.01s
```

Again, all checks succeeded.

So the current state is:

``` text
10 VU   -> 100% success
25 VU   -> 100% success
50 VU   -> 100% success
75 VU   -> 100% success
100 VU  -> 100% success
```

This is a major improvement from the earlier connection-exhaustion
failures.

------------------------------------------------------------------------

# 18. But Do NOT Claim "100 VUs Is Our Capacity"

This is important.

A 30-second k6 test with 100 VUs does NOT prove that the application can
support 100 production users.

Why?

Because:

-   VUs are not the same as users.
-   Each VU repeatedly sends requests.
-   Production traffic has different request distributions.
-   Serverless scaling can behave differently over longer periods.
-   MongoDB connection behavior can change as more instances are
    created.
-   The test currently measures one particular endpoint/workload.

So the correct conclusion is:

> The current implementation successfully completed the tested 30-second
> workload at 100 concurrent k6 VUs, but latency increased significantly
> and this is not yet a production capacity guarantee.

------------------------------------------------------------------------

# 19. Important Performance Observation

The biggest warning sign is latency.

Current approximate results:

    VUs   Success      Avg   Median      p95
  ----- --------- -------- -------- --------
     10      100%   554 ms   454 ms   638 ms
     25      100%   499 ms   447 ms   548 ms
     50      100%   672 ms   515 ms   1.41 s
     75      100%   987 ms   622 ms   3.01 s
    100      100%   1.24 s   990 ms   3.90 s

The system is not failing anymore, but the response time is rising as
concurrency increases.

That suggests the next problem to investigate is performance rather than
basic reliability.

------------------------------------------------------------------------

# 20. The `httpReqTimeout` Warning

The k6 output repeatedly showed:

``` text
WARN[0000] There were unknown fields in the options exported in the script
error="json: unknown field \"httpReqTimeout\""
```

This means the k6 script contains an unsupported option:

``` js
httpReqTimeout
```

k6 is ignoring it.

Therefore, the warning should be removed.

Do NOT assume that this option is controlling the timeout.

If a timeout needs to be configured, use the supported k6 mechanisms
rather than `httpReqTimeout`.

The load test should be clean before using it as a benchmark.

------------------------------------------------------------------------

# 21. One Strange 50 VU Result

One earlier 50 VU run showed:

``` text
INFO[0060] FAILED STATUS: 0
```

and:

``` text
iterations: 134
50 interrupted iterations
```

This was not the same as receiving HTTP 500.

Status `0` generally indicates that the HTTP request did not receive a
normal HTTP response, often because the request was interrupted/timed
out/aborted.

The run also continued until approximately 60 seconds even though the
main workload was 30 seconds.

That result should be treated as an abnormal test-run condition rather
than a clean application benchmark.

The later 50 VU run was much more useful:

``` text
2239 requests
100% successful
0.21% http_req_failed
```

Actually, the k6 `status is 302` check was 100% in that later run, so it
is the cleaner benchmark.

------------------------------------------------------------------------

# 22. Current Architecture Bottleneck

The current redirect path effectively looks like:

``` text
Client
  |
  v
Serverless Function
  |
  +--> Rate Limiter
  |
  +--> In-memory Cache
  |       |
  |       +--> HIT ---> URL
  |
  +--> Cache MISS
          |
          v
       MongoDB
          |
          v
       URL Record
          |
          v
     recordClick()
          |
          v
       MongoDB
          |
          v
        302
```

The major issue is that a redirect can involve both:

1.  MongoDB read on cache miss
2.  MongoDB write for click analytics

The second operation is particularly important because redirects are
usually latency-sensitive.

------------------------------------------------------------------------

# 23. Next Major Optimization: Do Not Block the Redirect on Analytics

Currently:

``` ts
await recordClick(short_code, clickEntry);

return res.redirect(302, record.originalUrl);
```

This means the user waits for MongoDB before receiving the redirect.

For a URL shortener, that is backwards.

A better architecture is:

``` text
Request
  |
  v
Find URL
  |
  v
Send 302 immediately
  |
  +----> analytics/event processing
```

The click-tracking operation should ideally be asynchronous.

Possible approaches:

### Option A --- Fire-and-forget

Simple but has reliability tradeoffs:

``` ts
recordClick(short_code, clickEntry).catch(err => {
    console.error("Failed to record click:", err);
});

return res.redirect(302, record.originalUrl);
```

This reduces redirect latency, but a serverless function may terminate
before the background write completes.

### Option B --- Queue

Better production architecture:

``` text
Redirect request
      |
      +--> Cache / DB
      |
      +--> 302 immediately
      |
      +--> Queue event
               |
               v
          Worker/consumer
               |
               v
            MongoDB
```

Kafka, RabbitMQ, SQS, or another durable queue can be used depending on
requirements.

For this project, a queue is probably unnecessary at the current scale,
but it is an excellent system-design improvement to understand.

------------------------------------------------------------------------

# 24. Another Important Issue: In-Memory Cache on Serverless

The application currently uses something like:

``` ts
cache.get(short_code)
cache.set(short_code, record)
```

This is an in-memory cache.

That means:

``` text
Serverless Instance A
    cache = { abc: URL }

Serverless Instance B
    cache = { }
```

The cache is not globally shared.

When the platform creates multiple instances, each instance has its own
cache.

Therefore, the cache can help repeated requests hitting the same warm
instance, but it is not a reliable global cache.

For a scalable architecture, Redis is a better shared cache:

``` text
             +--> Redis --> URL
             |
Request --> API
             |
             +--> MongoDB
```

------------------------------------------------------------------------

# 25. What We Should Do Next

Do not immediately upgrade MongoDB just because the test reached 100
VUs.

The next steps should be:

## Step 1 --- Clean the k6 script

Remove:

``` text
httpReqTimeout
```

because k6 says it is unsupported.

## Step 2 --- Test longer

Instead of only 30 seconds, test:

-   1 minute
-   5 minutes
-   10 minutes

This will reveal whether the connection pool remains stable.

## Step 3 --- Watch MongoDB Atlas

During the test monitor:

-   Connections
-   Operations/sec
-   CPU
-   Memory
-   Query latency
-   Network
-   Connection spikes

The critical metric from the earlier incident was connections.

## Step 4 --- Measure cache hit rate

Track:

``` text
cacheHits
cacheMisses
```

and calculate:

``` text
cache hit ratio =
cacheHits / (cacheHits + cacheMisses)
```

If the redirect URL is highly cacheable, a high cache hit rate should
dramatically reduce MongoDB reads.

## Step 5 --- Remove database write from the critical redirect path

The biggest application-level latency optimization is to stop making the
user wait for:

``` ts
await recordClick(...)
```

## Step 6 --- Introduce shared Redis if needed

If the project is intended to demonstrate scalable system design,
replace the process-local cache with Redis.

## Step 7 --- Re-run the load test

Then compare:

``` text
Before optimization
        vs
After optimization
```

Compare:

-   requests/sec
-   average latency
-   p90
-   p95
-   p99
-   error rate
-   MongoDB connections
-   MongoDB operations/sec

------------------------------------------------------------------------

# 26. Current Project Status

### Reliability

**Much better.**

The MongoDB connection exhaustion problem was identified and mitigated.

The latest tests completed successfully at:

-   10 VUs
-   25 VUs
-   50 VUs
-   75 VUs
-   100 VUs

### Database

MongoDB Atlas Free cluster is still being used.

The cluster previously reached approximately:

`498 / 500 connections`

which exposed the connection-management problem.

### Performance

Performance is currently the next issue.

At 100 VUs:

``` text
average: 1.24 seconds
p95:     3.90 seconds
max:     7.01 seconds
```

The system is returning correct `302` responses, but latency is becoming
high.

### Load Testing

k6 is working and successfully generating substantial request volume.

The benchmark script still contains the unsupported:

``` text
httpReqTimeout
```

which should be removed.

------------------------------------------------------------------------

# 27. Main Lessons Learned

## Lesson 1

A load-test failure does not necessarily mean the API server is the
bottleneck.

The dependency can be the bottleneck.

In this case:

``` text
k6 load
   ↓
Serverless instances
   ↓
MongoDB connections
   ↓
500 connection limit
   ↓
connection failures
   ↓
HTTP 500
```

## Lesson 2

Serverless + MongoDB requires connection reuse.

Never casually create a new database connection per request.

## Lesson 3

A cache is only useful if it is shared appropriately for the
architecture.

An in-memory cache is local to a process/instance.

## Lesson 4

Analytics should not unnecessarily delay a redirect.

The user wants:

``` text
302
```

as quickly as possible.

Click analytics can be processed asynchronously.

## Lesson 5

Successful requests are not the whole story.

A system can have:

``` text
0% errors
```

and still have poor performance.

The increase in p95 latency from hundreds of milliseconds to nearly 4
seconds at 100 VUs is significant.

------------------------------------------------------------------------

# 28. Final State

The project has moved from:

``` text
UNSTABLE
    ↓
MongoDB connection exhaustion
    ↓
HTTP 500 under concurrency
```

to:

``` text
STABLE
    ↓
100% successful 302 responses
    ↓
up to 100 VUs in the current 30-second test
    ↓
but increasing latency
```

So the next phase should focus on **performance optimization and proper
scalable architecture**, not blindly increasing the MongoDB tier.

The most important next technical change is:

> Keep MongoDB connections reused, make click analytics asynchronous,
> improve/shared-cache behavior, then run longer and more controlled k6
> tests.
