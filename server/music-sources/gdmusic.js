'use strict';

/**
 * GD音乐台解析服务
 * 通过 https://music-api.gdstudio.xyz 搜索并获取音乐 URL
 */

const axios = require('axios');
const { isCandidateDurationPlausible } = require('./durationProbe');

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
const VARIANT_NAME_RE = /[(（【\[][^\)）\]]*(live|现场|演唱会|翻唱|cover|伴奏|remix|dj|混音|铃声|试听|纯音乐|acoustic|instrumental|karaoke|demo|翻录|重制|remaster|架子鼓|钢琴|吉他|古筝|小提琴|八音盒|口琴|尤克里里|纯享|重置|女声|男声|童声|合唱|对唱)[^\)）\]]*[)）\]]/i;

/**
 * 候选名的括号后缀在原曲名里不存在 → 判为变体。
 *
 * 词表式 VARIANT_NAME_RE 永远补不全（「座位 (架子鼓版)」这种乐器改编版就是漏网的，
 * 2026-09-23 实测它被选中后白拿了一次播放地址），所以再加一层通用兜底：
 * 「后缀是否为原曲名的一部分」——
 *   原曲「座位」      vs 候选「座位 (架子鼓版)」→ 后缀不在原名里 → 变体
 *   原曲「晴天 (Live)」vs 候选「晴天 (Live)」   → 后缀在原名里   → 非变体
 * 用**原始**歌名比对（normalizeText 会把括号整段删掉，比不出来）。
 */
function hasUnmatchedVariantSuffix(expectedName, candidateName) {
  const segs = String(candidateName || '').match(/[（(【\[]([^)）】\]]*)[)）】\]]/g);
  if (!segs || !segs.length) return false;
  const expectedRaw = String(expectedName || '').toLowerCase();
  return segs.some(function (seg) {
    const inner = seg.replace(/[（(【\[\])）】\]]/g, '').trim().toLowerCase();
    if (!inner) return false;
    return expectedRaw.indexOf(inner) < 0;
  });
}

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
/**
 * 拆开聚合形态的歌手串。
 *
 * 同一首歌的歌手列表，网易云给的是「杨宗纬 / 杨旭 / 于冬然 / 范甲君」（斜杠），
 * 其它平台可能给「杨宗纬、杨旭、于冬然、范甲君」（顿号）—— 而 `normalizeText` 的
 * 清理字符集里**没有**斜杠和顿号，整串比对必然失败（2026-09-23「其实都没有」
 * 在 kugou 侧即因此把正确版本拒掉）。拆成单个歌手后逐个比对。
 */
function splitArtistNames(raw) {
  return String(raw || '')
    .split(/[\/、;；,，&＆|·]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

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

    // 时长硬校验：容差 max(8s, 6%)，比下游 durationProbe 的 max(5s, 4%) 宽 2 个百分点
    //（原来是 max(10s, 12%)，会放过差十几秒的变体，白拿一次播放地址再被外层拒）。
    // ⚠ 实测 GD 接口的 search 返回**不含 duration 字段**，所以对 netease/joox 这条基本不生效，
    //   真正的兜底是 ② 的变体降权 和下游 durationProbe 的真实音频时长校验。
    const itemDurationMs = (Number(item.duration) || 0) * 1000;
    if (!isCandidateDurationPlausible(itemDurationMs, expected.durationMs)) continue;

    const candidateArtists = splitArtistNames(getCandidateArtistText(item.artist));
    let score;

    if (expected.artists.length === 0) {
      // 原曲无歌手信息，歌名匹配即可
      score = 2;
    } else if (!candidateArtists.length) {
      // 候选缺少歌手信息：保留为低优先级候选
      score = 1;
    } else {
      // 双方都拆成单个歌手后逐个比对（分隔符不一致见 splitArtistNames 注释）
      const artistMatched = expected.artists.some(function (name) {
        return splitArtistNames(name).some(function (expectName) {
          const normalized = normalizeText(expectName);
          if (!normalized) return false;
          return candidateArtists.some(function (candidateName) {
            const candidateNorm = normalizeText(candidateName);
            return (
              !!candidateNorm &&
              (candidateNorm.includes(normalized) || normalized.includes(candidateNorm))
            );
          });
        });
      });
      // 有歌手信息但对不上 → 拒绝
      if (!artistMatched) continue;
      score = 3;
    }

    // 变体强降权：Live / 翻唱 / 伴奏 / Remix / DJ 版 / 乐器改编版等不能优先于原曲。
    //（2026-09-21 实测：GD 接口不返回 duration → 时长校验失效 → 选中了
    //  「Take Me To Your Heart (Live)」，音频 221.9s vs 期望 238.8s，
    //  表现为"歌词前半对得上、后面全飘"）
    // ⚠ 但「时长与期望高度吻合」的变体要豁免 —— 那说明原曲本身就是该变体
    //（2026-09-23 kugou 侧「其实都没有」：歌名不带 Live，实际是 4 人 Live 版）。
    const isVariantName = VARIANT_NAME_RE.test(String(item.name || '')) ||
      hasUnmatchedVariantSuffix(expected.name, item.name);
    const variantDurationMatches = expected.durationMs > 0 && itemDurationMs > 0 &&
      Math.abs(expected.durationMs - itemDurationMs) <= Math.max(2000, expected.durationMs * 0.02);
    if (isVariantName && !variantDurationMatches) score -= 2;

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
