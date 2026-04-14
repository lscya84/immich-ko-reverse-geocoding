require('dotenv').config({ path: '/app/.env' });
const { Client } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
    naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
    naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
    db: {
        user: (process.env.DB_USERNAME || 'postgres').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        host: (process.env.DB_HOSTNAME || 'immich_postgres').trim(),
        database: (process.env.DB_DATABASE_NAME || 'immich').trim(),
        port: 5432,
    },
    interval: parseInt(process.env.INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100', 10),
    apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || '10000', 10),
};

const isForceMode = process.argv.includes('--force');
let locationMap = {};

// L1 캐시 (메모리)
const addressCache = new Map();
const MAX_CACHE_SIZE = 50000;

// L2 캐시 (DB) 유효기간
const CACHE_TTL_DAYS = 180;

// Two-Phase 처리 튜닝
const FAST_TRACK_CHUNK_SIZE = 2000;
const FAST_TRACK_LOG_INTERVAL = 10000;
const API_TRACK_LOG_INTERVAL = 50;

// 중복 실행 방지용 Lock
let isRunning = false;

try {
    const mappingPath = path.join(__dirname, 'mapping.json');
    if (fs.existsSync(mappingPath)) {
        locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
} catch (e) {}

function nowKst() {
    return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function translateLocation(engName) {
    if (!engName) return null;

    const original = engName.toLowerCase().trim();
    const clean = original.replace(/-(do|si|gun|gu|eup|myeon|dong|ri)$/i, '').trim();

    if (locationMap[original]) return locationMap[original];
    if (locationMap[clean]) return locationMap[clean];

    for (const [eng, kor] of Object.entries(locationMap)) {
        const key = eng.toLowerCase();
        if (original === key || original.split('-').includes(key)) return kor;
    }

    return null;
}

function getCacheKey(lat, lon) {
    // 건물명 정밀도 유지를 위해 소수점 5자리
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;
}

function setMemoryCache(cacheKey, value, enforceLimit = true) {
    if (enforceLimit && addressCache.size >= MAX_CACHE_SIZE) {
        const firstKey = addressCache.keys().next().value;
        addressCache.delete(firstKey);
    }
    addressCache.set(cacheKey, value);
}

async function ensureCacheTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS "custom_naver_geocode_cache" (
            "cache_key" VARCHAR PRIMARY KEY,
            "state" VARCHAR,
            "city" VARCHAR,
            "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

async function warmUpCache(client) {
    addressCache.clear();

    const res = await client.query(
        `SELECT "cache_key", "state", "city"
         FROM "custom_naver_geocode_cache"
         WHERE "updated_at" >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
        [CACHE_TTL_DAYS],
    );

    for (const row of res.rows) {
        // 워밍업은 유효 캐시를 전부 적재하는 것이 목적이므로 제한 없이 적재
        setMemoryCache(row.cache_key, {
            state: row.state,
            city: row.city,
        }, false);
    }

    return res.rows.length;
}

function extractRegionNames(result) {
    const region = result?.region;
    if (!region) return null;

    const stateName = region.area1?.name || '';
    const area2 = region.area2?.name || '';
    const area3 = region.area3?.name || '';
    const area4 = region.area4?.name || '';
    const cityParts = [area2, area3, area4].filter((part) => part && part.trim() !== '');

    return {
        state: stateName,
        city: cityParts.join(' '),
    };
}

function pickBestRegionResult(results) {
    if (!Array.isArray(results) || results.length === 0) return null;

    return (
        results.find((r) => r.name === 'legalcode') ||
        results.find((r) => r.name === 'admcode') ||
        results.find((r) => r.region) ||
        results[0]
    );
}

function fetchNaverAddress(lat, lon) {
    return new Promise((resolve) => {
        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=legalcode,admcode,roadaddr,addr`;
        const options = {
            headers: {
                'x-ncp-apigw-api-key-id': config.naverId,
                'x-ncp-apigw-api-key': config.naverSecret,
            },
        };

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const req = https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        finish(null);
                        return;
                    }

                    const parsed = JSON.parse(data);
                    if (parsed.status?.code !== 0 || !Array.isArray(parsed.results) || parsed.results.length === 0) {
                        finish(null);
                        return;
                    }

                    const bestRegionResult = pickBestRegionResult(parsed.results);
                    const extracted = extractRegionNames(bestRegionResult);
                    if (!extracted) {
                        finish(null);
                        return;
                    }

                    const stateName = extracted.state;
                    let cityName = extracted.city;

                    let buildingName = '';
                    const roadResult = parsed.results.find((r) => r.name === 'roadaddr');

                    // 하드코딩 블랙리스트 없이 길이와 숫자 여부만 판별
                    if (roadResult?.land?.addition0?.value) {
                        const rawBuildingName = roadResult.land.addition0.value.trim();
                        if (rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
                            buildingName = rawBuildingName;
                        }
                    }

                    if (buildingName) {
                        cityName = `${cityName} (${buildingName})`.trim();
                    }

                    finish({
                        state: stateName,
                        city: cityName,
                    });
                } catch (e) {
                    finish(null);
                }
            });

            res.on('error', () => finish(null));
        });

        req.setTimeout(config.apiTimeoutMs, () => {
            console.log(`[${nowKst()}] ⏱️ NAVER API timeout: ${lat}, ${lon} (${config.apiTimeoutMs}ms)`);
            req.destroy(new Error('NAVER_API_TIMEOUT'));
            finish(null);
        });

        req.on('error', () => finish(null));
    });
}

async function upsertCache(client, cacheKey, address) {
    await client.query(
        `INSERT INTO "custom_naver_geocode_cache" ("cache_key", "state", "city", "updated_at")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT ("cache_key") DO UPDATE
         SET "state" = EXCLUDED."state",
             "city" = EXCLUDED."city",
             "updated_at" = CURRENT_TIMESTAMP`,
        [cacheKey, address.state, address.city],
    );
}

async function getNaverAddress(client, lat, lon) {
    const cacheKey = getCacheKey(lat, lon);

    // 메모리 캐시만 확인
    if (addressCache.has(cacheKey)) {
        return { ...addressCache.get(cacheKey), source: 'memory' };
    }

    // 메모리에 없으면 바로 API 호출
    const apiAddress = await fetchNaverAddress(lat, lon);
    if (!apiAddress) return null;

    setMemoryCache(cacheKey, apiAddress);

    try {
        await upsertCache(client, cacheKey, apiAddress);
    } catch (e) {
        // 캐시 저장 실패는 치명적이지 않으므로 무시
    }

    return { ...apiAddress, source: 'api' };
}

async function bulkUpdateAssets(client, items) {
    if (!items.length) return 0;

    const values = [];
    const placeholders = [];

    items.forEach((item, index) => {
        const base = index * 3;
        placeholders.push(`($${base + 1}::uuid, $${base + 2}, $${base + 3})`);
        values.push(item.assetId, item.state, item.city);
    });

    const query = `
        UPDATE "asset_exif" AS a
        SET
            "country" = '대한민국',
            "state" = v.state,
            "city" = v.city
        FROM (
            VALUES ${placeholders.join(', ')}
        ) AS v(asset_id, state, city)
        WHERE a."assetId" = v.asset_id
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

async function bulkUpdateAssetsByIds(client, assetIds, address) {
    if (!assetIds.length || !address) return 0;

    const idPlaceholders = assetIds.map((_, index) => `$${index + 3}::uuid`).join(', ');
    const query = `
        UPDATE "asset_exif"
        SET "country" = '대한민국', "state" = $1, "city" = $2
        WHERE "assetId" IN (${idPlaceholders})
    `;

    const result = await client.query(query, [address.state, address.city, ...assetIds]);
    return result.rowCount || 0;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main(forceUpdate = false) {
    // 중복 실행 방지
    if (isRunning) {
        console.log(`[${nowKst()}] ⏳ 이미 작업이 진행 중입니다. 스킵합니다.`);
        return;
    }

    const client = new Client(config.db);
    isRunning = true;

    try {
        await client.connect();
        await ensureCacheTable(client);

        const warmedCount = await warmUpCache(client);
        console.log(`[${nowKst()}] 🔥 캐시 워밍업 완료: ${warmedCount}건 적재`);

        // main 1회당 대상 SELECT는 딱 1번만 수행
        let queryCondition = `WHERE "latitude" BETWEEN 33 AND 43 AND "longitude" BETWEEN 124 AND 132`;
        queryCondition += ` AND ("country" IN ('South Korea', '대한민국', 'Korea'))`;

        if (!forceUpdate) {
            queryCondition += ` AND ("city" IS NULL OR "city" !~ '[가-힣]')`;
        }

        const query = `
            SELECT "assetId", "latitude", "longitude", "country", "city", "state"
            FROM "asset_exif"
            ${queryCondition};
        `;

        const res = await client.query(query);

        if (res.rows.length === 0) {
            console.log(`[${nowKst()}] 🔍 업데이트할 항목이 없습니다.`);
            return;
        }

        const fastTrackRows = [];
        const apiTrackRows = [];

        for (const row of res.rows) {
            const cacheKey = getCacheKey(row.latitude, row.longitude);
            if (addressCache.has(cacheKey)) {
                fastTrackRows.push(row);
            } else {
                apiTrackRows.push(row);
            }
        }

        console.log(`[${nowKst()}] 🧭 대상 분류 완료: Fast Track ${fastTrackRows.length}건, API Track ${apiTrackRows.length}건`);

        let totalUpdated = 0;
        let fastTrackUpdated = 0;
        let apiTrackUpdated = 0;
        let apiCallCount = 0;
        let fastTrackHitCount = fastTrackRows.length;
        let apiTrackMemoryHitCount = 0;
        let fallbackHitCount = 0;

        // Phase 1: Fast Track
        console.log(`[${nowKst()}] ⚡ Phase 1 시작: 캐시 적중 건 고속 처리`);

        let fastPrepared = 0;

        for (let i = 0; i < fastTrackRows.length; i += FAST_TRACK_CHUNK_SIZE) {
            const chunk = fastTrackRows.slice(i, i + FAST_TRACK_CHUNK_SIZE);

            const updateItems = chunk
                .map((row) => {
                    const cacheKey = getCacheKey(row.latitude, row.longitude);
                    const cached = addressCache.get(cacheKey);
                    if (!cached) return null;

                    return {
                        assetId: row.assetId,
                        state: cached.state,
                        city: cached.city,
                    };
                })
                .filter(Boolean);

            fastPrepared += chunk.length;

            if (updateItems.length > 0) {
                const updated = await bulkUpdateAssets(client, updateItems);
                fastTrackUpdated += updated;
                totalUpdated += updated;
            }

            if (fastPrepared % FAST_TRACK_LOG_INTERVAL === 0 || fastPrepared === fastTrackRows.length) {
                console.log(
                    `[${nowKst()}] ⚡ Fast Track 진행: ${fastPrepared}/${fastTrackRows.length}건 준비 완료 (DB 반영: ${fastTrackUpdated})`,
                );
            }
        }

        console.log(`[${nowKst()}] ✅ Phase 1 완료: ${fastTrackUpdated}건 반영`);

        // Phase 2: API Track
        console.log(`[${nowKst()}] 🌐 Phase 2 시작: 미확인 주소만 API 처리`);

        const apiTrackGroups = new Map();
        for (const row of apiTrackRows) {
            const cacheKey = getCacheKey(row.latitude, row.longitude);
            if (!apiTrackGroups.has(cacheKey)) {
                apiTrackGroups.set(cacheKey, []);
            }
            apiTrackGroups.get(cacheKey).push(row);
        }

        console.log(`[${nowKst()}] 🗂️ API Track 좌표 그룹화 완료: ${apiTrackGroups.size}개 그룹`);

        let apiProcessedGroups = 0;
        let apiProcessedPhotos = 0;

        for (const [cacheKey, rows] of apiTrackGroups.entries()) {
            apiProcessedGroups++;
            apiProcessedPhotos += rows.length;

            const firstRow = rows[0];
            let address = null;

            if (apiProcessedGroups <= 3) {
                console.log(
                    `[${nowKst()}] 🔎 API Track 샘플 시작: ${apiProcessedGroups}/${apiTrackGroups.size}그룹 | cache_key=${cacheKey} | lat=${firstRow.latitude} | lon=${firstRow.longitude} | photos=${rows.length}`,
                );
            }

            try {
                address = await getNaverAddress(client, firstRow.latitude, firstRow.longitude);

                if (address?.source === 'memory') {
                    apiTrackMemoryHitCount += rows.length;
                } else if (address?.source === 'api') {
                    apiCallCount++;
                }

                if (!address) {
                    const korState = translateLocation(firstRow.state);
                    const korCity = translateLocation(firstRow.city);

                    if (korState || korCity) {
                        address = {
                            state: korState || firstRow.state,
                            city: korCity || firstRow.city,
                            source: 'fallback',
                        };
                        fallbackHitCount += rows.length;
                    }
                }

                if (address) {
                    const assetIds = rows.map((row) => row.assetId);
                    const updated = await bulkUpdateAssetsByIds(client, assetIds, address);
                    apiTrackUpdated += updated;
                    totalUpdated += updated;
                }
            } catch (err) {
                // 개별 그룹 에러는 무시하고 다음 그룹으로 진행
            }

            if (apiProcessedGroups % API_TRACK_LOG_INTERVAL === 0 || apiProcessedGroups === apiTrackGroups.size) {
                console.log(
                    `[${nowKst()}] 🌐 API Track 진행: ${apiProcessedGroups}/${apiTrackGroups.size}그룹, ${apiProcessedPhotos}/${apiTrackRows.length}장 (실제 API 호출: ${apiCallCount} | 중복 좌표 메모리 재사용: ${apiTrackMemoryHitCount} | Fallback: ${fallbackHitCount} | DB 반영: ${apiTrackUpdated})`,
                );
            }

            // 실제 API를 호출한 좌표 그룹에만 rate limit 방어용 sleep
            if (address?.source === 'api') {
                await sleep(config.delay);
            }
        }

        console.log(`[${nowKst()}] ✅ Phase 2 완료: ${apiTrackUpdated}건 반영`);

        console.log(`[${nowKst()}] 🎉 작업 완료 상세 리포트`);
        console.log(` ┌─ 캐시 워밍업 적재: ${warmedCount}건`);
        console.log(` ├─ Fast Track 대상: ${fastTrackRows.length}건`);
        console.log(` ├─ API Track 대상: ${apiTrackRows.length}건`);
        console.log(` ├─ Fast Track 캐시 적중: ${fastTrackHitCount}건`);
        console.log(` ├─ Fast Track 반영: ${fastTrackUpdated}건`);
        console.log(` ├─ API Track 반영: ${apiTrackUpdated}건`);
        console.log(` ├─ 실제 API 호출: ${apiCallCount}번`);
        console.log(` ├─ API Track 내 메모리 재사용: ${apiTrackMemoryHitCount}번`);
        console.log(` ├─ 사전 번역(Fallback): ${fallbackHitCount}번`);
        console.log(` └─ 총 DB 반영: ${totalUpdated}건`);
    } catch (err) {
        console.error('❌ [DB 에러]', err.message);
    } finally {
        try {
            await client.end();
        } catch (e) {}
        isRunning = false;
    }
}

if (isForceMode) {
    main(true).then(() => process.exit(0));
} else {
    main(false);
    setInterval(() => main(false), config.interval);
}
