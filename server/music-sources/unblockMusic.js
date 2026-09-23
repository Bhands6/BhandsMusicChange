'use strict';

/**
 * UnblockNeteaseMusic 解析服务
 * 使用 @unblockneteasemusic/server 的 match 函数从多个平台搜索匹配音乐
 */

const match = require('@unblockneteasemusic/server');

/**
 * 可用平台（对齐 Bhands_Web 实测结论）：
 *  - migu / pyncmd：实测全部返回空（0/20），保留只会白白增加失败延迟 → 移除
 *  - kugou：正确率 78%，优于 kuwo（21%），故 kugou 在前
 *  - kuwo：成功率尚可但错配率高，作最后兜底
 */
const ALL_PLATFORMS = ['kugou', 'kuwo'];

/**
 * 确保歌曲数据结构完整
 * @param {Object} data - 歌曲数据
 * @returns {Object} 处理后的歌曲数据
 */
function ensureDataStructure(data) {
  if (!data) {
    return { name: '', artists: [], album: { name: '' } };
  }

  if (data.name === undefined || data.name === null) {
    data.name = '';
  }

  if (!data.artists || !Array.isArray(data.artists)) {
    data.artists = data.ar && Array.isArray(data.ar) ? data.ar : [];
  }

  if (data.artists.length > 0) {
    data.artists = data.artists.map(function (artist) {
      return artist ? { name: artist.name || '' } : { name: '' };
    });
  }

  if (!data.album || typeof data.album !== 'object') {
    data.album = data.al && typeof data.al === 'object' ? data.al : { name: '' };
  }

  if (!data.album.name) {
    data.album.name = '';
  }

  return data;
}

/**
 * 使用 UnblockNeteaseMusic 解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.album] - 专辑名称
 * @param {string[]} [params.enabledPlatforms] - 启用的平台列表
 * @param {number} [params.retryCount] - 重试次数
 * @returns {Promise<{url: string, br: number, size: number, platform: string} | null>}
 */
async function parseFromUnblockMusic(params) {
  const {
    id,
    name,
    artists,
    album = '',
    enabledPlatforms,
    retryCount = 1
  } = params;

  // 过滤平台，确保只包含已知平台
  const platforms = enabledPlatforms
    ? enabledPlatforms.filter(function (p) { return ALL_PLATFORMS.includes(p); })
    : ALL_PLATFORMS;

  if (platforms.length === 0) {
    console.log('[UnblockMusic] 没有可用的平台');
    return null;
  }

  // 构造歌曲数据
  const songData = ensureDataStructure({
    name: name || '',
    artists: (artists || []).map(function (a) { return { name: a }; }),
    album: { name: album || '' }
  });

  console.log('[UnblockMusic] 开始解析, ID:', id, '平台:', platforms);

  async function attempt(attemptNum) {
    try {
      const data = await match(parseInt(String(id), 10), platforms, songData);
      if (data && data.url) {
        // ⚠️ platform 缺失 = unblock 内部没走到任何 provider，返回的是兜底资源。
        // 2026-09-23 实测：三首完全不同的歌（杨乃文「推开世界的门」/ 承桓「座位」/
        // 周杰伦「晴天」）全部返回**同一个** kuwo 资源 M5000004Gmy54cGDqK
        //（185336B ≈ 11s 试听垫片，即 durationProbe 注释里那个 185KB 垫片），
        // platform 一律是 undefined。这类结果必然被上游 isHardRejected 丢掉，
        // 但日志会打印「解析成功」造成误判，所以这里直接判失败，
        // 让它走正常的失败缓存 / 冷却路径。
        if (!data.platform) {
          console.warn('[UnblockMusic] 返回结果缺少 platform（未走到任何 provider），判定失败');
          return null;
        }
        console.log('[UnblockMusic] 解析成功, 平台:', data.platform);
        return {
          url: data.url,
          br: data.br || 320000,
          size: data.size || 0,
          platform: data.platform
        };
      }
      return null;
    } catch (err) {
      if (attemptNum < retryCount) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 200 * attemptNum);
        });
        return attempt(attemptNum + 1);
      }
      throw err;
    }
  }

  try {
    return await attempt(1);
  } catch (err) {
    console.error('[UnblockMusic] 解析失败:', err.message);
    return null;
  }
}

module.exports = { parseFromUnblockMusic, ALL_PLATFORMS };
