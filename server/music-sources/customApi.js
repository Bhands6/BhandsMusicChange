'use strict';

/**
 * 自定义 API 解析服务
 * 支持用户配置的第三方音乐解析 API 端点
 *
 * 支持的 API 格式：
 * 1. 标准格式: GET {apiUrl}?id={songId}&quality={quality}
 *    返回: { url: "...", br: 320000 }
 *
 * 2. 搜索格式: GET {apiUrl}?types=search&name={name}&artist={artist}
 *    然后: GET {apiUrl}?types=url&id={resultId}
 *
 * 3. 完整格式: POST {apiUrl}
 *    Body: { id, name, artist, album, quality }
 *    返回: { code: 200, data: { url: "..." } }
 */

const axios = require('axios');

/**
 * 适配不同格式的 API 返回结果
 * @param {*} result - API 返回数据
 * @returns {{url: string, br: number} | null}
 */
function adaptResult(result) {
  if (!result) return null;

  // 标准格式: { url: "...", br: 320000 }
  if (result.url && typeof result.url === 'string') {
    return {
      url: result.url,
      br: result.br || 320000
    };
  }

  // 嵌套格式: { data: { url: "..." } }
  if (result.data && result.data.url) {
    return {
      url: result.data.url,
      br: result.data.br || 320000
    };
  }

  // code + data 格式: { code: 200, data: { url: "..." } }
  if (result.code === 200 && result.data) {
    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    if (data && data.url) {
      return {
        url: data.url,
        br: data.br || 320000
      };
    }
  }

  // 数组格式: [{ url: "..." }]
  if (Array.isArray(result) && result.length > 0 && result[0].url) {
    return {
      url: result[0].url,
      br: result[0].br || 320000
    };
  }

  return null;
}

/**
 * 使用自定义 API 解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.album] - 专辑名称
 * @param {string} [params.quality] - 音质
 * @param {string} params.apiUrl - 自定义 API 地址
 * @param {string} [params.apiMethod] - 请求方法 (GET/POST)
 * @param {number} [params.timeout] - 超时时间(ms)
 * @returns {Promise<{url: string, br: number} | null>}
 */
async function parseFromCustomApi(params) {
  const {
    id,
    name,
    artists,
    album = '',
    quality = 'higher',
    apiUrl,
    apiMethod = 'GET',
    timeout = 15000
  } = params;

  if (!apiUrl) {
    console.log('[CustomApi] 未配置 API 地址');
    return null;
  }

  const artistStr = (artists || []).join(' ');

  console.log('[CustomApi] 使用自定义 API 解析:', apiUrl);

  try {
    let result;

    if (apiMethod.toUpperCase() === 'POST') {
      // POST 方式：发送完整歌曲信息
      const response = await axios.post(
        apiUrl,
        {
          id: id,
          name: name || '',
          artist: artistStr,
          album: album,
          quality: quality
        },
        { timeout: timeout }
      );
      result = response.data;
    } else {
      // GET 方式：通过查询参数传递
      const separator = apiUrl.includes('?') ? '&' : '?';
      const requestUrl =
        apiUrl +
        separator +
        'id=' + encodeURIComponent(id) +
        '&name=' + encodeURIComponent(name || '') +
        '&artist=' + encodeURIComponent(artistStr) +
        '&quality=' + encodeURIComponent(quality);

      const response = await axios.get(requestUrl, { timeout: timeout });
      result = response.data;
    }

    const adapted = adaptResult(result);
    if (adapted && adapted.url) {
      console.log('[CustomApi] 解析成功');
      return adapted;
    }

    console.warn('[CustomApi] API 返回数据无法解析:', typeof result);
    return null;
  } catch (error) {
    console.error('[CustomApi] 请求失败:', error.message);
    return null;
  }
}

module.exports = { parseFromCustomApi };
