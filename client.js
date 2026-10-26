window.__ModuleLoader__.load({
  id: 'dsh-token-usage',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-token-usage';
    const ROUTE = '/_dsh/dsh-token-usage/usage';

    const DAY_MS = 86400000;

    // Custom-range cap. Day granularity stays under ~400 points for a full
    // year, so the chart never turns into one solid block of ink.
    const MAX_CUSTOM_DAYS = 365;

    const ZH = {
      'view.label': 'Token 用量',
      'ui.loading': '正在读取 token 用量…',
      'ui.error': '无法读取 token 用量',
      'ui.retry': '重试',
      'ui.empty': '这个范围内没有记录到 token 用量。',
      'ui.emptyHint': '数据来自已记录的模型响应；换一个更长的时间范围试试。',
      'ui.range': '时间',
      'ui.scope': '统计',
      'ui.scopeSession': '本会话',
      'ui.scopeAll': '全部会话',
      'ui.today': '今天',
      'ui.yesterday': '昨天',
      'ui.last7': '近 7 天',
      'ui.last30': '近 30 天',
      'ui.thisMonth': '本月',
      'ui.lastMonth': '上月',
      'ui.custom': '自定义',
      'ui.to': '至',
      'ui.customHint': '最长 {days} 天',
      'ui.customInvalid': '日期无效：结束不能早于开始',
      'ui.granularity': '粒度',
      'ui.hour': '小时',
      'ui.day': '天',
      'ui.month': '月',
      'ui.total': '合计',
      'ui.input': '输入',
      'ui.output': '输出',
      'ui.cacheRead': '缓存读',
      'ui.cacheWrite': '缓存写',
      'ui.cache': '缓存',
      'ui.reasoning': '推理',
      'ui.calls': '调用',
      'ui.api': 'API',
      'ui.apiCount': '共 {n} 个 API',
      'ui.apiAll': '全部',
      'ui.apiSelected': '已选 {n} / {total}',
      'ui.breakdown': '按 API',
      'ui.timeline': '趋势',
      'ui.scanned': '已扫描 {sessions} 个会话',
      'ui.failed': '，{n} 个读取失败',
      'ui.took': '耗时 {ms} ms',
      'ui.provider': '服务商',
      'ui.model': '模型',
      'ui.share': '占比',
      'ui.globalNote': '统计本机全部会话，不限于当前对话。',
      'ui.sessionNote': '统计当前对话及其派生会话（子代理 / fork）。',
      'ui.hint': '只统计已记录的模型响应 token 数，不含费用估算。',
      'ui.legendHint': '点击图例可隐藏该系列；点击 API 可只看它',
      'ui.refresh': '刷新',
      'ui.avg': '平均每次',
      'ui.noSeries': '无数据',
    };

    const EN = {
      'view.label': 'Token Usage',
      'ui.loading': 'Loading token usage...',
      'ui.error': 'Could not load token usage',
      'ui.retry': 'Retry',
      'ui.empty': 'No token usage recorded in this range.',
      'ui.emptyHint': 'Data comes from recorded model responses; try a longer range.',
      'ui.range': 'Time',
      'ui.scope': 'Scope',
      'ui.scopeSession': 'This chat',
      'ui.scopeAll': 'All chats',
      'ui.today': 'Today',
      'ui.yesterday': 'Yesterday',
      'ui.last7': 'Last 7d',
      'ui.last30': 'Last 30d',
      'ui.thisMonth': 'This month',
      'ui.lastMonth': 'Last month',
      'ui.custom': 'Custom',
      'ui.to': 'to',
      'ui.customHint': 'up to {days} days',
      'ui.customInvalid': 'Invalid dates: end is before start',
      'ui.granularity': 'Group by',
      'ui.hour': 'Hour',
      'ui.day': 'Day',
      'ui.month': 'Month',
      'ui.total': 'Total',
      'ui.input': 'Input',
      'ui.output': 'Output',
      'ui.cacheRead': 'Cache read',
      'ui.cacheWrite': 'Cache write',
      'ui.cache': 'Cache',
      'ui.reasoning': 'Reasoning',
      'ui.calls': 'Calls',
      'ui.api': 'API',
      'ui.apiCount': '{n} APIs',
      'ui.apiAll': 'All',
      'ui.apiSelected': '{n} of {total} selected',
      'ui.breakdown': 'By API',
      'ui.timeline': 'Timeline',
      'ui.scanned': 'Scanned {sessions} sessions',
      'ui.failed': ', {n} unreadable',
      'ui.took': 'in {ms} ms',
      'ui.provider': 'Provider',
      'ui.model': 'Model',
      'ui.share': 'Share',
      'ui.globalNote': 'Counts every session on this machine, not just this conversation.',
      'ui.sessionNote': 'Counts this conversation and the sessions derived from it (subagents, forks).',
      'ui.hint': 'Recorded response tokens only; no cost estimate.',
      'ui.legendHint': 'Click a legend entry to hide it; click an API to isolate it',
      'ui.refresh': 'Refresh',
      'ui.avg': 'Avg per call',
      'ui.noSeries': 'No data',
    };

    // Fixed semantic colours: a metric keeps its hue across every range, bucket
    // and filter, so a colour always means the same thing on this chart.
    const METRICS = [
      { key: 'input', label: 'ui.input', color: '#4c8dff' },
      { key: 'output', label: 'ui.output', color: '#22b07d' },
      { key: 'cacheRead', label: 'ui.cacheRead', color: '#f2994a' },
      { key: 'cacheWrite', label: 'ui.cacheWrite', color: '#a259ff' },
    ];

    // API chips and the table keep their own palette: unlike the metric hues
    // this is categorical artwork, only has to be distinguishable.
    const API_PALETTE = [
      '#4c8dff', '#22b07d', '#f2994a', '#a259ff',
      '#e0568a', '#12b5cb', '#d4b106', '#7f8c99',
      '#e06666', '#3f7f3f', '#8e6bd6', '#b5651d',
    ];

    function formatCount(n) {
      const v = Number(n) || 0;
      if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return String(Math.round(v));
    }

    function formatFull(n) {
      return (Number(n) || 0).toLocaleString();
    }

    function pad2(n) {
      return n < 10 ? '0' + n : String(n);
    }

    function startOfDay(ts) {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    function startOfMonth(ts) {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d.getTime();
    }

    function addMonths(ts, n) {
      const d = new Date(ts);
      d.setMonth(d.getMonth() + n);
      return d.getTime();
    }

    function formatDateInput(ts) {
      const d = new Date(ts);
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function parseDateInput(text, endOfDay) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (isNaN(d.getTime())) return null;
      d.setHours(0, 0, 0, 0);
      const base = d.getTime();
      return endOfDay ? base + DAY_MS - 1 : base;
    }

    function formatBucketLabel(key, bucket) {
      if (!key) return '';
      if (bucket === 'hour') {
        const parts = key.split(' ');
        return parts[0].slice(5) + ' ' + parts[1] + ':00';
      }
      if (bucket === 'day') return key.slice(5);
      return key;
    }

    function seriesKeyOf(provider, model) {
      return provider + '||' + model;
    }

    function metricValueOf(bucket, key) {
      return (bucket && bucket[key]) || 0;
    }

    // ---------------------------------------------------------------------
    // Time ranges: computed in the VIEWER's wall clock, then sent as epochs.
    // A day count cannot express "this month" or "yesterday", so the Client
    // owns the calendar math and the Host only applies the window it receives.
    // ---------------------------------------------------------------------

    function rangeWindow(kind, customFrom, customTo) {
      const now = Date.now();
      const todayStart = startOfDay(now);
      switch (kind) {
        case 'today':
          return { from: todayStart, to: now };
        case 'yesterday':
          return { from: todayStart - DAY_MS, to: todayStart - 1 };
        case 'last7':
          return { from: todayStart - 6 * DAY_MS, to: now };
        case 'last30':
          return { from: todayStart - 29 * DAY_MS, to: now };
        case 'thisMonth':
          return { from: startOfMonth(now), to: now };
        case 'lastMonth': {
          const thisMonth = startOfMonth(now);
          return { from: addMonths(thisMonth, -1), to: thisMonth - 1 };
        }
        default: {
          // Parse both days as START points, order them, then stretch the later
          // one to its end of day. Applying end-of-day before ordering would
          // invert the window when the user types the two dates backwards.
          const a = parseDateInput(customFrom, false);
          const b = parseDateInput(customTo, false);
          if (a === null || b === null) return null;
          const start = Math.min(a, b);
          const end = Math.max(a, b) + DAY_MS - 1;
          const capped = Math.min(end, start + MAX_CUSTOM_DAYS * DAY_MS - 1);
          return { from: start, to: capped };
        }
      }
    }

    // Granularity that keeps the plotted point count readable for a span.
    function autoBucket(from, to) {
      const span = Math.max(0, to - from);
      if (span <= 3 * DAY_MS) return 'hour';
      if (span <= 400 * DAY_MS) return 'day';
      return 'month';
    }

    function tzOffsetMinutes() {
      return -new Date().getTimezoneOffset();
    }

    function fetchUsage(params, signal) {
      const query = new URLSearchParams();
      query.set('from', String(params.from));
      query.set('to', String(params.to));
      query.set('bucket', params.bucket);
      query.set('tzOffset', String(tzOffsetMinutes()));
      if (params.sessionId) query.set('sessionId', params.sessionId);
      if (params.refresh) query.set('refresh', '1');
      return fetch(ROUTE + '?' + query.toString(), {
        method: 'GET',
        signal: signal,
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (body) {
        if (!body || body.ok !== true) throw new Error((body && body.error) || 'bad payload');
        return body;
      });
    }

    const CSS = `
.tku-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px 26px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
.tku-head { display: flex; flex-direction: column; gap: 3px; }
.tku-title { font-size: 15px; font-weight: 600; }
.tku-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); }

.tku-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 9px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.tku-group { display: inline-flex; align-items: center; gap: 6px; }
.tku-group-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }

.tku-seg {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.tku-seg-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.tku-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.tku-seg-btn[data-active='true'] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.tku-custom { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tku-date {
  appearance: none;
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.tku-note-warn { font-size: 11px; color: var(--dsw-alias-label-secondary); }

.tku-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 9px;
}
.tku-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.tku-card-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tku-card-value { font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tku-card-note { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }

.tku-panel {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 11px 13px 13px;
  min-width: 0;
}
.tku-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
  margin-bottom: 9px;
}
.tku-panel-title { font-size: 13px; font-weight: 600; }
.tku-panel-note { font-size: 11px; color: var(--dsw-alias-label-secondary); }

.tku-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.tku-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  cursor: pointer;
  max-width: 100%;
}
.tku-chip[data-on='true'] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.tku-chip[data-on='false'] { opacity: 0.45; }
.tku-chip-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.tku-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tku-chip-total { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }

.tku-plot-wrap { position: relative; width: 100%; }
.tku-svg { display: block; width: 100%; overflow: visible; }
.tku-grid { stroke: var(--dsw-alias-border-l2); stroke-width: 1; }
.tku-axis-text { fill: var(--dsw-alias-label-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
.tku-line { fill: none; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.tku-guide { stroke: var(--dsw-alias-label-secondary); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.6; }
.tku-dot { stroke: var(--dsw-alias-bg-base); stroke-width: 1.5; }

.tku-tip {
  position: absolute;
  top: 4px;
  transform: translateX(-50%);
  pointer-events: none;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 7px 9px;
  font-size: 11px;
  line-height: 1.55;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  min-width: 128px;
  z-index: 2;
  white-space: nowrap;
}
.tku-tip-key { font-weight: 600; margin-bottom: 3px; }
.tku-tip-row { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.tku-tip-label { display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); }
.tku-tip-swatch { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.tku-tip-value { font-variant-numeric: tabular-nums; }

.tku-legend { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 10px; }
.tku-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  cursor: pointer;
}
.tku-legend-item[data-off='true'] { opacity: 0.4; }
.tku-legend-total { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }

.tku-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tku-table th, .tku-table td {
  text-align: right;
  padding: 6px 7px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tku-table th {
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.tku-table th:first-child, .tku-table td:first-child,
.tku-table th:nth-child(2), .tku-table td:nth-child(2) { text-align: left; }
.tku-table tbody tr:last-child td { border-bottom: 0; }
.tku-table tbody tr:hover { background: var(--dsw-alias-bg-layer-2); }
.tku-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.tku-bar-cell { display: inline-flex; align-items: center; gap: 7px; justify-content: flex-end; }
.tku-bar-mini { height: 6px; border-radius: 3px; flex: none; }

.tku-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 34px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  text-align: center;
}
.tku-btn {
  appearance: none;
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.tku-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.tku-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
`;

    function installStyles() {
      if (typeof document === 'undefined' || !document || !document.head) return function () {};
      const id = 'dsh-token-usage';
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return function () {};
      const style = document.createElement('style');
      style.dataset.plugin = id;
      style.dataset.pluginCss = id;
      style.textContent = CSS;
      document.head.appendChild(style);
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    // ---------------------------------------------------------------------
    // Presentational pieces
    // ---------------------------------------------------------------------

    function Segmented(props) {
      return h('div', { className: 'tku-seg', role: 'group', 'aria-label': props.label },
        props.options.map(function (opt) {
          const active = opt.value === props.value;
          return h('button', {
            key: String(opt.value),
            type: 'button',
            className: 'tku-seg-btn',
            'data-active': String(active),
            'aria-pressed': active,
            title: opt.title || undefined,
            onClick: function () { props.onChange(opt.value); },
          }, opt.label);
        }));
    }

    function StatCard(props) {
      return h('div', { className: 'tku-card' },
        h('div', { className: 'tku-card-label' }, props.label),
        h('div', { className: 'tku-card-value', title: props.full || undefined }, props.value),
        props.note ? h('div', { className: 'tku-card-note' }, props.note) : null);
    }

    // The plot is sized in real pixels, so the SVG needs the box it lives in.
    function useMeasuredWidth() {
      const ref = React.useRef(null);
      const [width, setWidth] = React.useState(640);
      React.useEffect(function () {
        const el = ref.current;
        if (!el) return undefined;
        function update() {
          const next = el.clientWidth || 640;
          setWidth(function (prev) { return Math.abs(prev - next) < 1 ? prev : next; });
        }
        update();
        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(update);
          ro.observe(el);
          return function () { ro.disconnect(); };
        }
        window.addEventListener('resize', update);
        return function () { window.removeEventListener('resize', update); };
      }, []);
      return [ref, width];
    }

    // Round a maximum up to a legible axis top.
    function niceMax(value) {
      if (!(value > 0)) return 1;
      const exp = Math.floor(Math.log10(value));
      const base = Math.pow(10, exp);
      const scaled = value / base;
      let step;
      if (scaled <= 1) step = 1;
      else if (scaled <= 2) step = 2;
      else if (scaled <= 2.5) step = 2.5;
      else if (scaled <= 5) step = 5;
      else step = 10;
      return step * base;
    }

    function LineChart(props) {
      const buckets = props.buckets;
      const metrics = props.metrics;
      const t = props.t;
      const bucket = props.bucket;

      const measured = useMeasuredWidth();
      const wrapRef = measured[0];
      const width = measured[1];
      const hoverState = React.useState(-1);
      const hover = hoverState[0];
      const setHover = hoverState[1];

      const H = 224;
      const padL = 54;
      const padR = 14;
      const padT = 12;
      const padB = 28;
      const innerW = Math.max(40, width - padL - padR);
      const innerH = H - padT - padB;
      const n = buckets.length;

      let max = 0;
      const seriesValues = metrics.map(function (m) {
        const values = buckets.map(function (b) {
          const v = metricValueOf(b, m.key);
          if (v > max) max = v;
          return v;
        });
        return { metric: m, values: values };
      });
      const top = niceMax(max);

      function xAt(i) {
        if (n <= 1) return padL + innerW / 2;
        return padL + (i / (n - 1)) * innerW;
      }
      function yAt(v) {
        if (top <= 0) return padT + innerH;
        return padT + innerH - (v / top) * innerH;
      }

      const ticks = [0, 0.25, 0.5, 0.75, 1];

      const grid = ticks.map(function (frac) {
        const y = padT + innerH - frac * innerH;
        return h('g', { key: 'g-' + frac },
          h('line', { className: 'tku-grid', x1: padL, x2: padL + innerW, y1: y, y2: y }),
          h('text', { className: 'tku-axis-text', x: padL - 8, y: y + 3.5, textAnchor: 'end' },
            formatCount(top * frac)));
      });

      // Label stride keeps the x axis readable however many points there are.
      const maxLabels = Math.max(2, Math.floor(innerW / 62));
      const stride = n <= maxLabels ? 1 : Math.ceil(n / maxLabels);
      const xLabels = buckets.map(function (b, i) {
        if (i % stride !== 0 && i !== n - 1) return null;
        return h('text', {
          key: 'x-' + b.key,
          className: 'tku-axis-text',
          x: xAt(i),
          y: padT + innerH + 16,
          textAnchor: i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle'),
        }, formatBucketLabel(b.key, bucket));
      });

      const lines = seriesValues.map(function (entry) {
        const d = entry.values.map(function (v, i) {
          return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1);
        }).join(' ');
        return h('path', { key: 'l-' + entry.metric.key, className: 'tku-line', d: d, stroke: entry.metric.color });
      });

      const hoverMarks = hover >= 0 && hover < n
        ? h('g', null,
            h('line', {
              className: 'tku-guide',
              x1: xAt(hover), x2: xAt(hover),
              y1: padT, y2: padT + innerH,
            }),
            seriesValues.map(function (entry) {
              return h('circle', {
                key: 'hd-' + entry.metric.key,
                className: 'tku-dot',
                cx: xAt(hover),
                cy: yAt(entry.values[hover]),
                r: 3.2,
                fill: entry.metric.color,
              });
            }))
        : null;

      function onMove(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        if (n <= 0) { setHover(-1); return; }
        let idx = n <= 1 ? 0 : Math.round(((x - padL) / innerW) * (n - 1));
        if (idx < 0) idx = 0;
        if (idx > n - 1) idx = n - 1;
        setHover(idx);
      }

      const svg = h('svg', {
        className: 'tku-svg',
        width: width,
        height: H,
        viewBox: '0 0 ' + width + ' ' + H,
        onMouseMove: onMove,
        onMouseLeave: function () { setHover(-1); },
        role: 'img',
        'aria-label': t('ui.timeline'),
      }, grid, xLabels, lines, hoverMarks);

      const tip = hover >= 0 && hover < n
        ? h('div', {
            className: 'tku-tip',
            style: { left: Math.max(70, Math.min(width - 70, xAt(hover))) },
          },
            h('div', { className: 'tku-tip-key' }, buckets[hover].key),
            seriesValues.map(function (entry) {
              return h('div', { className: 'tku-tip-row', key: 'tr-' + entry.metric.key },
                h('span', { className: 'tku-tip-label' },
                  h('span', { className: 'tku-tip-swatch', style: { background: entry.metric.color } }),
                  t(entry.metric.label)),
                h('span', { className: 'tku-tip-value' }, formatFull(entry.values[hover])));
            }),
            h('div', { className: 'tku-tip-row' },
              h('span', { className: 'tku-tip-label' }, t('ui.total')),
              h('span', { className: 'tku-tip-value' }, formatFull(buckets[hover].total))))
        : null;

      return h('div', { className: 'tku-plot-wrap', ref: wrapRef }, svg, tip);
    }

    function ApiChips(props) {
      const apis = props.apis;
      const selected = props.selected;
      const colors = props.colors;
      const t = props.t;
      const allOn = selected === null;
      // Hide the row entirely when a single API exists: there is nothing to
      // filter, and the chip would only repeat the breakdown heading.
      if (apis.length < 2) return null;

      return h('div', { className: 'tku-chips' },
        h('button', {
          type: 'button',
          className: 'tku-chip',
          'data-on': String(allOn),
          onClick: function () { props.onToggleAll(); },
        },
          h('span', { className: 'tku-chip-name' }, t('ui.apiAll')),
          h('span', { className: 'tku-chip-total' }, String(apis.length))),
        apis.map(function (a) {
          const key = seriesKeyOf(a.provider, a.model);
          const on = allOn || selected.has(key);
          return h('button', {
            key: key,
            type: 'button',
            className: 'tku-chip',
            'data-on': String(on),
            title: a.provider + ' / ' + a.model + ' — ' + formatFull(a.total),
            onClick: function () { props.onToggle(key); },
          },
            h('span', { className: 'tku-chip-dot', style: { background: colors[key] || '#888' } }),
            h('span', { className: 'tku-chip-name' }, a.provider + ' / ' + a.model),
            h('span', { className: 'tku-chip-total' }, formatCount(a.total)));
        }));
    }

    function BreakdownTable(props) {
      const combos = props.combos;
      const colors = props.colors;
      const t = props.t;
      const totalAll = combos.reduce(function (acc, c) { return acc + (c.total || 0); }, 0);
      const maxTotal = combos.reduce(function (acc, c) { return Math.max(acc, c.total || 0); }, 0);

      const head = h('thead', null, h('tr', null,
        h('th', null, t('ui.provider')),
        h('th', null, t('ui.model')),
        h('th', null, t('ui.input')),
        h('th', null, t('ui.output')),
        h('th', null, t('ui.cacheRead')),
        h('th', null, t('ui.cacheWrite')),
        h('th', null, t('ui.calls')),
        h('th', null, t('ui.total')),
        h('th', null, t('ui.share'))));

      const rows = combos.map(function (c) {
        const key = seriesKeyOf(c.provider, c.model);
        const share = totalAll > 0 ? ((c.total / totalAll) * 100).toFixed(1) + '%' : '—';
        const barW = maxTotal > 0 ? Math.max(2, Math.round((c.total / maxTotal) * 44)) : 2;
        return h('tr', { key: key },
          h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h('span', { className: 'tku-chip-dot', style: { background: colors[key] || '#888' } }),
            c.provider)),
          h('td', null, h('span', { className: 'tku-mono' }, c.model)),
          h('td', null, formatFull(c.input)),
          h('td', null, formatFull(c.output)),
          h('td', null, formatFull(c.cacheRead)),
          h('td', null, formatFull(c.cacheWrite)),
          h('td', null, formatFull(c.calls)),
          h('td', null, h('span', { className: 'tku-bar-cell' },
            h('span', { className: 'tku-bar-mini', style: { width: barW, background: colors[key] || '#888' } }),
            h('strong', null, formatFull(c.total)))),
          h('td', null, share));
      });

      return h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tku-table' }, head, h('tbody', null, rows)));
    }

    // ---------------------------------------------------------------------
    // Dashboard
    // ---------------------------------------------------------------------

    const RANGE_OPTIONS = [
      { value: 'today', key: 'ui.today' },
      { value: 'yesterday', key: 'ui.yesterday' },
      { value: 'last7', key: 'ui.last7' },
      { value: 'last30', key: 'ui.last30' },
      { value: 'thisMonth', key: 'ui.thisMonth' },
      { value: 'lastMonth', key: 'ui.lastMonth' },
      { value: 'custom', key: 'ui.custom' },
    ];

    function Dashboard(props) {
      const t = props.t;
      const sessionId = props.sessionId;

      const now = Date.now();
      const rangeState = React.useState('last30');
      const rangeKind = rangeState[0];
      const setRangeKind = rangeState[1];
      const fromState = React.useState(formatDateInput(now - 13 * DAY_MS));
      const customFrom = fromState[0];
      const setCustomFrom = fromState[1];
      const toState = React.useState(formatDateInput(now));
      const customTo = toState[0];
      const setCustomTo = toState[1];
      const scopeState = React.useState('all');
      const scope = scopeState[0];
      const setScope = scopeState[1];
      const bucketState = React.useState('day');
      const bucket = bucketState[0];
      const setBucket = bucketState[1];
      const touchedState = React.useState(false);
      const bucketTouched = touchedState[0];
      const setBucketTouched = touchedState[1];
      const hiddenState = React.useState({});
      const hiddenMetrics = hiddenState[0];
      const setHiddenMetrics = hiddenState[1];
      const selState = React.useState(null); // null = every API
      const selectedApis = selState[0];
      const setSelectedApis = selState[1];
      const nonceState = React.useState(0);
      const nonce = nonceState[0];
      const setNonce = nonceState[1];
      const stateState = React.useState({ status: 'loading', data: null, error: null });
      const state = stateState[0];
      const setState = stateState[1];

      const win = React.useMemo(function () {
        return rangeWindow(rangeKind, customFrom, customTo);
      }, [rangeKind, customFrom, customTo]);

      const rangeValid = win !== null;

      // Granularity follows the window unless the user overrode it after the
      // last range change; switching the range re-arms the automatic choice.
      const effectiveBucket = bucketTouched ? bucket : (win ? autoBucket(win.from, win.to) : 'day');

      const winFrom = win ? win.from : -1;
      const winTo = win ? win.to : -1;

      React.useEffect(function () {
        if (!win) return undefined;
        const controller = new AbortController();
        let alive = true;
        setState(function (prev) { return { status: 'loading', data: prev.data, error: null }; });
        fetchUsage({
          from: win.from,
          to: win.to,
          bucket: effectiveBucket,
          sessionId: scope === 'session' ? sessionId : '',
          refresh: nonce > 0,
        }, controller.signal).then(function (data) {
          if (!alive) return;
          setState({ status: 'ready', data: data, error: null });
        }).catch(function (err) {
          if (!alive || (err && err.name === 'AbortError')) return;
          setState({ status: 'error', data: null, error: String((err && err.message) || err) });
        });
        return function () { alive = false; controller.abort(); };
      }, [winFrom, winTo, effectiveBucket, scope, sessionId, nonce]);

      const data = state.data;

      // Stable API colours: the roster order comes from the payload, so an API
      // keeps its hue while only the time range or the filter changes.
      const colors = React.useMemo(function () {
        const map = {};
        if (!data || !Array.isArray(data.combos)) return map;
        data.combos.forEach(function (c, i) {
          map[seriesKeyOf(c.provider, c.model)] = API_PALETTE[i % API_PALETTE.length];
        });
        return map;
      }, [data]);

      const apis = (data && Array.isArray(data.combos)) ? data.combos : [];

      React.useEffect(function () {
        const live = new Set(apis.map(function (a) { return seriesKeyOf(a.provider, a.model); }));
        setSelectedApis(function (prev) {
          if (prev === null) return prev;
          const next = new Set();
          let changed = false;
          prev.forEach(function (k) { if (live.has(k)) next.add(k); else changed = true; });
          if (!changed) return prev;
          return next.size === 0 ? null : next;
        });
      }, [data]);

      // A bucket's series is [rosterIndex, input, output, cacheRead, cacheWrite,
      // calls]. The roster itself lives once at the top of the payload, so a
      // few hundred buckets do not repeat every provider/model string.
      const selectedIndexes = React.useMemo(function () {
        if (selectedApis === null) return null;
        const set = new Set();
        apis.forEach(function (a, i) {
          if (selectedApis.has(seriesKeyOf(a.provider, a.model))) set.add(i);
        });
        return set;
      }, [apis, selectedApis]);

      // Filtering the roster costs no request: the per-API split already
      // travels inside every bucket, so the lines are recomputed locally.
      const buckets = React.useMemo(function () {
        const rows = (data && Array.isArray(data.buckets)) ? data.buckets : [];
        if (selectedIndexes === null) return rows;
        return rows.map(function (b) {
          const acc = { key: b.key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, total: 0, cache: 0 };
          (b.series || []).forEach(function (row) {
            if (!selectedIndexes.has(row[0])) return;
            acc.input += row[1] || 0;
            acc.output += row[2] || 0;
            acc.cacheRead += row[3] || 0;
            acc.cacheWrite += row[4] || 0;
            acc.calls += row[5] || 0;
          });
          acc.total = acc.input + acc.output + acc.cacheRead + acc.cacheWrite;
          acc.cache = acc.cacheRead + acc.cacheWrite;
          return acc;
        });
      }, [data, selectedIndexes]);

      const visibleMetrics = React.useMemo(function () {
        return METRICS.filter(function (m) { return !hiddenMetrics[m.key]; });
      }, [hiddenMetrics]);

      const sums = React.useMemo(function () {
        const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, total: 0 };
        buckets.forEach(function (b) {
          acc.input += b.input || 0;
          acc.output += b.output || 0;
          acc.cacheRead += b.cacheRead || 0;
          acc.cacheWrite += b.cacheWrite || 0;
          acc.calls += b.calls || 0;
          acc.total += b.total || 0;
        });
        return acc;
      }, [buckets]);

      const visibleCombos = React.useMemo(function () {
        if (selectedApis === null) return apis;
        return apis.filter(function (a) { return selectedApis.has(seriesKeyOf(a.provider, a.model)); });
      }, [apis, selectedApis]);

      function selectRange(kind) {
        setRangeKind(kind);
        setBucketTouched(false);
      }

      function selectBucket(next) {
        setBucket(next);
        setBucketTouched(true);
      }

      function toggleMetric(key) {
        setHiddenMetrics(function (prev) {
          const next = Object.assign({}, prev);
          if (next[key]) delete next[key];
          else next[key] = true;
          return next;
        });
      }

      function toggleApi(key) {
        setSelectedApis(function (prev) {
          const base = prev === null
            ? new Set(apis.map(function (a) { return seriesKeyOf(a.provider, a.model); }))
            : new Set(prev);
          if (base.has(key)) base.delete(key);
          else base.add(key);
          // "Everything on" and "nothing on" both collapse to the unfiltered
          // view: an empty chart is never a useful resting state.
          if (base.size === apis.length || base.size === 0) return null;
          return base;
        });
      }

      function toggleAllApis() {
        setSelectedApis(null);
      }

      function refresh() {
        setNonce(function (v) { return v + 1; });
      }

      const header = h('div', { className: 'tku-head' },
        h('div', { className: 'tku-title' }, t('view.label')),
        h('div', { className: 'tku-sub' }, scope === 'session' ? t('ui.sessionNote') : t('ui.globalNote')));

      const customBlock = rangeKind === 'custom'
        ? h('div', { className: 'tku-custom' },
            h('input', {
              className: 'tku-date',
              type: 'date',
              value: customFrom,
              max: customTo,
              onChange: function (e) { setCustomFrom(e.target.value); },
              'aria-label': t('ui.range') + ' 1',
            }),
            h('span', { className: 'tku-group-label' }, t('ui.to')),
            h('input', {
              className: 'tku-date',
              type: 'date',
              value: customTo,
              min: customFrom,
              onChange: function (e) { setCustomTo(e.target.value); },
              'aria-label': t('ui.range') + ' 2',
            }),
            h('span', { className: 'tku-note-warn' },
              !rangeValid ? t('ui.customInvalid') : t('ui.customHint', { days: MAX_CUSTOM_DAYS })))
        : null;

      const rangeOptions = RANGE_OPTIONS.map(function (r) {
        return { value: r.value, label: t(r.key) };
      });

      const bucketOptions = [
        { value: 'hour', label: t('ui.hour') },
        { value: 'day', label: t('ui.day') },
        { value: 'month', label: t('ui.month') },
      ];

      const toolbar = h('div', { className: 'tku-toolbar' },
        h('div', { className: 'tku-group' },
          h('span', { className: 'tku-group-label' }, t('ui.scope')),
          h(Segmented, {
            label: t('ui.scope'),
            value: scope,
            onChange: setScope,
            options: [
              { value: 'session', label: t('ui.scopeSession') },
              { value: 'all', label: t('ui.scopeAll') },
            ],
          })),
        h('div', { className: 'tku-group' },
          h('span', { className: 'tku-group-label' }, t('ui.range')),
          h(Segmented, {
            label: t('ui.range'),
            value: rangeKind,
            onChange: selectRange,
            options: rangeOptions,
          })),
        customBlock,
        h('div', { className: 'tku-group' },
          h('span', { className: 'tku-group-label' }, t('ui.granularity')),
          h(Segmented, {
            label: t('ui.granularity'),
            value: effectiveBucket,
            onChange: selectBucket,
            options: bucketOptions,
          })));

      function retryButton() {
        return h('button', { type: 'button', className: 'tku-btn', onClick: refresh }, t('ui.retry'));
      }

      if (!rangeValid) {
        return h('div', { className: 'tku-root' }, header, toolbar,
          h('div', { className: 'tku-state' }, t('ui.customInvalid')));
      }
      if (state.status === 'loading' && !data) {
        return h('div', { className: 'tku-root' }, header, toolbar,
          h('div', { className: 'tku-state' }, t('ui.loading')));
      }
      if (state.status === 'error' && !data) {
        return h('div', { className: 'tku-root' }, header, toolbar,
          h('div', { className: 'tku-state' },
            h('div', null, t('ui.error')),
            h('div', { style: { fontSize: 11 } }, state.error || ''),
            retryButton()));
      }

      const calls = sums.calls;
      const cacheTotal = sums.cacheRead + sums.cacheWrite;

      const cards = h('div', { className: 'tku-cards' },
        h(StatCard, {
          label: t('ui.total'),
          value: formatCount(sums.total),
          full: formatFull(sums.total),
          note: formatFull(calls) + ' ' + t('ui.calls'),
        }),
        h(StatCard, { label: t('ui.input'), value: formatCount(sums.input), full: formatFull(sums.input) }),
        h(StatCard, { label: t('ui.output'), value: formatCount(sums.output), full: formatFull(sums.output) }),
        h(StatCard, {
          label: t('ui.cache'),
          value: formatCount(cacheTotal),
          full: formatFull(cacheTotal),
          note: sums.total > 0 ? ((cacheTotal / sums.total) * 100).toFixed(1) + '%' : undefined,
        }),
        h(StatCard, {
          label: t('ui.avg'),
          value: calls > 0 ? formatCount(Math.round(sums.total / calls)) : '—',
          note: calls > 0 ? formatFull(calls) + ' ' + t('ui.calls') : undefined,
        }),
        h(StatCard, {
          label: t('ui.api'),
          value: String(apis.length),
          note: selectedApis === null ? t('ui.apiAll') : t('ui.apiSelected', { n: selectedApis.size, total: apis.length }),
        }));

      if (!(sums.total > 0)) {
        return h('div', { className: 'tku-root' }, header, toolbar, cards,
          h('div', { className: 'tku-state' },
            h('div', null, t('ui.empty')),
            h('div', { style: { fontSize: 11 } }, t('ui.emptyHint'))));
      }

      const chartPanel = h('div', { className: 'tku-panel' },
        h('div', { className: 'tku-panel-head' },
          h('div', { className: 'tku-panel-title' }, t('ui.timeline')),
          h('div', { className: 'tku-panel-note' }, t('ui.legendHint'))),
        h(ApiChips, {
          apis: apis,
          selected: selectedApis,
          colors: colors,
          t: t,
          onToggle: toggleApi,
          onToggleAll: toggleAllApis,
        }),
        h(LineChart, {
          buckets: buckets,
          metrics: visibleMetrics,
          bucket: effectiveBucket,
          t: t,
        }),
        h('div', { className: 'tku-legend' },
          METRICS.map(function (m) {
            const off = Boolean(hiddenMetrics[m.key]);
            const sum = m.key === 'input' ? sums.input
              : m.key === 'output' ? sums.output
              : m.key === 'cacheRead' ? sums.cacheRead
              : sums.cacheWrite;
            return h('button', {
              key: m.key,
              type: 'button',
              className: 'tku-legend-item',
              'data-off': String(off),
              onClick: function () { toggleMetric(m.key); },
            },
              h('span', { className: 'tku-chip-dot', style: { background: m.color } }),
              h('span', null, t(m.label)),
              h('span', { className: 'tku-legend-total' }, formatCount(sum)));
          })));

      const scan = data.scan || {};
      const tablePanel = h('div', { className: 'tku-panel' },
        h('div', { className: 'tku-panel-head' },
          h('div', { className: 'tku-panel-title' }, t('ui.breakdown')),
          h('div', { className: 'tku-panel-note' },
            t('ui.apiCount', { n: apis.length }) +
            ' · ' + t('ui.scanned', { sessions: scan.scanned || 0 }) +
            (scan.failed ? t('ui.failed', { n: scan.failed }) : ''))),
        h(BreakdownTable, { combos: visibleCombos, colors: colors, t: t }));

      const foot = h('div', { className: 'tku-foot' },
        h('span', null, t('ui.hint')),
        h('span', null, t('ui.took', { ms: data.tookMs || 0 })),
        h('button', {
          type: 'button',
          className: 'tku-btn',
          style: { padding: '2px 8px', fontSize: 11 },
          onClick: refresh,
        }, t('ui.refresh')));

      return h('div', { className: 'tku-root' }, header, toolbar, cards, chartPanel, tablePanel, foot);
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(installStyles, 'dsh-token-usage: stylesheet');

        // The base lookup is swapped in once the locale service is reachable.
        // It is wrapped because a raw key must never reach the screen.
        let lookup = function (key) { return key; };

        function interpolate(text, args) {
          if (!args) return text;
          return String(text).replace(/\{(\w+)\}/g, function (m, name) {
            return args[name] === undefined ? m : String(args[name]);
          });
        }

        function tr(key, args) {
          let text;
          try { text = lookup(key); } catch (err) { text = undefined; }
          if (text === undefined || text === null || text === '') text = key;
          return interpolate(text, args);
        }

        ctx.effect(function () {
          const locale = ctx.get('locale');
          if (!locale) return function () {};
          const disposers = [];
          if (typeof locale.register === 'function') {
            disposers.push(locale.register(NS, 'zh', ZH));
            disposers.push(locale.register(NS, 'en', EN));
          }
          if (typeof locale.bind === 'function') lookup = locale.bind(NS);
          return function () {
            lookup = function (key) { return key; };
            disposers.forEach(function (dispose) {
              try { dispose(); } catch (err) { /* disposer must stay idempotent */ }
            });
          };
        }, 'dsh-token-usage: locale dictionaries');

        function TokenUsageView(props) {
          const translate = props && typeof props.t === 'function' ? props.t : tr;
          return h('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h(Dashboard, { t: translate, sessionId: props && props.sessionId }));
        }

        // The shipped tabs are 'chat' (order 0) and 'trajectory' (order 10);
        // 20 places this view directly after Trajectory in the same View row.
        ctx.slots.inject('conversation.view', function () {
          return ctx.slots.register({
            name: 'conversation.view',
            id: 'token-usage',
            order: 20,
            locale: NS,
            label: function () { return tr('view.label'); },
          }, TokenUsageView);
        });
      },
    };
  },
});
