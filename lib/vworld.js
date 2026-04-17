const { fetchJson } = require('./http');
const { normalizeVworldDepths } = require('./geocode-utils');

async function fetchVworldAddress(lat, lon, config) {
  if (!config.vworldKey) return null;

  const url = `https://api.vworld.kr/req/address?service=address&request=getAddress&version=2.0&crs=epsg:4326&point=${lon},${lat}&format=json&type=both&key=${encodeURIComponent(config.vworldKey)}`;
  const parsed = await fetchJson(url, {}, config.apiTimeoutMs);
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
    poiName: roadResult?.text ? '' : '',
    roadAddress: roadResult?.text || '',
    jibunAddress: parcelResult?.text || '',
    provider: 'vworld',
    source: 'api',
  };
}

module.exports = { fetchVworldAddress };
