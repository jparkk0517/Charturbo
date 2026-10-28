/**
 * Built-in strings of chart-sparkline.ts (the canvas aria-label). Numbers arrive already
 * formatted in the chart locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** `name: text` (the aria-label head) */
  labelled: (name: string, text: string) => `${name}: ${text}`,
  /** Rising / falling trend; `pct` is the absolute change without `%` (null when undefined) */
  trendUp: (pct: string | null, from: string, to: string, min: string, max: string) =>
    `trend up${pct ? ` ${pct}%` : ''} from ${from} to ${to}, min ${min}, max ${max}`,
  trendDown: (pct: string | null, from: string, to: string, min: string, max: string) =>
    `trend down${pct ? ` ${pct}%` : ''} from ${from} to ${to}, min ${min}, max ${max}`,
  /** Single value, or first = last */
  flat: (value: string) => `flat at ${value}`,
  flatRange: (value: string, min: string, max: string) => `flat at ${value}, min ${min}, max ${max}`,
  wins: (n: number, count: string) => `${count} ${plural(n, 'win', 'wins')}`,
  losses: (n: number, count: string) => `${count} ${plural(n, 'loss', 'losses')}`,
  ties: (n: number, count: string) => `${count} ${plural(n, 'tie', 'ties')}`,
  win: 'win',
  loss: 'loss',
  tie: 'tie',
  /** Win / loss tally followed by the latest result */
  winLossLast: (tally: string, last: string) => `${tally}, last: ${last}`,
};

export type SparklineMessages = typeof en;

const ko: SparklineMessages = {
  labelled: (name, text) => `${name}: ${text}`,
  trendUp: (pct, from, to, min, max) => `${from}에서 ${to}까지${pct ? ` ${pct}%` : ''} 상승, 최솟값 ${min}, 최댓값 ${max}`,
  trendDown: (pct, from, to, min, max) => `${from}에서 ${to}까지${pct ? ` ${pct}%` : ''} 하락, 최솟값 ${min}, 최댓값 ${max}`,
  flat: (value) => `${value} 유지`,
  flatRange: (value, min, max) => `${value} 유지, 최솟값 ${min}, 최댓값 ${max}`,
  wins: (_n, count) => `${count}승`,
  losses: (_n, count) => `${count}패`,
  ties: (_n, count) => `${count}무`,
  win: '승',
  loss: '패',
  tie: '무',
  winLossLast: (tally, last) => `${tally}, 최근 결과: ${last}`,
};

const zh: SparklineMessages = {
  labelled: (name, text) => `${name}：${text}`,
  trendUp: (pct, from, to, min, max) => `上升${pct ? ` ${pct}%` : ''}，从 ${from} 到 ${to}，最小值 ${min}，最大值 ${max}`,
  trendDown: (pct, from, to, min, max) => `下降${pct ? ` ${pct}%` : ''}，从 ${from} 到 ${to}，最小值 ${min}，最大值 ${max}`,
  flat: (value) => `持平于 ${value}`,
  flatRange: (value, min, max) => `持平于 ${value}，最小值 ${min}，最大值 ${max}`,
  wins: (_n, count) => `${count} 胜`,
  losses: (_n, count) => `${count} 负`,
  ties: (_n, count) => `${count} 平`,
  win: '胜',
  loss: '负',
  tie: '平',
  winLossLast: (tally, last) => `${tally}，最近结果：${last}`,
};

export const SPARKLINE_MESSAGES = { en, ko, 'zh-CN': zh } as const;
