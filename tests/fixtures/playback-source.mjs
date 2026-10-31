// Deterministic subprocess using P2's existing JSON-line worker boundary.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const track = JSON.parse(input);
if (track.title.includes('Evening')) process.stdout.write(JSON.stringify({ ok: true, value: { uri: 'https://audio-ssl.itunes.apple.com/full-fixture.wav', mimeType: 'audio/wav', expiresAt: Date.now() + 60000 } }) + '\n');
else process.stdout.write(JSON.stringify({ ok: false, error: 'Synthetic unavailable source' }) + '\n');
