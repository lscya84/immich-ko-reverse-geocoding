require('dotenv').config({ path: '/app/.env' });
const { Client } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const config = {
    naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
    naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
    vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
    db: {
        user: (process.env.DB_USERNAME || 'postgres').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        host: (process.env.DB_HOSTNAME || 'immich_postgres').trim(),
        database: (process.env.DB_DATABASE_NAME || 'immich').trim(),
        port: 5432,
    },
    interval: parseInt(process.env.INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100', 10),
    apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
    clusterRadiusMeters: parseInt(process.env.CLUSTER_RADIUS_METERS || '15', 10),
    clusterYieldInterval: parseInt(process.env.CLUSTER_YIELD_INTERVAL || '1000', 10),
    appendBuildingName: String(process.env.APPEND_BUILDING_NAME || 'true').toLowerCase() === 'true',
};

const isForceMode = process.argv.includes('--force');
let locationMap = {};

const addressCache = new Map();
const MAX_CACHE_SIZE = 50000;
const CACHE_TTL_DAYS = 180;

const FAST_TRACK_CHUNK_SIZE = 2000;
const FAST_TRACK_LOG_INTERVAL = 10000;
const API_TRACK_LOG_INTERVAL = 50;

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
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;
}

function buildClusterKey(lat, lon, radiusMeters = 15) {
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}_${radiusMeters}`;
}

function setMemoryCache(cacheKey, value, enforceLimit = true) {
    if (enforceLimit && addressCache.size >= MAX_CACHE_SIZE) {
        const firstKey = addressCache.keys().next().value;
        addressCache.delete(firstKey);
    }
    addressCache.set(cacheKey, value);
}

function normalizeVworldKoreanText(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const map = {
        'South Korea': '대한민국',
        'Korea': '대한민국',
        'Seoul': '서울특별시',
        'Busan': '부산광역시',
        'Daegu': '대구광역시',
        'Incheon': '인천광역시',
        'Gwangju': '광주광역시',
        'Daejeon': '대전광역시',
        'Ulsan': '울산광역시',
        'Sejong': '세종특별자치시',
        'Gyeonggi-do': '경기도',
        'Gangwon-do': '강원특별자치도',
        'Chungcheongbuk-do': '충청북도',
        'Chungcheongnam-do': '충청남도',
        'Jeollabuk-do': '전북특별자치도',
        'Jeollanam-do': '전라남도',
        'Gyeongsangbuk-do': '경상북도',
        'Gyeongsangnam-do': '경상남도',
        'Jeju-do': '제주특별자치도',
    };
    return map[text] || text;
}

function normalizeVworldDepths(structure) {
    const level1 = normalizeVworldKoreanText(structure?.level1 || '');
    const level2 = normalizeVworldKoreanText(structure?.level2 || '');
    const legalDong = normalizeVworldKoreanText(structure?.level4L || '');
    return [level1, level2, legalDong].filter(Boolean);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function extractBuildingNameFromRoadText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const paren = raw.match(/\(([^()]*)\)\s*$/);
    if (paren) {
        const parts = paren[1].split(',').map((v) => v.trim()).filter(Boolean);
        if (parts.length >= 2) return parts[parts.length - 1];
        if (parts.length === 1 && !/^[0-9-]+$/.test(parts[0])) return parts[0];
    }

    const tokens = raw.split(/\s+/).map((v) => v.trim()).filter(Boolean);
    const candidate = tokens[tokens.length - 1] || '';
    if (/^[0-9-]+$/.test(candidate)) return '';
    return candidate;
}

function fetchJson(url, headers = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const req = https.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) return finish(null);
                    finish(JSON.parse(data));
                } catch (e) {
                    finish(null);
                }
            });
            res.on('error', () => finish(null));
        });

        req.setTimeout(config.apiTimeoutMs, () => {
            try { req.destroy(); } catch (e) {}
            finish(null);
        });
        req.on('error', () => finish(null));
    });
}

async function fetchVworldAddress(lat, lon) {
    if (!config.vworldKey) return null;

    const url = `https://api.vworld.kr/req/address?service=address&request=getAddress&version=2.0&crs=epsg:4326&point=${lon},${lat}&format=json&type=both&key=${encodeURIComponent(config.vworldKey)}`;
    const parsed = await fetchJson(url);
    const results = Array.isArray(parsed?.response?.result) ? parsed.response.result : [];
    if (parsed?.response?.status !== 'OK' || !results.length) return null;

    const parcelResult = results.find((item) => item.type === 'parcel') || results[0];
    const structure = parcelResult.structure || {};
    const [state, level2, legalDong] = normalizeVworldDepths(structure);
    const city = [level2, legalDong].filter(Boolean).join(' ').trim();

    return {
        country: '대한민국',
        state,
        city,
        legalDong,
        poiName: '',
        provider: 'vworld',
        source: 'api',
    };
}

async function fetchNaverBuildingName(lat, lon) {
    if (!config.naverId || !config.naverSecret) return '';

    const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=roadaddr,addr`;
    const parsed = await fetchJson(url, {
        'x-ncp-apigw-api-key-id': config.naverId,
        'x-ncp-apigw-api-key': config.naverSecret,
    });

    if (parsed?.status?.code !== 0 || !Array.isArray(parsed.results) || !parsed.results.length) return '';

    const roadResult = parsed.results.find((r) => r.name === 'roadaddr');
    const rawBuildingName = roadResult?.land?.addition0?.value?.trim();
    if (rawBuildingName && rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
        return rawBuildingName;
    }

    if (roadResult?.land) {
        const roadTextParts = [
            roadResult.land.name1,
            roadResult.land.number1,
            roadResult.land.number2,
            roadResult.land.addition1?.value,
            roadResult.land.addition2?.value,
            roadResult.land.addition3?.value,
            roadResult.land.addition4?.value,
        ].filter(Boolean);
        return extractBuildingNameFromRoadText(roadTextParts.join(' '));
    }

    return '';
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
        setMemoryCache(row.cache_key, {
            state: row.state,
            city: row.city,
        }, false);
    }

    return res.rows.length;
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

async function getClusterAddress(client, cluster) {
    if (addressCache.has(cluster.clusterKey)) {
        return { ...addressCache.get(cluster.clusterKey), source: 'memory' };
    }

    let address = await fetchVworldAddress(cluster.centroidLat, cluster.centroidLon);
    if (!address) {
        const korState = translateLocation(cluster.points[0]?.state);
        const korCity = translateLocation(cluster.points[0]?.city);
        if (korState || korCity) {
            address = {
                state: korState || cluster.points[0]?.state || '',
                city: korCity || cluster.points[0]?.city || '',
                source: 'fallback',
            };
        }
    }
    if (!address) return null;

    if (config.appendBuildingName) {
        const buildingName = await fetchNaverBuildingName(cluster.centroidLat, cluster.centroidLon);
        if (buildingName && !address.city.includes(buildingName)) {
            address.city = `${address.city} (${buildingName})`.trim();
        }
    }

    setMemoryCache(cluster.clusterKey, address);
    try {
        await upsertCache(client, cluster.clusterKey, address);
    } catch (e) {}

    return address;
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

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function clusterRows(rows, radiusMeters) {
    const remaining = rows.map((row, index) => ({ ...row, __index: index }));
    const clusters = [];

    while (remaining.length) {
        const seed = remaining.shift();
        const clusterItems = [seed];
        let sumLat = parseFloat(seed.latitude);
        let sumLon = parseFloat(seed.longitude);

        for (let i = remaining.length - 1; i >= 0; i--) {
            const row = remaining[i];
            const distance = haversineMeters(seed.latitude, seed.longitude, row.latitude, row.longitude);
            if (distance <= radiusMeters) {
                clusterItems.push(row);
                sumLat += parseFloat(row.latitude);
                sumLon += parseFloat(row.longitude);
                remaining.splice(i, 1);
            }
        }

        const centroidLat = sumLat / clusterItems.length;
        const centroidLon = sumLon / clusterItems.length;
        clusters.push({
            clusterId: randomUUID(),
            clusterKey: buildClusterKey(centroidLat, centroidLon, radiusMeters),
            centroidLat,
            centroidLon,
            assetCount: clusterItems.length,
            assetIds: clusterItems.map((row) => row.assetId),
            points: clusterItems,
        });
    }

    return clusters;
}

async function main(forceUpdate = false) {
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

        const clusters = clusterRows(res.rows, config.clusterRadiusMeters);
        const fastTrackClusters = [];
        const apiTrackClusters = [];

        for (const cluster of clusters) {
            if (addressCache.has(cluster.clusterKey)) fastTrackClusters.push(cluster);
            else apiTrackClusters.push(cluster);
        }

        console.log(`[${nowKst()}] 🧭 대상 분류 완료: 클러스터 ${clusters.length}개, Fast Track ${fastTrackClusters.length}개, API Track ${apiTrackClusters.length}개`);

        let totalUpdated = 0;
        let fastTrackUpdated = 0;
        let apiTrackUpdated = 0;
        let apiCallCount = 0;
        let fastPrepared = 0;
        let apiProcessedClusters = 0;
        let apiProcessedPhotos = 0;
        const totalPhotos = apiTrackClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);

        console.log(`[${nowKst()}] ⚡ Phase 1 시작: 캐시 적중 클러스터 고속 처리`);

        for (let i = 0; i < fastTrackClusters.length; i += FAST_TRACK_CHUNK_SIZE) {
            const chunk = fastTrackClusters.slice(i, i + FAST_TRACK_CHUNK_SIZE);
            const updateItems = [];

            for (const cluster of chunk) {
                const cached = addressCache.get(cluster.clusterKey);
                if (!cached) continue;
                for (const assetId of cluster.assetIds) {
                    updateItems.push({ assetId, state: cached.state, city: cached.city });
                }
                fastPrepared += cluster.assetCount;
            }

            if (updateItems.length > 0) {
                const updated = await bulkUpdateAssets(client, updateItems);
                fastTrackUpdated += updated;
                totalUpdated += updated;
            }

            if (fastPrepared % FAST_TRACK_LOG_INTERVAL === 0 || fastPrepared === fastTrackClusters.reduce((s, c) => s + c.assetCount, 0)) {
                console.log(`[${nowKst()}] ⚡ Fast Track 진행: ${fastPrepared}장 처리 (DB 반영: ${fastTrackUpdated})`);
            }
        }

        console.log(`[${nowKst()}] ✅ Phase 1 완료: ${fastTrackUpdated}건 반영`);
        console.log(`[${nowKst()}] 🌐 Phase 2 시작: 미확인 클러스터 API 처리`);

        for (const cluster of apiTrackClusters) {
            apiProcessedClusters++;
            apiProcessedPhotos += cluster.assetCount;

            const address = await getClusterAddress(client, cluster);
            if (address?.source === 'api') apiCallCount++;

            if (address) {
                const updateItems = cluster.assetIds.map((assetId) => ({
                    assetId,
                    state: address.state,
                    city: address.city,
                }));
                const updated = await bulkUpdateAssets(client, updateItems);
                apiTrackUpdated += updated;
                totalUpdated += updated;
            }

            if (apiProcessedClusters % API_TRACK_LOG_INTERVAL === 0 || apiProcessedClusters === apiTrackClusters.length) {
                console.log(`[${nowKst()}] 🌐 API Track 진행: ${apiProcessedClusters}/${apiTrackClusters.length}개 클러스터, ${apiProcessedPhotos}/${totalPhotos}장 (실제 API 호출: ${apiCallCount}, DB 반영: ${apiTrackUpdated})`);
            }

            if (address?.source === 'api') {
                await sleep(config.delay);
            }
        }

        console.log(`[${nowKst()}] ✅ Phase 2 완료: ${apiTrackUpdated}건 반영`);
        console.log(`[${nowKst()}] 🎉 작업 완료 상세 리포트`);
        console.log(` ┌─ 캐시 워밍업 적재: ${warmedCount}건`);
        console.log(` ├─ 총 클러스터 수: ${clusters.length}개`);
        console.log(` ├─ Fast Track 클러스터: ${fastTrackClusters.length}개`);
        console.log(` ├─ API Track 클러스터: ${apiTrackClusters.length}개`);
        console.log(` ├─ Fast Track 반영: ${fastTrackUpdated}건`);
        console.log(` ├─ API Track 반영: ${apiTrackUpdated}건`);
        console.log(` ├─ 실제 VWorld/Naver API 호출 클러스터: ${apiCallCount}개`);
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
