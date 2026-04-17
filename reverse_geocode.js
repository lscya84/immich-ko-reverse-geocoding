require('dotenv').config({ path: process.env.DOTENV_PATH || '/app/.env' });
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
  naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
  naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
  vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
  apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
};

let locationMap = {};
try {
  const mappingPath = path.join(__dirname, 'mapping.json');
  if (fs.existsSync(mappingPath)) {
    locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  }
} catch (e) {}

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

function roadTextPartsToAddress(land) {
  return [
    land?.name1,
    [land?.number1, land?.number2].filter(Boolean).join('-'),
    land?.addition0?.value,
  ].filter(Boolean).join(' ').trim();
}

function jibunLandToAddress(land, state, area2, area3, area4) {
  return [
    state,
    area2,
    area3,
    area4,
    land?.number1,
    land?.number2 ? `-${land.number2}` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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
  const roadResult = results.find((item) => item.type === 'road');
  const structure = parcelResult.structure || roadResult?.structure || {};
  const [state, level2, legalDong] = normalizeVworldDepths(structure);
  const city = [level2, legalDong].filter(Boolean).join(' ').trim();

  return {
    country: '대한민국',
    state,
    city,
    legalDong,
    poiName: '',
    roadAddress: roadResult?.text || '',
    jibunAddress: parcelResult?.text || '',
    provider: 'vworld',
    source: 'api',
  };
}

async function fetchNaverAddress(lat, lon) {
  if (!config.naverId || !config.naverSecret) return null;

  const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=legalcode,admcode,roadaddr,addr`;
  const parsed = await fetchJson(url, {
    'x-ncp-apigw-api-key-id': config.naverId,
    'x-ncp-apigw-api-key': config.naverSecret,
  });

  if (parsed?.status?.code !== 0 || !Array.isArray(parsed.results) || !parsed.results.length) return null;

  const legalResult = parsed.results.find((r) => r.name === 'legalcode');
  const admResult = parsed.results.find((r) => r.name === 'admcode');
  const regionResult = legalResult || admResult || parsed.results.find((r) => r.region) || parsed.results[0];
  const region = regionResult?.region;
  if (!region) return null;

  const state = region.area1?.name || '';
  const area2 = region.area2?.name || '';
  const area3 = region.area3?.name || '';
  const area4 = region.area4?.name || '';
  const city = [area2, area3, area4].filter(Boolean).join(' ').trim();

  const roadResult = parsed.results.find((r) => r.name === 'roadaddr');
  const jibunResult = parsed.results.find((r) => r.name === 'addr');
  let poiName = '';
  const rawBuildingName = roadResult?.land?.addition0?.value?.trim();
  if (rawBuildingName && rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
    poiName = rawBuildingName;
  } else if (roadResult?.land) {
    const roadTextParts = [
      roadResult.land.name1,
      roadResult.land.number1,
      roadResult.land.number2,
      roadResult.land.addition1?.value,
      roadResult.land.addition2?.value,
      roadResult.land.addition3?.value,
      roadResult.land.addition4?.value,
    ].filter(Boolean);
    poiName = extractBuildingNameFromRoadText(roadTextParts.join(' '));
  }

  return {
    country: '대한민국',
    state,
    city,
    legalDong: [area3, area4].filter(Boolean).join(' ').trim(),
    poiName,
    roadAddress: roadResult?.land ? roadTextPartsToAddress(roadResult.land) : '',
    jibunAddress: jibunResult?.land ? jibunLandToAddress(jibunResult.land, state, area2, area3, area4) : '',
    provider: 'naver',
    source: 'api',
  };
}

async function reverseGeocode(lat, lon, options = {}) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) {
    throw new Error('lat/lon must be valid numbers');
  }

  const latitude = Number(lat);
  const longitude = Number(lon);
  const preferBuildingName = options.preferBuildingName !== false;
  const includeRaw = options.includeRaw === true;

  const vworldAddress = await fetchVworldAddress(latitude, longitude);
  let address = vworldAddress;
  let naverAddress = null;

  if (!address || preferBuildingName || (config.naverId && config.naverSecret)) {
    naverAddress = await fetchNaverAddress(latitude, longitude);
  }

  if (!address && naverAddress) {
    address = {
      country: naverAddress.country,
      state: naverAddress.state,
      city: naverAddress.city,
      legalDong: naverAddress.legalDong,
      poiName: naverAddress.poiName || '',
      roadAddress: naverAddress.roadAddress || '',
      jibunAddress: naverAddress.jibunAddress || '',
      provider: 'naver',
      source: 'api',
    };
  }

  if (!address) {
    return {
      ok: false,
      lat: latitude,
      lon: longitude,
      error: 'No reverse geocoding result',
    };
  }

  if (preferBuildingName && naverAddress?.poiName) {
    address.poiName = naverAddress.poiName;
    if (!address.city.includes(naverAddress.poiName)) {
      address.city = `${address.city} (${naverAddress.poiName})`.trim();
    }
  }

  if (!address.poiName && naverAddress?.poiName) {
    address.poiName = naverAddress.poiName;
  }

  const result = {
    ok: true,
    lat: latitude,
    lon: longitude,
    summary: {
      country: address.country || '',
      state: address.state || '',
      city: address.city || '',
      legalDong: address.legalDong || '',
      buildingName: address.poiName || '',
      roadAddress: address.roadAddress || '',
      jibunAddress: address.jibunAddress || '',
      selectedProvider: address.provider || '',
    },
    providers: {
      vworld: vworldAddress ? {
        state: vworldAddress.state || '',
        city: vworldAddress.city || '',
        legalDong: vworldAddress.legalDong || '',
        buildingName: vworldAddress.poiName || '',
        roadAddress: vworldAddress.roadAddress || '',
        jibunAddress: vworldAddress.jibunAddress || '',
      } : null,
      naver: naverAddress ? {
        state: naverAddress.state || '',
        city: naverAddress.city || '',
        legalDong: naverAddress.legalDong || '',
        buildingName: naverAddress.poiName || '',
        roadAddress: naverAddress.roadAddress || '',
        jibunAddress: naverAddress.jibunAddress || '',
      } : null,
    },
  };

  if (includeRaw) {
    result.raw = {
      selected: address,
      vworld: vworldAddress,
      naver: naverAddress,
    };
  }

  return result;
}

module.exports = {
  reverseGeocode,
  fetchVworldAddress,
  fetchNaverAddress,
  translateLocation,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const rawMode = args.includes('--raw');
  const filteredArgs = args.filter((arg) => arg !== '--raw');
  const [latArg, lonArg] = filteredArgs;

  if (!latArg || !lonArg) {
    console.error('Usage: node reverse_geocode.js <lat> <lon> [--raw]');
    process.exit(1);
  }

  reverseGeocode(latArg, lonArg, { preferBuildingName: true, includeRaw: rawMode })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 2);
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    });
}
