const { fetchJsonDetailed } = require('./http');
const { normalizeVworldDepths } = require('./geocode-utils');

async function fetchVworldAddressDetailed(lat, lon, config) {
  if (!config.vworldKey) {
    return { address: null, attempted: false, provider: 'vworld', reason: 'missing-vworld-key' };
  }

  const url = `https://api.vworld.kr/req/address?service=address&request=getAddress&version=2.0&crs=epsg:4326&point=${lon},${lat}&format=json&type=both&key=${encodeURIComponent(config.vworldKey)}`;
  const response = await fetchJsonDetailed(url, {}, config.apiTimeoutMs);
  if (!response.ok) {
    return {
      address: null,
      attempted: true,
      provider: 'vworld',
      reason: response.error || 'request-failed',
      statusCode: response.statusCode || 0,
    };
  }

  const parsed = response.data;
  const results = Array.isArray(parsed?.response?.result) ? parsed.response.result : [];
  if (parsed?.response?.status !== 'OK' || !results.length) {
    return {
      address: null,
      attempted: true,
      provider: 'vworld',
      reason: parsed?.response?.status || 'empty-result',
      statusCode: response.statusCode || 200,
    };
  }

  const parcelResult = results.find((item) => item.type === 'parcel') || results[0];
  const roadResult = results.find((item) => item.type === 'road');
  const structure = parcelResult.structure || roadResult?.structure || {};
  const [state, level2, legalDong] = normalizeVworldDepths(structure);
  const city = [level2, legalDong].filter(Boolean).join(' ').trim();

  return {
    address: {
      country: '대한민국',
      state,
      city,
      legalDong,
      poiName: roadResult?.text ? '' : '',
      roadAddress: roadResult?.text || '',
      jibunAddress: parcelResult?.text || '',
      provider: 'vworld',
      source: 'api',
    },
    attempted: true,
    provider: 'vworld',
    reason: 'ok',
    statusCode: response.statusCode || 200,
  };
}

async function fetchVworldAddress(lat, lon, config) {
  const result = await fetchVworldAddressDetailed(lat, lon, config);
  return result.address;
}

module.exports = { fetchVworldAddress, fetchVworldAddressDetailed };
