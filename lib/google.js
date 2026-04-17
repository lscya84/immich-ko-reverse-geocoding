const { fetchJson } = require('./http');

async function fetchGoogleAddress(lat, lon, config) {
  if (!config.googleApiKey) return null;

  const language = config.googleLanguage || 'ko';
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=${encodeURIComponent(language)}&key=${encodeURIComponent(config.googleApiKey)}`;
  const parsed = await fetchJson(url, {}, config.googleTimeoutMs || config.apiTimeoutMs || 10000);

  if (!parsed || parsed.status !== 'OK' || !parsed.results?.length) return null;

  const result = parsed.results[0];
  const getComp = (...types) => {
    for (const type of types) {
      const comp = result.address_components?.find((c) => c.types.includes(type));
      if (comp) return comp.long_name;
    }
    return null;
  };

  const country = getComp('country') || '';
  const state = getComp('administrative_area_level_1') || '';
  const level2 = getComp('administrative_area_level_2') || '';
  const locality = getComp('locality') || '';
  const sublocality1 = getComp('sublocality_level_1') || '';
  const premise = getComp('premise') || '';
  const pointOfInterest = getComp('point_of_interest') || '';
  const establishment = getComp('establishment') || '';

  const cityParts = [locality || level2, sublocality1]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter((v) => v !== state);

  const buildingName = premise || pointOfInterest || establishment || '';

  return {
    country,
    state,
    city: cityParts.join(' ') || level2 || locality || '',
    legalDong: sublocality1 || '',
    poiName: buildingName,
    roadAddress: result.formatted_address || '',
    jibunAddress: '',
    provider: 'google',
    source: 'api',
  };
}

module.exports = { fetchGoogleAddress };
