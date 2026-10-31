// Speaks the catalog worker protocol with no Python or network, so the client's
// process handling can be tested. The query chooses the behavior.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
send({ type: 'hello', protocol: Number(process.env.STUB_PROTOCOL ?? 1) });

const row = { videoId: 'stub-1', title: 'Stub Song', videoType: null, artists: [], albumName: null, albumId: null, durationSeconds: 100, isExplicit: null, thumbnails: [] };

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, params } = JSON.parse(line);
  const query = params.query;
  if (query === 'slow') return; // Never answers.
  if (query === 'crash') process.exit(3);
  if (query === 'limited') return send({ id, ok: false, kind: 'rate-limited', message: 'HTTP 429' });
  if (query === 'changed-shape') return send({ id, ok: true, value: [{ videoId: 42 }] });
  if (query === 'garbage') return process.stdout.write('not json\n');
  send({ id, ok: true, value: [{ ...row, title: `${query} 宇多田` }] });
});
