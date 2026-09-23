/* ==================== DJ 节拍分析器 ==================== */
/* 用于播客/音乐的离线节拍检测，生成节拍映射供桌面歌词和视觉效果使用 */

/** 默认 User-Agent，模拟 Chrome 浏览器请求 */
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** 全流高质量分析的时长上限（秒），超过此值使用采样分析 */
const FULL_STREAM_QUALITY_LIMIT_SEC = 7200;

/* ==================== 工具函数 ==================== */

/**
 * 将值钳制到 [0, 1] 范围
 * @param {number} v - 输入值
 * @returns {number} 钳制后的值
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

/**
 * 将值钳制到 [min, max] 范围
 * @param {number} v - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 钳制后的值
 */
function clampRange(v, min, max) {
  v = Number(v) || 0;
  return Math.max(min, Math.min(max, v));
}

/**
 * 计算百分位数 - 用于统计分析能量分布
 * @param {Array} arr - 数据数组
 * @param {number} p - 百分位 (0-1)
 * @param {number} maxSamples - 最大采样数，超出则降采样以提高性能
 * @returns {number} 百分位对应的值
 */
function percentile(arr, p, maxSamples) {
  const len = arr ? arr.length : 0;
  if (!len) return 0.001;
  maxSamples = maxSamples || 16000;
  let sample;
  if (len <= maxSamples) {
    sample = Array.prototype.slice.call(arr);
  } else {
    /* 降采样：均匀抽取 maxSamples 个样本 */
    sample = new Array(maxSamples);
    const step = (len - 1) / (maxSamples - 1);
    for (let i = 0; i < maxSamples; i++) sample[i] = arr[Math.min(len - 1, Math.floor(i * step))] || 0;
  }
  sample.sort((a, b) => a - b);
  return sample[Math.max(0, Math.min(sample.length - 1, Math.floor(sample.length * p)))] || 0.001;
}

/**
 * 计算中位数
 * @param {Array} vals - 数值数组
 * @returns {number} 中位数
 */
function median(vals) {
  vals = vals.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
}

/* ==================== IIR 双二阶滤波器 (Biquad Filter) ==================== */
/* 用于音频信号的频率分离：高通滤除低频噪声，低通提取低频能量（底鼓/节拍） */

/**
 * 创建双二阶滤波器系数
 * 基于 Audio EQ Cookbook 的标准实现
 * @param {string} type - 滤波器类型：'highpass'（高通）或 'lowpass'（低通）
 * @param {number} freq - 截止频率 (Hz)
 * @param {number} q - 品质因子（控制谐振宽度）
 * @param {number} sr - 采样率 (Hz)
 * @returns {object} 滤波器状态对象，包含系数和延迟缓冲
 */
function makeBiquad(type, freq, q, sr) {
  freq = Math.max(8, Math.min(freq, sr * 0.45));  // 限制在奈奎斯特频率内
  const w0 = 2 * Math.PI * freq / sr;             // 归一化角频率
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * (q || 0.707));          // 带宽参数
  let b0, b1, b2;

  /* 计算滤波器系数 */
  if (type === 'highpass') {
    /* 高通滤波器：保留高频，衰减低频 */
    b0 = (1 + cos) * 0.5;
    b1 = -(1 + cos);
    b2 = (1 + cos) * 0.5;
  } else {
    /* 低通滤波器：保留低频，衰减高频 */
    b0 = (1 - cos) * 0.5;
    b1 = 1 - cos;
    b2 = (1 - cos) * 0.5;
  }

  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const inv = 1 / a0;  // 归一化系数

  /* 返回滤波器状态：系数 + 延迟线（x1/x2 输入历史，y1/y2 输出历史） */
  return { b0: b0 * inv, b1: b1 * inv, b2: b2 * inv, a1: a1 * inv, a2: a2 * inv, x1: 0, x2: 0, y1: 0, y2: 0 };
}

/**
 * 运行双二阶滤波器（处理单个样本）
 * 差分方程: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
 * @param {object} st - 滤波器状态
 * @param {number} x - 输入样本
 * @returns {number} 滤波后的输出样本
 */
function runBiquad(st, x) {
  const y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2;
  st.x2 = st.x1;  // 更新输入延迟线
  st.x1 = x;
  st.y2 = st.y1;  // 更新输出延迟线
  st.y1 = y;
  return y;
}

/* ==================== 核心节拍映射构建 ==================== */

/**
 * 从低频能量和高频能量数据构建节拍映射
 * 这是节拍检测的核心算法，流程：
 * 1. 计算 onset（起音）信号 - 检测能量突变
 * 2. 峰值检测 - 找到候选节拍点
 * 3. 估计节拍间隔（step）
 * 4. 对齐到网格 - 生成规律的节拍序列
 * 5. 分类和标记 - downbeat/push/drop/rebound 等组合类型
 *
 * @param {Float32Array} lowEnergy - 低频能量序列（32-178Hz，底鼓频段）
 * @param {Float32Array} hitEnergy - 高频峰值能量序列（瞬态检测）
 * @param {number} hopSec - 每帧的时间步长（秒）
 * @param {number} durationSec - 音频总时长（秒）
 * @returns {object} 节拍映射对象，包含 beats/cameraBeats/pulseBeats 等
 */
function buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, hopSec, durationSec) {
  const nFrames = Math.min(lowEnergy.length, hitEnergy.length);

  /* 帧数不足时返回空映射 */
  if (nFrames < 20) {
    return {
      kicks: [],
      beats: [],
      pulseBeats: [],
      cameraBeats: [],
      duration: durationSec || 0,
      visualBeatCount: 0,
      tempoSource: 'podcast-dj-server-empty',
      analyzedAt: Date.now(),
    };
  }

  /**
   * 获取能量数组在指定位置的平滑值（3点加权平均）
   * @param {Float32Array} arr - 能量数组
   * @param {number} idx - 索引位置
   * @returns {number} 平滑后的能量值
   */
  function bandAt(arr, idx) {
    idx = Math.max(0, Math.min(nFrames - 1, idx | 0));
    const a = arr[Math.max(0, idx - 1)] || 0;
    const b = arr[idx] || 0;
    const c = arr[Math.min(nFrames - 1, idx + 1)] || 0;
    return (a + b * 2 + c) * 0.25;  // 加权平均：前后各 0.25，中间 0.5
  }

  /* 计算能量分布的统计阈值（百分位数） */
  const lowFloor = Math.max(0.0004, percentile(lowEnergy, 0.22));  // 低频底噪
  const lowMid = Math.max(lowFloor + 0.0002, percentile(lowEnergy, 0.58));   // 低频中位
  const lowRef = Math.max(lowMid + 0.0002, percentile(lowEnergy, 0.86));    // 低频参考值
  const lowCeil = Math.max(lowRef + 0.0004, percentile(lowEnergy, 0.96));   // 低频上限
  const hitRef = Math.max(0.0004, percentile(hitEnergy, 0.86));     // 高频参考值

  /* ==================== 起音检测 (Onset Detection) ==================== */
  /* onset 信号反映能量的瞬时变化率，用于定位节拍发生的时间点 */
  const onset = new Float32Array(nFrames);
  for (let i = 4; i < nFrames; i++) {
    /* 低频突变：当前帧 vs 前几帧的加权平均 */
    const prev = lowEnergy[i - 1] * 0.62 + lowEnergy[i - 2] * 0.28 + lowEnergy[i - 3] * 0.10;
    const lowRise = Math.max(0, lowEnergy[i] - prev);
    /* 宽带突变：两帧窗口的差异 */
    const wideRise = Math.max(0, (lowEnergy[i] + lowEnergy[i - 1]) * 0.5 - (lowEnergy[i - 3] + lowEnergy[i - 4]) * 0.5);
    /* 高频峰值突变：瞬态检测 */
    const peakRise = Math.max(0, hitEnergy[i] - hitEnergy[i - 2] * 0.84);
    /* 加权组合三个特征 */
    onset[i] = lowRise * 1.72 + wideRise * 0.86 + peakRise * 0.10;
  }

  /* ==================== 峰值检测 ==================== */
  /* 使用滑动窗口自适应阈值检测 onset 信号中的峰值 */
  const winN = Math.max(52, Math.round(0.82 / hopSec));      // 滑动窗口大小（约 0.82 秒）
  const minFrameGap = Math.max(18, Math.round(0.215 / hopSec));  // 最小帧间距（约 0.215 秒，防止过密）
  const candidates = [];  // 候选节拍点

  /* 初始化滑动窗口统计量 */
  let sumO = 0;   // onset 值的累加和
  let sqO = 0;    // onset 值的平方和（用于计算标准差）
  for (let i = 0; i < winN; i++) {
    const o = onset[i] || 0;
    sumO += o;
    sqO += o * o;
  }

  /* 滑动窗口遍历，检测峰值 */
  for (let f = winN + 4; f < nFrames - 4; f++) {
    const mean = sumO / winN;                                                    // 窗口均值
    const std = Math.sqrt(Math.max(0, sqO / winN - mean * mean));               // 窗口标准差
    const th = mean + std * 1.66 + lowRef * 0.0038;                             // 自适应阈值 = 均值 + 1.66σ + 基础偏移
    const o = onset[f];

    /* 检测局部峰值：超过阈值且是局部最大值 */
    if (o > th && o >= onset[f - 1] && o > onset[f + 1]) {
      /* 在小范围内寻找精确峰值位置 */
      let peakF = f;
      let peakScore = o + lowEnergy[f] * 0.10;
      for (let pf = f - 2; pf <= f + 3; pf++) {
        const ps = (onset[pf] || 0) + (lowEnergy[pf] || 0) * 0.10;
        if (ps > peakScore) {
          peakScore = ps;
          peakF = pf;
        }
      }

      /* 计算候选点的特征值 */
      const lowTone = Math.min(2.6, bandAt(lowEnergy, peakF) / lowRef);   // 低频强度（相对于参考值）
      const hitTone = Math.min(2.6, bandAt(hitEnergy, peakF) / hitRef);   // 高频强度
      const lowRel = clamp01((bandAt(lowEnergy, peakF) - lowFloor) / Math.max(0.0001, lowCeil - lowFloor));  // 低频相对位置
      const score = (o - th) / Math.max(0.0006, std + mean * 0.38 + lowRef * 0.012);  // 超阈值强度

      /* 过滤：得分足够高且至少有一个频段能量明显 */
      if (score > 0.16 && (lowTone > 0.32 || lowRel > 0.22 || hitTone > 0.52)) {
        const cand = {
          frame: peakF,
          time: peakF * hopSec,
          score,
          lowTone,
          hitTone,
          lowRel,
          raw: o,
        };
        /* 计算综合权重 - 结合得分、低频、高频、相对位置 */
        cand.power = cand.score * 0.56 + Math.pow(clamp01((cand.lowTone - 0.22) / 1.42), 0.82) * 0.34 + Math.min(1.5, cand.hitTone) * 0.08 + cand.lowRel * 0.10;

        /* 去重：如果与上一个候选点太近，保留更强的 */
        const last = candidates[candidates.length - 1];
        if (last && cand.frame - last.frame < minFrameGap) {
          if (cand.power > last.power) candidates[candidates.length - 1] = cand;
        } else {
          candidates.push(cand);
        }
      }
    }

    /* 更新滑动窗口统计量（增量方式） */
    const old = onset[f - winN] || 0;
    const next = onset[f] || 0;
    sumO += next - old;
    sqO += next * next - old * old;
  }

  /* 没有候选点则返回空映射 */
  if (!candidates.length) {
    return {
      kicks: [],
      beats: [],
      pulseBeats: [],
      cameraBeats: [],
      duration: durationSec || nFrames * hopSec,
      visualBeatCount: 0,
      tempoSource: 'podcast-dj-server-empty',
      analyzedAt: Date.now(),
    };
  }

  /* ==================== 候选点筛选 ==================== */
  /* 根据权重分布筛选出强节拍点，用于后续节拍间隔估计 */
  const powers = candidates.map(c => c.power);
  const p30 = percentile(powers, 0.30);   // 30% 分位
  const p50 = percentile(powers, 0.50);   // 中位数
  const p90 = Math.max(p50 + 0.001, percentile(powers, 0.90));
  const p96 = Math.max(p90 + 0.001, percentile(powers, 0.965));
  /* 强节拍：权重 >= 中位数 且 低频明显 */
  let strong = candidates.filter(c => c.power >= p50 && c.lowTone > 0.34);
  if (strong.length < 16) strong = candidates.slice();  // 不够则用全部

  /* ==================== 节拍间隔估计 ==================== */
  /**
   * 通过直方图分析估计节拍间隔（step）
   * 计算所有候选点对之间的时间间隔，找到最频繁的间隔值
   * @param {Array} list - 候选节拍点数组
   * @returns {number} 估计的节拍间隔（秒），0 表示无法估计
   */
  function estimateStep(list) {
    if (!list || list.length < 3) return 0;
    const bin = 0.006;     // 直方图 bin 宽度（6ms）
    const hist = {};       // 间隔直方图
    const medGaps = [];    // 所有有效间隔（用于中位数回退）

    /* 遍历所有候选点对，计算时间间隔 */
    for (let ai = 0; ai < list.length; ai++) {
      for (let bi = ai + 1; bi < list.length && bi < ai + 10; bi++) {
        const rawGap = list[bi].time - list[ai].time;
        if (rawGap < 0.24) continue;   // 太短，跳过
        if (rawGap > 2.55) break;      // 太长，跳出内层循环

        /* 考虑间隔可能是 step 的整数倍（1-6倍） */
        for (let div = 1; div <= 6; div++) {
          const g = rawGap / div;
          if (g < 0.31) break;         // 间隔太短
          if (g > 0.86) continue;      // 间隔太长
          /* 权重：两个候选点的权重几何平均，除以距离的平方根 */
          const weight = Math.sqrt(Math.max(0.001, list[ai].power * list[bi].power)) / Math.sqrt((bi - ai) * div);
          const key = Math.round(g / bin);
          hist[key] = (hist[key] || 0) + weight;
          medGaps.push(g);
        }
      }
    }

    /* 找到直方图的峰值（考虑相邻 bin 的平滑） */
    let bestKey = null;
    let bestScore = 0;
    Object.keys(hist).forEach(k => {
      const key = parseInt(k, 10);
      const score = (hist[key] || 0) + (hist[key - 1] || 0) * 0.72 + (hist[key + 1] || 0) * 0.72;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    });

    if (bestKey != null) return bestKey * bin;  // 返回直方图峰值对应的间隔
    return median(medGaps);                      // 回退到中位数
  }

  /* 估计全局节拍间隔，钳制到合理范围 [0.32, 0.86] 秒（约 70-188 BPM） */
  let globalStep = estimateStep(strong) || estimateStep(candidates) || 0.50;
  globalStep = clampRange(globalStep, 0.32, 0.86);

  /* ==================== 网格对齐 ==================== */

  /**
   * 在候选点中找到距离目标时间最近的点
   * @param {number} center - 目标时间
   * @param {number} windowSec - 搜索窗口大小
   * @param {number} startIdx - 起始搜索索引（优化用）
   * @returns {object|null} 最近的候选点
   */
  function nearestCandidate(center, windowSec, startIdx) {
    let best = null;
    let bestScore = -Infinity;
    let j = startIdx || 0;
    /* 跳过窗口之前的候选点 */
    while (j < candidates.length && candidates[j].time < center - windowSec) j++;
    /* 在窗口内寻找最佳匹配 */
    for (let ni = j; ni < candidates.length && candidates[ni].time <= center + windowSec; ni++) {
      const dist = Math.abs(candidates[ni].time - center);
      const score = candidates[ni].power * (1 - dist / Math.max(0.001, windowSec) * 0.42);  // 距离惩罚
      if (score > bestScore) {
        best = candidates[ni];
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * 评估某个相位（anchor + step）的匹配得分
   * @param {number} anchorTime - 锚点时间
   * @param {number} step - 节拍间隔
   * @returns {number} 匹配得分
   */
  function scorePhase(anchorTime, step) {
    let start = anchorTime;
    /* 向前扩展到网格起点 */
    while (start - step > 0.05) start -= step;
    const end = Math.min(durationSec || nFrames * hopSec, 180);  // 最多分析前 3 分钟
    const win = Math.max(0.055, Math.min(0.125, step * 0.18));   // 匹配窗口
    let score = 0;
    let count = 0;
    let cursor = 0;

    /* 遍历每个网格点，评估与候选点的匹配度 */
    for (let gt = start; gt < end; gt += step) {
      while (cursor < candidates.length && candidates[cursor].time < gt - win) cursor++;
      let bestScore = 0;
      for (let pi = cursor; pi < candidates.length && candidates[pi].time <= gt + win; pi++) {
        const dist = Math.abs(candidates[pi].time - gt);
        const s = candidates[pi].power * (1 - dist / win * 0.44);
        if (s > bestScore) bestScore = s;
      }
      /* 无匹配的网格点给予负分惩罚 */
      score += bestScore ? bestScore : -p30 * 0.08;
      count++;
    }
    return count ? score / count : -Infinity;
  }

  /* 找到最佳锚点（网格起始时间） */
  let phaseSource = strong.filter(c => c.time < Math.min(durationSec || nFrames * hopSec, 180)).slice(0, 72);
  if (!phaseSource.length) phaseSource = strong.slice(0, 1);
  let bestAnchor = phaseSource[0] ? phaseSource[0].time : 0;
  let bestAnchorScore = -Infinity;

  /* 遍历候选锚点，选择得分最高的 */
  for (let i = 0; i < phaseSource.length; i++) {
    const score = scorePhase(phaseSource[i].time, globalStep);
    if (score > bestAnchorScore) {
      bestAnchorScore = score;
      bestAnchor = phaseSource[i].time;
    }
  }

  /* 检查半步间隔是否更好（处理切分拍的情况） */
  const halfStep = globalStep * 0.5;
  if (halfStep >= 0.31) {
    const halfScore = scorePhase(bestAnchor, halfStep);
    if (halfScore > bestAnchorScore * 1.04) globalStep = halfStep;  // 半步得分高 4% 以上则采用
  }

  /* 将锚点对齐到网格起点 */
  let anchor = bestAnchor;
  while (anchor - globalStep > 0.05) anchor -= globalStep;

  /* ==================== 分段节拍间隔 ==================== */
  /* 长音频可能有 tempo 变化，分段估计节拍间隔并平滑过渡 */
  const duration = durationSec || nFrames * hopSec;
  const sectionLen = duration > 3600 ? 96 : 72;  // 每段时长（秒），超 1 小时用 96 秒
  const sectionCount = Math.max(1, Math.ceil(duration / sectionLen));
  const sectionSteps = [];  // 每段的节拍间隔

  for (let si = 0; si < sectionCount; si++) {
    const t0 = si * sectionLen;
    const t1 = Math.min(duration, t0 + sectionLen);
    const seg = strong.filter(c => c.time >= t0 && c.time < t1);
    const prevStep = sectionSteps.length ? sectionSteps[sectionSteps.length - 1] : globalStep;
    let localStep = estimateStep(seg) || prevStep || globalStep;

    /* 限制局部变化幅度，防止突变 */
    if (prevStep) localStep = clampRange(localStep, prevStep * 0.94, prevStep * 1.06);   // ±6%
    if (globalStep) localStep = clampRange(localStep, globalStep * 0.86, globalStep * 1.14);  // ±14%

    /* 平滑：30% 局部 + 70% 上一段 */
    sectionSteps.push(prevStep ? (localStep * 0.30 + prevStep * 0.70) : localStep);
  }

  /**
   * 获取指定时间点的节拍间隔
   * @param {number} time - 时间（秒）
   * @returns {number} 节拍间隔（秒）
   */
  function stepAt(time) {
    const idx = Math.max(0, Math.min(sectionSteps.length - 1, Math.floor(time / sectionLen)));
    return sectionSteps[idx] || globalStep || 0.50;
  }

  /* ==================== 节拍网格生成 ==================== */
  /* 沿时间轴生成等间隔的节拍点，每个点结合实际音频能量赋予视觉参数 */
  const beats = [];
  let gridIndex = 0;     // 网格序号（用于计算 combo 类型）
  let cursorIdx = 0;     // 候选点遍历游标

  for (let gridT = anchor; gridT < duration - 0.04;) {
    const localStep = stepAt(gridT) || globalStep || 0.50;
    const winSec = Math.max(0.060, Math.min(0.135, localStep * 0.20));  // 匹配窗口

    /* 找到最近的候选点 */
    while (cursorIdx < candidates.length && candidates[cursorIdx].time < gridT - winSec) cursorIdx++;
    const bestCand = nearestCandidate(gridT, winSec, cursorIdx);

    /* 获取网格点位置的音频能量特征 */
    const gf = Math.max(0, Math.min(nFrames - 1, Math.round(gridT / hopSec)));
    const gridLow = bandAt(lowEnergy, gf);
    const gridHit = bandAt(hitEnergy, gf);
    const gridLowTone = Math.min(2.6, gridLow / lowRef);
    const gridHitTone = Math.min(2.6, gridHit / hitRef);
    const lowTone = bestCand ? Math.max(gridLowTone * 0.62, bestCand.lowTone) : gridLowTone;
    const hitTone = bestCand ? Math.max(gridHitTone * 0.62, bestCand.hitTone) : gridHitTone;

    /* 计算综合强度指标 */
    const distPenalty = bestCand ? (1 - Math.min(1, Math.abs(bestCand.time - gridT) / winSec) * 0.26) : 0.54;  // 距离惩罚
    const basePower = bestCand ? bestCand.power * distPenalty : (gridLowTone * 0.25 + gridHitTone * 0.06);
    const powerRel = clamp01((basePower - p30 * 0.78) / Math.max(0.001, p96 - p30 * 0.78));  // 归一化权重
    const lowRel = clamp01((gridLow - lowFloor) / Math.max(0.0001, lowCeil - lowFloor));     // 低频相对强度
    const kickRel = clamp01(powerRel * 0.74 + lowRel * 0.22 + clamp01((hitTone - 0.26) / 1.70) * 0.04);  // 综合节拍强度

    /* 判断是否为弱拍（无明显能量） */
    const softGrid = (!bestCand && lowRel < 0.20) || kickRel < 0.16;

    /* ==================== Combo 类型分配 ==================== */
    /* 每 4 拍为一组：downbeat(强拍) → push(推进) → drop(下降) → rebound(反弹) */
    const slot = gridIndex % 4;
    let combo = slot === 0 ? 'downbeat' : (slot === 1 ? 'push' : (slot === 2 ? 'drop' : 'rebound'));
    if (kickRel > 0.84 && combo !== 'downbeat') combo = 'accent';  // 极强时标记为重音

    /* 计算视觉参数 */
    const visualRel = kickRel > 0.76 ? 0.76 + (kickRel - 0.76) * 0.52 : kickRel;  // 视觉强度（压缩高值）
    const downLift = combo === 'downbeat' ? (visualRel > 0.18 ? (0.016 + visualRel * 0.036) : visualRel * 0.028) : 0;  // 强拍加成
    const sectionGate = clamp01((kickRel - 0.10) / 0.58);

    /* impact（冲击力）和 strength（强度）是控制视觉效果的关键参数 */
    let impact = Math.max(0.020, Math.min(0.88, 0.022 + Math.pow(visualRel, 1.62) * 0.86 + downLift));
    let strength = Math.max(0.12, Math.min(0.93, 0.13 + Math.pow(visualRel, 1.12) * 0.68 + downLift * 0.70));

    /* 弱拍衰减 */
    if (softGrid) {
      const softMul = combo === 'downbeat' ? 0.48 : 0.30;
      impact *= softMul;
      strength *= 0.58 + sectionGate * 0.22;
    }

    /* 时间微调：将网格点向最近的候选点靠拢 */
    const timingPull = bestCand ? (0.24 + clamp01((kickRel - 0.25) / 0.65) * 0.46) : 0;  // 吸引强度
    const sourceTime = bestCand ? (gridT * (1 - timingPull) + bestCand.time * timingPull) : gridT;  // 加权时间

    /* 镜头/脉冲激活条件 */
    const cameraActive = impact >= 0.13 || (combo === 'downbeat' && kickRel >= 0.14) || (bestCand && kickRel >= 0.18);

    /* 频段混合比例（low/body/snap 控制发光的颜色分布） */
    const lowMix = Math.max(0.42, Math.min(0.90, 0.52 + visualRel * 0.32 + lowTone * 0.035 - (combo === 'accent' ? 0.10 : 0)));
    const bodyMix = Math.max(0.035, Math.min(0.54, 0.060 + visualRel * 0.12 + (combo === 'push' ? 0.18 : 0) + (combo === 'drop' ? 0.24 : 0)));
    const snapMix = Math.max(0.015, Math.min(0.62, 0.026 + (combo === 'accent' ? 0.40 : 0) + (combo === 'rebound' ? 0.08 : 0) + visualRel * 0.038));

    /* 生成节拍对象 */
    beats.push({
      time: sourceTime,       // 最终时间（经过微调）
      strength,               // 强度 (0.12-0.93)
      confidence: Math.max(0.44, Math.min(0.99, 0.46 + kickRel * 0.43 + (bestCand ? 0.08 : -0.03))),  // 置信度
      impact,                 // 冲击力 (0.020-0.88)
      primary: cameraActive,  // 是否为主节拍
      camera: cameraActive,   // 是否触发镜头效果
      pulse: impact > 0.16 || (combo === 'downbeat' && kickRel >= 0.18),  // 是否触发脉冲
      tone: 'podcast-dj-server-low-grid',
      low: lowMix,            // 低频混合比
      body: bodyMix,          // 中频混合比
      snap: snapMix,          // 高频混合比
      mass: Math.max(0.36, Math.min(0.94, lowMix * 0.72 + Math.pow(visualRel, 1.22) * 0.24)),     // 质量感
      sharpness: Math.max(0.03, Math.min(0.28, snapMix * 1.18)),   // 锐度
      combo,                  // 组合类型
      step: localStep,        // 本地节拍间隔
      index: beats.length,    // 序号
      dj: true,               // DJ 模式标记
      grid: true,             // 网格模式标记
      kickOnly: true,         // 仅底鼓模式
      server: true,           // 服务端分析标记
    });

    gridIndex++;
    gridT += localStep;  // 移动到下一个网格点
  }

  /* ==================== 输出结果 ==================== */
  /* 筛选不同用途的节拍子集 */
  const cameraBeats = beats.filter(b => b.camera !== false);   // 镜头节拍
  const pulseBeats = beats
    .filter(b => b.pulse !== false && (b.impact >= 0.16 || b.combo === 'downbeat'))
    .map(b => ({ time: b.time, strength: b.strength, impact: b.impact, combo: b.combo, low: b.low, body: b.body, snap: b.snap, dj: true }));  // 脉冲节拍

  return {
    kicks: beats.map(b => b.time),       // 所有节拍时间点
    beats,                               // 完整节拍对象数组
    pulseBeats,                          // 脉冲节拍子集
    cameraBeats,                         // 镜头节拍子集
    gridStep: globalStep,                // 全局节拍间隔
    sectionSteps,                        // 分段节拍间隔
    tempoSource: 'podcast-dj-server-low-offline',
    duration,                            // 总时长
    visualBeatCount: cameraBeats.length, // 视觉节拍数量
    analyzedAt: Date.now(),              // 分析时间戳
    debug: {
      candidates: candidates.length,     // 候选点数量
      hopSec,                            // 帧步长
      lowRef,                            // 低频参考值
      step: globalStep,                  // 全局步长
    },
  };
}

/* ==================== 音频解码与能量提取 ==================== */

/**
 * 解码音频流并提取低频/高频能量序列
 * 流程：HTTP 流式下载 → MPEG 解码 → 降采样 → 带通滤波 → 能量计算
 *
 * @param {string} audioUrl - 音频 URL
 * @param {object} opts - 选项：durationSec, userAgent, limitSec, range
 * @returns {object} { lowEnergy, hitEnergy, hopSec, duration, decode }
 */
async function decodePodcastDjEnergyRange(audioUrl, opts) {
  opts = opts || {};
  const { MPEGDecoder } = await import('mpg123-decoder');  // 动态导入 MP3 解码器
  const decoder = new MPEGDecoder({ enableGapless: false });
  await decoder.ready;

  const durationHint = Math.max(0, Number(opts.durationSec) || 0);
  const hopSec = durationHint > 4200 ? 0.0125 : 0.010;  // 超长音频用更大步长

  /* 能量缓冲区 */
  const lowEnergy = [];   // 低频能量（底鼓检测）
  const hitEnergy = [];   // 高频峰值（瞬态检测）

  /* 滤波器和采样状态 */
  let hp = null;              // 高通滤波器（去除 32Hz 以下）
  let lp = null;              // 低通滤波器（提取 178Hz 以下，底鼓频段）
  let effectiveSr = 0;        // 降采样后的有效采样率
  let sampleStep = 1;         // 降采样步长
  let hopSize = 0;            // 每帧的样本数
  let frameSum = 0;           // 当前帧的能量累加（用于 RMS）
  let framePeak = 0;          // 当前帧的峰值
  let frameCount = 0;         // 当前帧的样本计数
  let effectiveSamples = 0;   // 有效处理的总样本数
  let chunks = 0;             // 接收的数据块数
  let decodedSamples = 0;     // 解码的总样本数
  const limitSec = Math.max(0, Number(opts.limitSec) || 0);  // 解码时长限制

  /** 初始化滤波器和降采样参数 */
  function initFilters(sampleRate) {
    if (effectiveSr) return;  // 已初始化
    sampleStep = sampleRate >= 44100 ? 4 : (sampleRate >= 32000 ? 3 : 2);  // 降采样步长
    effectiveSr = sampleRate / sampleStep;
    hopSize = Math.max(80, Math.floor(effectiveSr * hopSec));  // 每帧样本数
    hp = makeBiquad('highpass', 32, 0.72, effectiveSr);   // 32Hz 高通滤波器
    lp = makeBiquad('lowpass', 178, 0.82, effectiveSr);   // 178Hz 低通滤波器
  }

  /** 提交当前帧能量到缓冲区 */
  function pushFrame() {
    const count = Math.max(1, frameCount);
    lowEnergy.push(Math.sqrt(frameSum / count));  // RMS 能量
    hitEnergy.push(framePeak);                     // 帧峰值
    frameSum = 0;
    framePeak = 0;
    frameCount = 0;
  }

  /**
   * 处理解码后的 PCM 数据：混合立体声 → 降采样 → 带通滤波 → 能量累加
   */
  function processDecoded(result) {
    if (!result || !result.samplesDecoded || !result.channelData || !result.channelData.length) return;
    const sr = result.sampleRate || 44100;
    initFilters(sr);
    const left = result.channelData[0];
    const right = result.channelData[1];
    const n = Math.min(result.samplesDecoded, left ? left.length : 0, right ? right.length : (left ? left.length : 0));
    decodedSamples += n;
    for (let i = 0; i < n; i += sampleStep) {
      const x = right ? ((left[i] || 0) + (right[i] || 0)) * 0.5 : (left[i] || 0);  // 混合立体声
      const y = runBiquad(lp, runBiquad(hp, x));  // 级联滤波：高通→低通
      const ay = Math.abs(y);
      frameSum += y * y;                            // 累加平方和
      if (ay > framePeak) framePeak = ay;           // 记录峰值
      frameCount++;
      effectiveSamples++;
      if (frameCount >= hopSize) pushFrame();       // 帧满则提交
    }
  }

  try {
    /* 流式下载音频 */
    const headers = {
      'User-Agent': opts.userAgent || DEFAULT_UA,
      'Referer': 'https://music.163.com/',
    };
    if (opts.range) headers.Range = opts.range;  // 支持 Range 请求
    const resp = await fetch(audioUrl, { headers });
    if (!resp.ok && resp.status !== 206) throw new Error('Audio fetch failed: ' + resp.status);
    if (!resp.body) throw new Error('Audio response has no body');

    /* 流式读取并解码 */
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      chunks++;
      processDecoded(decoder.decode(value instanceof Uint8Array ? value : new Uint8Array(value)));

      /* 达到时长限制则提前终止 */
      if (limitSec && effectiveSr && effectiveSamples / effectiveSr >= limitSec) {
        try { await reader.cancel(); } catch (e) {}
        break;
      }
      /* 每 12 块让出事件循环，避免阻塞 */
      if (chunks % 12 === 0) await new Promise(resolve => setImmediate(resolve));
    }

    /* 刷新解码器缓冲 */
    processDecoded(decoder.decode(new Uint8Array(0)));
    if (frameCount > 0) pushFrame();
  } finally {
    decoder.free();  // 释放解码器资源
  }

  return {
    lowEnergy,
    hitEnergy,
    hopSec,
    duration: effectiveSr ? effectiveSamples / effectiveSr : 0,
    decode: {
      chunks,
      decodedSamples,
      sampleRate: effectiveSr ? effectiveSr * sampleStep : 0,
      effectiveSampleRate: effectiveSr,
      frames: lowEnergy.length,
    },
  };
}

/* ==================== 播客 DJ 分析入口函数 ==================== */

/**
 * 分析播客前段（快速预览模式）
 * 只解码前 90-240 秒，快速生成节拍映射用于即时播放
 * @param {string} audioUrl - 音频 URL
 * @param {object} opts - 选项：durationSec, introSec, userAgent
 * @returns {object} 部分节拍映射（标记为 partial）
 */
async function analyzePodcastDjIntro(audioUrl, opts) {
  opts = opts || {};
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) throw new Error('Invalid audio url');
  const requestedDuration = Math.max(0, Number(opts.durationSec) || 0);
  const introSec = clampRange(Number(opts.introSec) || 180, 90, 240);  // 前段时长，限制在 90-240 秒

  /* 只解码前段音频 */
  const decoded = await decodePodcastDjEnergyRange(audioUrl, {
    durationSec: introSec,
    userAgent: opts.userAgent,
    limitSec: introSec + 8,
  });

  /* 截取有效帧 */
  const frameLimit = Math.max(1, Math.min(decoded.lowEnergy.length, Math.ceil((introSec + 2) / Math.max(0.001, decoded.hopSec || 0.010))));
  const lowEnergy = decoded.lowEnergy.slice(0, frameLimit);
  const hitEnergy = decoded.hitEnergy.slice(0, frameLimit);
  const mapDuration = Math.min(introSec, lowEnergy.length * decoded.hopSec);

  /* 构建节拍映射 */
  const map = buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, decoded.hopSec, mapDuration);
  map.partial = true;            // 标记为部分分析
  map.partialUntilSec = mapDuration;  // 部分分析截止时间
  map.fullDuration = requestedDuration || 0;  // 完整时长（由调用方提供）
  map.tempoSource = 'podcast-dj-server-intro-offline';
  map.decode = Object.assign({}, decoded.decode || {}, {
    intro: true,
    requestedDurationSec: requestedDuration,
    effectiveDurationSec: decoded.duration,
    partialUntilSec: mapDuration,
  });
  map.debug = Object.assign({}, map.debug || {}, {
    intro: true,
    partialUntilSec: mapDuration,
  });
  return map;
}

/**
 * 长播客采样分析模式
 * 对超长音频（>55分钟）采用分段采样策略，从多个位置提取片段分析后插值合成
 * @param {string} audioUrl - 音频 URL
 * @param {object} opts - 选项：durationSec, userAgent
 * @returns {object} 完整节拍映射
 */
async function analyzePodcastDjRangeSamples(audioUrl, opts) {
  opts = opts || {};
  const duration = Math.max(0, Number(opts.durationSec) || 0);
  if (!duration) throw new Error('Long podcast analysis needs duration');

  /* 先用 HEAD 请求获取文件大小 */
  let contentLength = 0;
  try {
    const head = await fetch(audioUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': opts.userAgent || DEFAULT_UA,
        'Referer': 'https://music.163.com/',
      },
    });
    contentLength = Number(head.headers.get('content-length') || 0) || 0;
  } catch (err) {
    contentLength = 0;
  }
  /* 无法获取文件大小时回退到全流分析 */
  if (!contentLength) {
    return analyzePodcastDjStreamFull(audioUrl, opts);
  }

  /* ==================== 采样策略 ==================== */
  /* 根据音频时长决定采样数量和窗口大小 */
  const sampleCount = duration > 14400 ? 12 : (duration > 9000 ? 10 : 8);  // 采样数量
  const sampleStarts = [];
  for (let i = 0; i < sampleCount; i++) {
    const pos = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    /* 非均匀分布：开头密集，结尾稍远，中间均匀 */
    const shaped = i === 0 ? 0 : (i === sampleCount - 1 ? 0.88 : 0.08 + pos * 0.80);
    sampleStarts.push(duration * shaped);
  }
  const sampleWindow = duration > 14400 ? 82 : (duration > 9000 ? 88 : 96);  // 每个采样窗口的时长
  const sampleMaps = [];   // 各采样段的节拍映射
  let totalChunks = 0;
  let totalDecoded = 0;

  /* 逐段采样分析 */
  for (let i = 0; i < sampleStarts.length; i++) {
    const targetTime = Math.max(0, Math.min(duration - sampleWindow, sampleStarts[i]));
    const bytePerSec = contentLength / Math.max(1, duration);  // 字节/秒估算

    /* 计算 HTTP Range 请求的字节范围 */
    const prerollBytes = i === 0 ? 0 : Math.min(384 * 1024, Math.floor(bytePerSec * 4));  // 前置缓冲（解码器预热）
    const startByte = Math.max(0, Math.floor(targetTime * bytePerSec) - prerollBytes);
    const windowBytes = Math.max(768 * 1024, Math.floor(sampleWindow * bytePerSec) + prerollBytes + 128 * 1024);
    const endByte = Math.min(contentLength - 1, startByte + windowBytes);
    const approxOffset = startByte / contentLength * duration;  // 近似时间偏移

    /* 解码并分析该段 */
    const decoded = await decodePodcastDjEnergyRange(audioUrl, {
      durationSec: sampleWindow,
      userAgent: opts.userAgent,
      range: 'bytes=' + startByte + '-' + endByte,
    });
    totalChunks += decoded.decode.chunks || 0;
    totalDecoded += decoded.decode.decodedSamples || 0;
    const map = buildBeatMapFromLowEnergy(decoded.lowEnergy, decoded.hitEnergy, decoded.hopSec, decoded.duration || sampleWindow);
    if (map && map.visualBeatCount >= 8 && map.gridStep) {
      sampleMaps.push({ offset: approxOffset, map });
    }
  }

  /* 没有有效采样映射则返回空 */
  if (!sampleMaps.length) {
    return {
      kicks: [],
      beats: [],
      pulseBeats: [],
      cameraBeats: [],
      duration,
      visualBeatCount: 0,
      tempoSource: 'podcast-dj-server-range-empty',
      analyzedAt: Date.now(),
    };
  }

  /* ==================== 相位估计 ==================== */
  /**
   * 使用圆形统计（Circular Statistics）估计节拍相位
   * 将节拍时间映射到单位圆上，通过向量平均得到主相位
   * @param {object} map - 节拍映射
   * @param {number} baseStep - 基准节拍间隔
   * @returns {object} { phase, step }
   */
  function phaseFromMap(map, baseStep) {
    const step = clampRange(baseStep || map.gridStep || 0.50, 0.32, 0.86);
    const beats = (map.cameraBeats && map.cameraBeats.length ? map.cameraBeats : (map.beats || []))
      .filter(b => b && Number.isFinite(b.time) && b.time > 0.35);
    if (!beats.length) return { phase: 0, step };

    /* 将每个节拍映射到单位圆上，加权累加 */
    let sx = 0;
    let sy = 0;
    let total = 0;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const impact = b.impact == null ? (b.strength || 0.3) : b.impact;
      const w = 0.20 + Math.pow(Math.max(0, impact), 1.45);  // 权重：高冲击力的节拍权重更大
      const phase = ((b.time % step) + step) % step;          // 取模得到相位
      const angle = phase / step * Math.PI * 2;               // 转换为角度
      sx += Math.cos(angle) * w;  // X 分量累加
      sy += Math.sin(angle) * w;  // Y 分量累加
      total += w;
    }
    if (total <= 0) return { phase: ((beats[0].time % step) + step) % step, step };

    /* 向量平均得到主方向 */
    let angle = Math.atan2(sy / total, sx / total);
    if (angle < 0) angle += Math.PI * 2;
    return { phase: angle / (Math.PI * 2) * step, step };  // 转换回时间
  }

  /* ==================== 全局参数聚合 ==================== */
  /* 投票法估计全局节拍间隔：视觉节拍越多的采样段权重越大 */
  const stepVotes = [];
  sampleMaps.forEach(s => {
    const w = Math.max(1, Math.min(16, Math.round((s.map.visualBeatCount || 0) / 16)));
    for (let i = 0; i < w; i++) stepVotes.push(s.map.gridStep);
  });
  let globalStep = clampRange(median(stepVotes) || sampleMaps[0].map.gridStep || 0.50, 0.32, 0.86);

  /* 确定锚点时间（第一个采样段的第一个节拍） */
  const firstMap = sampleMaps[0].map;
  const firstBeat = (firstMap.cameraBeats || firstMap.beats || [])[0];
  let anchor = (firstBeat && firstBeat.time ? firstBeat.time : 0);
  while (anchor - globalStep > 0.05) anchor -= globalStep;  // 对齐到网格起点

  /* ==================== 能量剖面构建 ==================== */
  /* 为每个采样段计算能量特征，用于后续插值生成完整节拍序列 */
  const profiles = sampleMaps.map(s => {
    const beats = s.map.cameraBeats || s.map.beats || [];
    const impacts = beats.map(b => b.impact == null ? b.strength : b.impact).filter(v => Number.isFinite(v));
    const activeImpacts = impacts.filter(v => v >= 0.10);
    const avgImpact = activeImpacts.length ? activeImpacts.reduce((a, b) => a + b, 0) / activeImpacts.length : 0.16;
    const hiImpact = impacts.length ? percentile(impacts, 0.90, 4000) : Math.max(0.55, avgImpact);
    const activity = beats.length / Math.max(20, s.map.duration || 20);  // 活跃度（节拍密度）
    const phaseInfo = phaseFromMap(s.map, globalStep);
    return {
      time: s.offset,       // 时间偏移
      avg: clampRange(avgImpact * clampRange(activity / 1.65, 0.38, 1.05), 0.08, 0.72),  // 平均能量
      hi: clampRange(hiImpact, 0.18, 0.96),           // 高能量
      activity: clampRange(activity / 1.65, 0.18, 1.12),  // 活跃度
      step: globalStep,
      anchor: s.offset + (phaseInfo.phase || 0),  // 该段的锚点时间
    };
  }).sort((a, b) => a.time - b.time);

  /**
   * 获取指定时间点的能量剖面（线性插值）
   * @param {number} time - 时间（秒）
   * @returns {object} 能量特征 { avg, hi, activity, step }
   */
  function profileAt(time) {
    if (profiles.length === 1) return profiles[0];
    let prev = profiles[0];
    let next = profiles[profiles.length - 1];
    /* 找到 time 前后的两个采样点 */
    for (let i = 0; i < profiles.length; i++) {
      if (profiles[i].time <= time) prev = profiles[i];
      if (profiles[i].time >= time) { next = profiles[i]; break; }
    }
    if (prev === next) return prev;
    /* 线性插值 */
    const mix = clamp01((time - prev.time) / Math.max(1, next.time - prev.time));
    return {
      time,
      avg: prev.avg + (next.avg - prev.avg) * mix,
      hi: prev.hi + (next.hi - prev.hi) * mix,
      activity: prev.activity + (next.activity - prev.activity) * mix,
      step: prev.step + (next.step - prev.step) * mix,
    };
  }

  /* ==================== 生成完整节拍序列 ==================== */
  const beats = [];
  let gridIndex = 0;

  /**
   * 生成一个采样段的节拍点
   * @param {number} t - 时间
   * @param {number} stepOverride - 节拍间隔覆盖
   */
  function pushRangeBeat(t, stepOverride) {
    const p = profileAt(t);  // 获取该时间点的能量剖面
    const slot = gridIndex % 4;
    let combo = slot === 0 ? 'downbeat' : (slot === 1 ? 'push' : (slot === 2 ? 'drop' : 'rebound'));

    /* 计算段能量和动态变化 */
    const sectionEnergy = clamp01((p.avg - 0.055) / 0.54) * clampRange(p.activity || 0.5, 0.30, 1.10);
    const motion = (Math.sin(gridIndex * 1.618 + p.avg * 9.7) * 0.5 + Math.sin(gridIndex * 0.317) * 0.28) * (0.08 + sectionEnergy * 0.17);
    const rel = clamp01(0.12 + sectionEnergy * 0.70 + motion + (combo === 'downbeat' ? 0.060 : 0));
    if (rel > 0.82 && combo !== 'downbeat') combo = 'accent';
    const visualRel = rel > 0.78 ? 0.78 + (rel - 0.78) * 0.50 : rel;

    /* 计算视觉参数 */
    const comboLift = combo === 'downbeat' ? 0.10 * sectionEnergy : (combo === 'drop' ? 0.050 * sectionEnergy : (combo === 'accent' ? 0.075 * sectionEnergy : 0));
    const impact = clampRange(0.026 + Math.pow(visualRel, 1.48) * (0.42 + p.hi * 0.34) + comboLift, 0.020, 0.90);
    const strength = clampRange(0.15 + Math.pow(visualRel, 1.02) * 0.66 + comboLift * 0.68, 0.12, 0.93);
    const cameraActive = impact >= 0.105 || (combo === 'downbeat' && sectionEnergy >= 0.16);

    /* 频段混合 */
    const low = clampRange(0.50 + visualRel * 0.32 + (combo === 'downbeat' ? 0.050 * sectionEnergy : 0) - (combo === 'accent' ? 0.12 : 0), 0.42, 0.90);
    const body = clampRange(0.06 + visualRel * 0.15 + (combo === 'push' ? 0.22 * sectionEnergy : 0) + (combo === 'drop' ? 0.30 * sectionEnergy : 0), 0.045, 0.56);
    const snap = clampRange(0.025 + visualRel * 0.035 + (combo === 'accent' ? 0.40 * sectionEnergy : 0) + (combo === 'rebound' ? 0.12 * sectionEnergy : 0), 0.02, 0.62);
    /* 生成节拍对象 */
    beats.push({
      time: t,
      strength,
      confidence: 0.68 + visualRel * 0.22,
      impact,
      primary: cameraActive,
      camera: cameraActive,
      pulse: impact > 0.16 || (combo === 'downbeat' && sectionEnergy >= 0.24),
      tone: 'podcast-dj-server-range-grid',
      low,
      body,
      snap,
      mass: clampRange(low * 0.72 + Math.pow(visualRel, 1.22) * 0.24, 0.36, 0.94),
      sharpness: combo === 'accent' ? 0.20 : 0.08,
      combo,
      step: stepOverride || p.step || globalStep,
      index: beats.length,
      dj: true,
      grid: true,
      kickOnly: true,
      server: true,
      sampled: true,  // 标记为采样分析
    });
    gridIndex++;
  }

  /* 遍历每个采样段，生成节拍序列 */
  for (let si = 0; si < profiles.length; si++) {
    const p = profiles[si];
    const start = si === 0 ? 0 : (profiles[si - 1].time + p.time) * 0.5;  // 段起始（前半段中点）
    const end = si === profiles.length - 1 ? duration : (p.time + profiles[si + 1].time) * 0.5;  // 段结束
    const localStep = globalStep;
    let t = Number.isFinite(p.anchor) ? p.anchor : anchor;
    /* 对齐到网格 */
    while (t - localStep > start) t -= localStep;
    while (t < start) t += localStep;
    for (; t < end - 0.04; t += localStep) pushRangeBeat(t, localStep);
  }

  /* ==================== 输出结果 ==================== */
  const cameraBeats = beats.filter(b => b.camera !== false);
  const pulseBeats = beats
    .filter(b => b.pulse !== false && (b.impact >= 0.16 || b.combo === 'downbeat'))
    .map(b => ({ time: b.time, strength: b.strength, impact: b.impact, combo: b.combo, low: b.low, body: b.body, snap: b.snap, dj: true }));

  return {
    kicks: beats.map(b => b.time),
    beats,
    pulseBeats,
    cameraBeats,
    gridStep: globalStep,
    sectionSteps: profiles.map(p => p.step),
    tempoSource: 'podcast-dj-server-range-offline',
    duration,
    visualBeatCount: cameraBeats.length,
    analyzedAt: Date.now(),
    debug: {
      rangeSampled: true,
      samples: sampleMaps.length,
      profiles,
      contentLength,
      decode: { chunks: totalChunks, decodedSamples: totalDecoded },
    },
  };
}

/**
 * 播客 DJ 分析主入口 - 根据音频时长选择最佳分析策略
 * @param {string} audioUrl - 音频 URL
 * @param {object} opts - 选项：durationSec, userAgent
 * @returns {object} 节拍映射
 */
async function analyzePodcastDjStream(audioUrl, opts) {
  opts = opts || {};
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) throw new Error('Invalid audio url');
  const durationSec = Math.max(0, Number(opts.durationSec) || 0);

  /* 策略选择：
   * 33-7200秒：尝试全流高质量分析，失败则回退到采样分析
   * >7200秒：直接使用采样分析
   * <=3300秒：全流分析
   */
  if (durationSec > 3300 && durationSec <= FULL_STREAM_QUALITY_LIMIT_SEC) {
    try {
      const map = await analyzePodcastDjStreamFull(audioUrl, Object.assign({}, opts, { preferQualityFullStream: true }));
      map.debug = Object.assign({}, map.debug || {}, { fullStreamQuality: true, requestedDurationSec: durationSec });
      return map;
    } catch (err) {
      console.warn('[PodcastDjBeatmap] full-stream quality path failed, falling back to range:', err && err.message ? err.message : err);
      return analyzePodcastDjRangeSamples(audioUrl, opts);
    }
  }
  if (durationSec > FULL_STREAM_QUALITY_LIMIT_SEC) {
    return analyzePodcastDjRangeSamples(audioUrl, opts);
  }
  return analyzePodcastDjStreamFull(audioUrl, opts);
}

/**
 * 全流高质量分析 - 解码完整音频流
 * 适用于中等长度音频（<=2小时），精度最高
 * @param {string} audioUrl - 音频 URL
 * @param {object} opts - 选项
 * @returns {object} 节拍映射
 */
async function analyzePodcastDjStreamFull(audioUrl, opts) {
  opts = opts || {};
  const { MPEGDecoder } = await import('mpg123-decoder');
  const decoder = new MPEGDecoder({ enableGapless: false });
  await decoder.ready;

  const durationHint = Math.max(0, Number(opts.durationSec) || 0);
  const hopSec = durationHint > 9000 ? 0.0125 : 0.010;  // 超长音频用更大步长
  const lowEnergy = [];
  const hitEnergy = [];
  let hp = null;
  let lp = null;
  let effectiveSr = 0;        // 有效采样率
  let sampleStep = 1;         // 降采样步长
  let hopSize = 0;            // 每帧样本数
  let frameSum = 0;           // 帧能量累加
  let framePeak = 0;          // 帧峰值
  let frameCount = 0;         // 帧样本计数
  let effectiveSamples = 0;   // 有效样本总数
  let chunks = 0;             // 数据块计数
  let decodedSamples = 0;     // 解码样本总数

  /** 初始化滤波器和降采样参数 */
  function initFilters(sampleRate) {
    if (effectiveSr) return;
    sampleStep = sampleRate >= 44100 ? 4 : (sampleRate >= 32000 ? 3 : 2);
    effectiveSr = sampleRate / sampleStep;
    hopSize = Math.max(80, Math.floor(effectiveSr * hopSec));
    hp = makeBiquad('highpass', 32, 0.72, effectiveSr);
    lp = makeBiquad('lowpass', 178, 0.82, effectiveSr);
  }

  /** 提交当前帧能量 */
  function pushFrame() {
    const count = Math.max(1, frameCount);
    lowEnergy.push(Math.sqrt(frameSum / count));  // RMS
    hitEnergy.push(framePeak);
    frameSum = 0;
    framePeak = 0;
    frameCount = 0;
  }

  /** 处理解码数据：混合立体声 → 降采样 → 带通滤波 → 能量累加 */
  function processDecoded(result) {
    if (!result || !result.samplesDecoded || !result.channelData || !result.channelData.length) return;
    const sr = result.sampleRate || 44100;
    initFilters(sr);
    const left = result.channelData[0];
    const right = result.channelData[1];
    const n = Math.min(result.samplesDecoded, left ? left.length : 0, right ? right.length : (left ? left.length : 0));
    decodedSamples += n;
    for (let i = 0; i < n; i += sampleStep) {
      const x = right ? ((left[i] || 0) + (right[i] || 0)) * 0.5 : (left[i] || 0);
      const y = runBiquad(lp, runBiquad(hp, x));
      const ay = Math.abs(y);
      frameSum += y * y;
      if (ay > framePeak) framePeak = ay;
      frameCount++;
      effectiveSamples++;
      if (frameCount >= hopSize) pushFrame();
    }
  }

  try {
    /* 流式下载并解码完整音频 */
    const resp = await fetch(audioUrl, {
      headers: {
        'User-Agent': opts.userAgent || DEFAULT_UA,
        'Referer': 'https://music.163.com/',
      },
    });
    if (!resp.ok || !resp.body) throw new Error('Audio fetch failed: ' + resp.status);
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      chunks++;
      processDecoded(decoder.decode(value instanceof Uint8Array ? value : new Uint8Array(value)));
      /* 每 12 块让出事件循环 */
      if (chunks % 12 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    /* 刷新解码器 */
    const tail = decoder.decode(new Uint8Array(0));
    processDecoded(tail);
    if (frameCount > 0) pushFrame();
  } finally {
    decoder.free();
  }

  const effectiveDuration = effectiveSr ? effectiveSamples / effectiveSr : 0;
  const duration = effectiveDuration || durationHint;

  /* 构建节拍映射 */
  const map = buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, hopSec, duration);
  map.decode = {
    chunks,
    decodedSamples,
    sampleRate: effectiveSr ? effectiveSr * sampleStep : 0,
    effectiveSampleRate: effectiveSr,
    frames: lowEnergy.length,
    requestedDurationSec: durationHint,
    effectiveDurationSec: effectiveDuration,
    fullStreamQuality: !!opts.preferQualityFullStream,
  };
  return map;
}

/* ==================== 模块导出 ==================== */
module.exports = {
  analyzePodcastDjStream,        // 主入口：根据时长自动选择分析策略
  analyzePodcastDjIntro,         // 快速预览：只分析前段
  buildBeatMapFromLowEnergy,     // 核心算法：从能量数据构建节拍映射
};
