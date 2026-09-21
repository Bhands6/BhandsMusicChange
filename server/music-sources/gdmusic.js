'use strict';

/**
 * GD音乐台解析服务
 * 通过 https://music-api.gdstudio.xyz 搜索并获取音乐 URL
 */

const axios = require('axios');

const BASE_URL = 'https://music-api.gdstudio.xyz/api.php';

/**
 * 时长接近度的打分尺度（毫秒）：差值 0 → +1.0，差值越大线性递减到 0。
 * 必须连续打分，否则「差 2 秒」和「差 0 秒」同分，会被其它微调项翻盘。
 */
const DURATION_PROXIMITY_MS = 12000;

/**
 * 变体标注（Live/现场/翻唱/伴奏/Remix/DJ 版等）——这类版本不能冒充原曲。
 * 必须对**原始**歌名判断：normalizeText 会把括号内容整段删掉，
 * 「Take Me To Your Heart (Live)」归一化后与原曲完全相同。
 */
const VARIANT_NAME_RE = /[(（【\[][^\)）\]]*(live|现场|演唱会|翻唱|cover|伴奏|remix|dj|混音|铃声|试听|纯音乐|acoustic|instrumental|karaoke|demo|翻录|重制|remaster)[^\)）\]]*[)）\]]/i;

/**
 * 归一化文本用于匹配：去掉括号备注（Live/翻唱/伴奏等）、空白与常见标点，转小写
 */
function normalizeText(text) {
  if (!text) return '';
  const stripped = text
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, '')
    .replace(/[\s\-—_·・'"''""!！?？.,，。&＆+]/g, '');
  // 整个歌名都在括号里时退化为仅去标点，避免归一化成空串
  return stripped || text.toLowerCase().replace(/[\s\-—_·・'"''""!！?？.,，。&＆+]/g, '');
}

/**
 * 获取候选歌手文本
 */
function getCandidateArtistText(artist) {
  if (Array.isArray(artist)) {
    return artist
      .map(function (item) {
        return typeof item === 'string' ? item : (item && item.name) || '';
      })
      .join(' ');
  }
  return typeof artist === 'string' ? artist : '';
}

/**
 * 检查歌名是否匹配
 */
function isNameMatched(expectedName, candidateName) {
  const expected = normalizeText(expectedName);
  const candidate = normalizeText(candidateName);
  if (!expected || !candidate) return false;
  if (expected === candidate) return true;
  // 包含式匹配仅限较长歌名（≥5 字）：短歌名同名前缀歌太多，防货不对版
  if (expected.length >= 5 && candidate.includes(expected)) return true;
  if (candidate.length >= 5 && expected.includes(candidate)) return true;
  return false;
}

/**
 * 从候选中挑选与原曲匹配的结果
 * 校验策略（按强度从高到低）：
 *  ① 网易云子源且候选 id == 目标歌曲 id → 同一首，直接命中；
 *  ② 歌名必须匹配（normalizeText 会剥掉括号内容，所以括号里的变体标注要单独降权）；
 *  ③ 候选带歌手信息时歌手也必须匹配；
 * 宁可解析失败也不返回错误的歌（防止"货不对版"）
 */
function pickBestCandidate(candidates, expected, source) {
  let best = null;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || !item.id) continue;

    // ① 最强信号：网易云子源的候选 id 就是网易云歌曲 id，与目标相同即同一首。
    // 必须放在歌名/变体判断之前 —— 否则「原曲 (Live)」这类同名变体会抢先。
    //（GD 接口 search 返回里 id / url_id / lyric_id 都是网易云歌曲 id）
    if (source === 'netease' && expected.targetId && String(item.id) === String(expected.targetId)) return item;

    if (!isNameMatched(expected.name, item.name || '')) continue;

    // 时长硬校验：偏差超过 max(10s, 12%) 直接拒绝（不同版本歌词时间轴必然对不上）
    // ⚠ 实测 GD 接口的 search 返回**不含 duration 字段**，所以对 netease/joox 这条基本不生效，
    //   真正的兜底是 ② 的变体降权 和下游 durationProbe 的真实音频时长校验。
    const itemDurationMs = (Number(item.duration) || 0) * 1000;
    if (expected.durationMs > 0 && itemDurationMs > 0) {
      const durationDiff = Math.abs(expected.durationMs - itemDurationMs);
      if (durationDiff > Math.max(10000, expected.durationMs * 0.12)) continue;
    }

    const candidateArtist = normalizeText(getCandidateArtistText(item.artist));
    let score;

    if (expected.artists.length === 0) {
      // 原曲无歌手信息，歌名匹配即可
      score = 2;
    } else if (!candidateArtist) {
      // 候选缺少歌手信息：保留为低优先级候选
      score = 1;
    } else {
      const artistMatched = expected.artists.some(function (name) {
        const normalized = normalizeText(name);
        return (
          !!normalized &&
          (candidateArtist.includes(normalized) || normalized.includes(candidateArtist))
        );
      });
      // 有歌手信息但对不上 → 拒绝
      if (!artistMatched) continue;
      score = 3;
    }

    // 变体强降权：Live / 翻唱 / 伴奏 / Remix / DJ 版等不能优先于原曲。
    //（2026-09-21 实测：GD 接口不返回 duration → 时长校验失效 → 选中了
    //  「Take Me To Your Heart (Live)」，音频 221.9s vs 期望 238.8s，
    //  表现为"歌词前半对得上、后面全飘"）
    if (VARIANT_NAME_RE.test(String(item.name || ''))) score -= 2;

    // 时长接近度：连续打分，让「最接近原曲时长」的候选胜出。
    // 原实现只按 1/2/3 分级，同分时是「搜索结果里排最前的那个」胜出 ——
    // 候选里常混有翻唱/DJ 版，排在原版前面就会被选中（2026-09-20「明天天明」实测）。
    if (expected.durationMs > 0 && itemDurationMs > 0) {
      score += Math.max(0, 1 - Math.abs(expected.durationMs - itemDurationMs) / DURATION_PROXIMITY_MS);
    }

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

/**
 * 在指定音源搜索歌曲并获取 URL
 * @param {string} source - 音源 (netease, joox)
 * @param {string} searchQuery - 搜索关键词
 * @param {{ name: string, artists: string[] }} expected - 原曲信息
 * @param {string} quality - 音质
 * @returns {Promise<{url: string, br: string, size: number, source: string} | null>}
 */
async function searchAndGetUrl(source, searchQuery, expected, quality) {
  // 1. 搜索歌曲（取前5条做校验）
  const searchUrl =
    BASE_URL +
    '?types=search&source=' +
    source +
    '&name=' +
    encodeURIComponent(searchQuery) +
    '&count=5&pages=1';

  const searchResponse = await axios.get(searchUrl, { timeout: 8000 });

  if (
    searchResponse.data &&
    Array.isArray(searchResponse.data) &&
    searchResponse.data.length > 0
  ) {
    const matchedResult = pickBestCandidate(searchResponse.data, expected, source);
    if (!matchedResult) {
      console.log('[GDMusic]', source, '搜索结果与原曲不匹配，已拒绝（避免货不对版）');
      return null;
    }

    const trackId = matchedResult.id;
    const trackSource = matchedResult.source || source;

    // 2. 获取歌曲 URL
    const songUrl =
      BASE_URL +
      '?types=url&source=' +
      trackSource +
      '&id=' +
      trackId +
      '&br=' +
      quality;

    const songResponse = await axios.get(songUrl, { timeout: 8000 });

    if (songResponse.data && songResponse.data.url) {
      return {
        url: songResponse.data.url,
        br: String(songResponse.data.br || ''),
        size: songResponse.data.size || 0,
        source: trackSource
      };
    } else {
      console.log('[GDMusic]', trackSource, '未返回有效 URL');
      return null;
    }
  } else {
    console.log('[GDMusic]', source, '搜索结果为空');
    return null;
  }
}

/**
 * 从 GD 音乐台解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.quality] - 音质，默认 '999'
 * @param {number} [params.timeout] - 超时时间(ms)，默认 15000
 * @returns {Promise<{url: string, br: number, size: number, source: string} | null>}
 */
async function parseFromGDMusic(params) {
  const { id, name, artists, quality = '999', timeout = 15000 } = params;

  const artistNames = (artists || []).join(' ');
  const searchQuery = (name + ' ' + artistNames).trim();

  if (!searchQuery || searchQuery.length < 2) {
    console.error('[GDMusic] 搜索查询过短:', { name: name, artists: artistNames });
    return null;
  }

  const expected = {
    name: name || '',
    artists: artists || [],
    durationMs: Number(params.duration) || 0,  // 时长硬校验用（候选偏差过大即拒绝）
    // 网易云子源专用：目标歌曲 id。候选 id 与之相同即同一首（最强匹配信号）
    targetId: id == null ? '' : String(id)
  };

  // 超时兜底（主流程完成时清 timer，避免成功后仍残留"超时"假日志）
  let timeoutTimer = null;
  const timeoutPromise = new Promise(function (resolve) {
    timeoutTimer = setTimeout(function () {
      console.warn('[GDMusic] 解析超时(' + timeout + 'ms)');
      resolve(null);
    }, timeout);
  });

  // 子音源顺序（对齐 Bhands_Web，实测 2026-09-10 / 30 首样本）：
  //  - netease：成功率 100%、时长正确率 100%、FLAC ~1336k ← 最优，放最前
  //  - joox   ：成功率 ~20%、命中时为 FLAC（~1484k），仅作兜底
  //  - tidal  ：实测 0/20 全部失败，已移除（保留只会白白消耗超时预算）
  const allSources = ['netease', 'joox'];

  try {
    const result = await Promise.race([
      (async function () {
        console.log('[GDMusic] 开始搜索:', searchQuery);

        // 依次尝试所有音源
        for (const source of allSources) {
          try {
            const result = await searchAndGetUrl(source, searchQuery, expected, quality);
            if (result) {
              console.log('[GDMusic] 成功通过 ' + result.source + ' 解析音乐!');
              return {
                url: result.url.replace(/\\/g, ''),
                br: parseInt(result.br, 10) * 1000 || 320000,
                size: result.size || 0,
                source: 'gdmusic-' + result.source
              };
            }
          } catch (error) {
            console.error('[GDMusic]', source, '音源解析失败:', error.message);
            continue;
          }
        }

        console.log('[GDMusic] 所有音源均解析失败');
        return null;
      })(),
      timeoutPromise
    ]);
    if (timeoutTimer) clearTimeout(timeoutTimer);  // 主流程已完成（无论成败），清掉兜底 timer
    return result;
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    console.error('[GDMusic] 解析异常:', error.message);
    return null;
  }
}

module.exports = { parseFromGDMusic };
