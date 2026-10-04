/* eslint-env node, es2022 */
/** Supplies local regtest configuration and records public UI results only. */
const fs = require('node:fs');
const http = require('node:http');
const [configPath, eventsPath] = process.argv.slice(2);
if (!configPath || !eventsPath) {
  throw new Error('Usage: node observer.cjs config.json events.jsonl');
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.network !== 'regtest')
  throw new Error('Regtest configuration required');
const events = new Set([
  'receive',
  'prepareSend',
  'prepareDrain',
  'send',
  'drain',
  'snapshot',
  'error',
]);
http
  .createServer(async (request, response) => {
    try {
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'GET' && request.url === '/config') {
        response.end(
          JSON.stringify({
            network: config.network,
            primaryUri: config.primaryUri,
            electrum: config.electrum,
          }),
        );
        return;
      }
      if (request.method !== 'POST' || request.url !== '/event') {
        response.statusCode = 404;
        response.end('{}');
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) throw new Error('Event too large');
      }
      const event = JSON.parse(body);
      if (!events.has(event.kind)) throw new Error('Unsupported event');
      fs.appendFileSync(
        eventsPath,
        JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n',
      );
      response.end('{}');
    } catch {
      response.statusCode = 400;
      response.end('{"error":"Invalid observation"}');
    }
  })
  .listen(31081, '127.0.0.1');
