const https = require('https');

function fetchJsonDetailed(url, headers = {}, timeoutMs = 10000) {
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
        if (res.statusCode !== 200) {
          return finish({ ok: false, statusCode: res.statusCode, error: `HTTP ${res.statusCode}` });
        }

        try {
          finish({ ok: true, statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          finish({ ok: false, statusCode: res.statusCode, error: 'invalid-json' });
        }
      });
      res.on('error', (error) => finish({ ok: false, statusCode: res.statusCode || 0, error: error.message || 'response-error' }));
    });

    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (e) {}
      finish({ ok: false, statusCode: 0, error: `timeout-${timeoutMs}ms` });
    });
    req.on('error', (error) => finish({ ok: false, statusCode: 0, error: error.message || 'request-error' }));
  });
}

async function fetchJson(url, headers = {}, timeoutMs = 10000) {
  const result = await fetchJsonDetailed(url, headers, timeoutMs);
  return result.ok ? result.data : null;
}

module.exports = { fetchJson, fetchJsonDetailed };
