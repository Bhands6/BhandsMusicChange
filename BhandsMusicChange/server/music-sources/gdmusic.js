'use strict';

/**
 * GD音乐台解析服务
 * 通过 https://music-api.gdstudio.xyz 搜索并获取音乐 URL
 */

const axios = require('axios');

const BASE_URL = 'https://music-api.gdstudio.xyz/api.php';

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
  return expected === candidate || candidate.includes(expected) || expected.includes(candidate);
}

/**
 * 从候选中挑选与原曲匹配的结果
 * 校验策略：歌名必须匹配；候选带歌手信息时歌手也必须匹配，
 * 宁可解析失败也不返回错误的歌（防止"货不对版"）
 */
function pickBestCandidate(candidates, expected) {
  let best = null;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || !item.id) continue;
    if (!isNameMatched(expected.name, item.name || '')) continue;

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

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

/**
 * 在指定音源搜索歌曲并获取 URL
 * @param {string} source - 音源 (joox, tidal, netease)
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
    const matchedResult = pickBestCandidate(searchResponse.data, expected);
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
    artists: artists || []
  };

  // 超时兜底
  const timeoutPromise = new Promise(function (resolve) {
    setTimeout(function () {
      console.warn('[GDMusic] 解析超时(' + timeout + 'ms)');
      resolve(null);
    }, timeout);
  });

  // 所有可用的音源
  const allSources = ['joox', 'tidal', 'netease'];

  try {
    return await Promise.race([
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
  } catch (error) {
    console.error('[GDMusic] 解析异常:', error.message);
    return null;
  }
}

module.exports = { parseFromGDMusic };
