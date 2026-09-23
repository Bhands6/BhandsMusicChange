/** 端到端：直接调 musicParser.parseMusic，确认 level 已随结果透传（真实上游） */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { parseMusic } = require(path.join(ROOT, 'server/music-sources/musicParser'));

const songs = [
  { id: 2623517920, name: '晴天', artists: ['周杰伦'], duration: 269000 },
  { id: 1330348068, name: '起风了', artists: ['买辣椒也用券'], duration: 325000 },
];

(async function () {
  for (const s of songs) {
    for (const q of ['jymaster', 'standard']) {
      const r = await parseMusic({
        id: s.id, name: s.name, artists: s.artists, album: '', duration: s.duration,
        quality: q, enabledSources: ['gdmusic', 'goMusic', 'kugou'],
      });
      console.log(JSON.stringify({
        song: s.name, 请求档位: q,
        source: r && r.source, level: r && r.level, br: r && r.br,
        quality: r && r.quality,
        url: r && r.url ? String(r.url).slice(0, 60) + '...' : null,
      }));
    }
  }
  process.exit(0);
})();
