require('dotenv').config({ path: process.env.DOTENV_PATH || '/app/.env' });
const { reverseGeocode } = require('./lib/geocode');

const config = {
  naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
  naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
  vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
  googleApiKey: (process.env.GOOGLE_API_KEY || '').trim(),
  googleTimeoutMs: parseInt(process.env.GOOGLE_API_TIMEOUT_MS || '10000', 10),
  googleLanguage: (() => {
    const mode = (process.env.GEOCODE_FOREIGN_LANGUAGE_MODE || 'korean').trim().toLowerCase();
    if (mode === 'english') return 'en';
    if (mode === 'local') return '';
    return 'ko';
  })(),
  apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
};

module.exports = { reverseGeocode: (lat, lon, options = {}) => reverseGeocode(lat, lon, config, options) };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rawMode = args.includes('--raw');
  const filteredArgs = args.filter((arg) => arg !== '--raw');
  const [latArg, lonArg] = filteredArgs;

  if (!latArg || !lonArg) {
    console.error('Usage: node reverse_geocode.js <lat> <lon> [--raw]');
    process.exit(1);
  }

  reverseGeocode(latArg, lonArg, config, { preferBuildingName: true, includeRaw: rawMode })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 2);
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    });
}
