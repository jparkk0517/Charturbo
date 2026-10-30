// Documentation site (VitePress). English lives at the root, Korean under /ko/, Simplified
// Chinese under /zh/. Every page exists in all three locales with the same slug; the sidebar
// below is generated from one table so the three navigations never drift apart.
import { defineConfig, type DefaultTheme } from 'vitepress';
import { THEME_BOOT_SCRIPT } from './theme/site-theme';

type Lang = 'en' | 'ko' | 'zh';
type Title = Record<Lang, string>;
interface Group {
  title: Title;
  dir: string;
  pages: [slug: string, title: Title][];
}

const t = (en: string, ko: string, zh: string): Title => ({ en, ko, zh });

const GUIDE: Group[] = [
  {
    title: t('Introduction', '소개', '介绍'),
    dir: 'guide',
    pages: [
      ['introduction', t('What is Charturbo?', 'Charturbo란?', '什么是 Charturbo？')],
      ['getting-started', t('Getting Started', '시작하기', '快速开始')],
      ['installation', t('Installation & Bundlers', '설치와 번들러', '安装与打包工具')],
      ['core-concepts', t('Core Concepts', '핵심 개념', '核心概念')],
    ],
  },
  {
    title: t('Essentials', '기본 기능', '基础功能'),
    dir: 'guide',
    pages: [
      ['data-and-axes', t('Data & Axes', '데이터와 축', '数据与坐标轴')],
      ['multiple-axes', t('Multiple Axes & Axis Breaks', '다중 축과 축 끊김', '多坐标轴与坐标轴断裂')],
      ['interactions', t('Interactions', '상호작용', '交互')],
      ['editing', t('Editing Data Points', '데이터 포인트 편집', '编辑数据点')],
      ['tooltips', t('Tooltips & Hover', '툴팁과 hover', '提示框与悬停')],
      ['styling', t('Styling & Themes', '스타일과 테마', '样式与主题')],
      ['annotations', t('Annotations', '주석', '标注')],
      ['rich-labels', t('Rich Text Labels', '리치 텍스트 라벨', '富文本标签')],
      ['number-format', t('Number & Date Formats', '숫자·날짜 형식', '数字与日期格式')],
      ['streaming', t('Real-time Streaming', '실시간 스트리밍', '实时数据流')],
      ['dashboard-sync', t('Dashboard Sync', '대시보드 동기화', '仪表盘联动')],
    ],
  },
  {
    title: t('Features', '부가 기능', '扩展功能'),
    dir: 'guide',
    pages: [
      ['i18n', t('Internationalization', '다국어 지원', '国际化')],
      ['accessibility', t('Accessibility', '접근성', '无障碍')],
      ['export', t('Export: PNG · SVG · PDF', '내보내기: PNG · SVG · PDF', '导出：PNG · SVG · PDF')],
      ['loading-watermark', t('Loading & Watermarks', '로딩 표시와 워터마크', '加载提示与水印')],
      ['animation', t('Animation', '애니메이션', '动画')],
      ['shared-device', t('Shared GPU Device', '공유 GPU 디바이스', '共享 GPU 设备')],
    ],
  },
  {
    title: t('Frameworks', '프레임워크', '框架集成'),
    dir: 'guide',
    pages: [
      ['react', t('React', 'React', 'React')],
      ['vue', t('Vue', 'Vue', 'Vue')],
    ],
  },
  {
    title: t('More', '더 보기', '更多'),
    dir: 'guide',
    pages: [
      ['performance', t('Performance', '성능', '性能')],
      ['faq', t('FAQ & Troubleshooting', 'FAQ · 문제 해결', '常见问题与故障排查')],
      ['migration', t('Changelog & Migration', '변경 기록 · 마이그레이션', '更新日志与迁移')],
    ],
  },
];

const CHARTS: Group[] = [
  {
    title: t('Cartesian', '직교 좌표 차트', '直角坐标系图表'),
    dir: 'charts',
    pages: [
      ['line', t('Line', '선', '折线图')],
      ['area', t('Area', '영역', '面积图')],
      ['theme-river', t('ThemeRiver', '테마 리버', '主题河流图')],
      ['band', t('Band · Range', '밴드 · 범위', '带状图 · 范围图')],
      ['errorbar-impulse', t('Error Bar · Impulse', '오차 막대 · 임펄스', '误差棒 · 脉冲图')],
      ['bar', t('Bar', '막대', '柱状图')],
      ['pictorial-bar', t('Pictorial Bar', '픽토리얼 막대', '象形柱图')],
      ['histogram', t('Histogram', '히스토그램', '直方图')],
      ['scatter', t('Scatter · Bubble', '산점도 · 버블', '散点图 · 气泡图')],
      ['candlestick', t('Candlestick · OHLC', '캔들스틱 · OHLC', 'K 线图 · OHLC')],
      ['heatmap', t('Heatmap', '히트맵', '热力图')],
      ['calendar', t('Calendar Heatmap', '캘린더 히트맵', '日历热力图')],
      ['box-violin', t('Box Plot · Violin', '박스 플롯 · 바이올린', '箱线图 · 小提琴图')],
      ['combo', t('Combo', '콤보', '组合图')],
    ],
  },
  {
    title: t('Business', '비즈니스 차트', '商业图表'),
    dir: 'charts',
    pages: [
      ['pie', t('Pie · Donut', '파이 · 도넛', '饼图 · 环形图')],
      ['radar', t('Radar', '레이더', '雷达图')],
      ['gauge', t('Gauge', '게이지', '仪表盘')],
      ['funnel', t('Funnel', '퍼널', '漏斗图')],
      ['waterfall', t('Waterfall', '워터폴', '瀑布图')],
      ['parallel', t('Parallel Coordinates', '평행 좌표', '平行坐标')],
      ['polar', t('Polar Coordinates', '극좌표', '极坐标')],
      ['sparkline', t('Sparkline', '스파크라인', '迷你图')],
    ],
  },
  {
    title: t('Hierarchy & Flow', '계층 · 흐름', '层级与流向'),
    dir: 'charts',
    pages: [
      ['treemap-sunburst', t('Treemap · Sunburst', '트리맵 · 선버스트', '矩形树图 · 旭日图')],
      ['sankey', t('Sankey', '생키', '桑基图')],
      ['tree', t('Tree', '트리', '树图')],
      ['graph-2d', t('2D Graph', '2D 그래프', '2D 关系图')],
      ['chord', t('Chord', '코드 다이어그램', '和弦图')],
    ],
  },
  {
    title: t('3D', '3D', '3D'),
    dir: 'charts',
    pages: [
      ['scientific-3d', t('PointCloud3D · Surface3D', 'PointCloud3D · Surface3D', 'PointCloud3D · Surface3D')],
      ['graph-3d', t('3D Network Graph', '3D 네트워크 그래프', '3D 网络图')],
      ['embeddings', t('Embeddings · Similarity', '임베딩 · 유사도', '嵌入向量 · 相似度')],
      ['scene-3d', t('3D Scene · Physics', '3D 장면 · 물리', '3D 场景 · 物理')],
    ],
  },
];

const CONTRIBUTING: Group[] = [
  {
    title: t('Contributing', '기여하기', '参与贡献'),
    dir: 'contributing',
    pages: [
      ['development', t('Development', '개발 환경', '开发环境')],
      ['releasing', t('Releasing', '배포 절차', '发布流程')],
      ['benchmarks', t('Benchmark Methodology', '벤치마크 방법', '基准测试方法')],
    ],
  },
];

/** Every page slug of the site, used by the locale-parity check (scripts/check-docs.mjs). */
export const PAGES = [...GUIDE, ...CHARTS, ...CONTRIBUTING].flatMap((g) => g.pages.map(([slug]) => `${g.dir}/${slug}`));

const prefix = (lang: Lang) => (lang === 'en' ? '/' : `/${lang}/`);

function sidebar(lang: Lang, groups: Group[]): DefaultTheme.SidebarItem[] {
  return groups.map((g) => ({
    text: g.title[lang],
    collapsed: false,
    items: g.pages.map(([slug, title]) => ({ text: title[lang], link: `${prefix(lang)}${g.dir}/${slug}` })),
  }));
}

const UI: Record<Lang, { guide: string; charts: string; api: string; examples: string; playground: string; benchmarks: string; contributing: string }> = {
  en: { guide: 'Guide', charts: 'Charts', api: 'API', examples: 'Examples', playground: 'Playground', benchmarks: 'Benchmarks', contributing: 'Contributing' },
  ko: { guide: '가이드', charts: '차트', api: 'API', examples: '예제', playground: '플레이그라운드', benchmarks: '벤치마크', contributing: '기여하기' },
  zh: { guide: '指南', charts: '图表', api: 'API', examples: '示例', playground: '演练场', benchmarks: '基准测试', contributing: '参与贡献' },
};

/** Default-theme labels that VitePress ships only in English */
const THEME_TEXT: Record<Exclude<Lang, 'en'>, Partial<DefaultTheme.Config>> = {
  ko: {
    outline: { label: '이 페이지에서' },
    docFooter: { prev: '이전', next: '다음' },
    lastUpdated: { text: '마지막 수정' },
    editLink: { pattern: 'https://github.com/jparkk0517/Charturbo/edit/main/docs/:path', text: 'GitHub에서 이 페이지 수정' },
    returnToTopLabel: '맨 위로',
    sidebarMenuLabel: '메뉴',
    darkModeSwitchLabel: '다크 모드',
    lightModeSwitchTitle: '라이트 모드로 전환',
    darkModeSwitchTitle: '다크 모드로 전환',
    langMenuLabel: '언어 변경',
    notFound: { title: '페이지를 찾을 수 없습니다', quote: '주소를 확인하거나 첫 페이지로 이동하세요.', linkText: '첫 페이지로', linkLabel: '첫 페이지로 이동' },
  },
  zh: {
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    editLink: { pattern: 'https://github.com/jparkk0517/Charturbo/edit/main/docs/:path', text: '在 GitHub 上编辑此页' },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '深色模式',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    langMenuLabel: '切换语言',
    notFound: { title: '页面未找到', quote: '请检查地址，或返回首页。', linkText: '返回首页', linkLabel: '前往首页' },
  },
};

const SEARCH_TEXT: Record<Exclude<Lang, 'en'>, DefaultTheme.LocalSearchOptions['translations']> = {
  ko: {
    button: { buttonText: '검색', buttonAriaLabel: '검색' },
    modal: {
      displayDetails: '상세 목록 표시',
      resetButtonTitle: '검색어 지우기',
      backButtonTitle: '검색 닫기',
      noResultsText: '결과가 없습니다',
      footer: { selectText: '선택', navigateText: '이동', closeText: '닫기' },
    },
  },
  zh: {
    button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
    modal: {
      displayDetails: '显示详细列表',
      resetButtonTitle: '清除查询',
      backButtonTitle: '关闭搜索',
      noResultsText: '没有结果',
      footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
    },
  },
};

// One site: the examples (home, gallery, benchmarks) at the root and these docs under docs/
// (pages.yml; locally `npm run site:dev` in web/ proxies /docs/ to this dev server).
const BASE = process.env.DOCS_BASE ?? '/docs/';
const SITE_ROOT = BASE.replace(/docs\/$/, '');
// Pages link the examples by their published URL, which also works on GitHub; the site build
// rewrites those links to SITE_ROOT so they stay on the same host (local dev, previews).
const PUBLISHED_SITE = 'https://jparkk0517.github.io/Charturbo/';

/** Examples-site URL for `rest` (e.g. `line.html#06-band`), keeping the page language. */
function siteHref(rest: string, lang: Lang, root = SITE_ROOT): string {
  const [path, hash] = rest.split('#');
  return `${root}${path}?lang=${lang}${hash ? `#${hash}` : ''}`;
}
const langOf = (relativePath: string): Lang => (relativePath.startsWith('ko/') ? 'ko' : relativePath.startsWith('zh/') ? 'zh' : 'en');

function themeConfig(lang: Lang): DefaultTheme.Config {
  const p = prefix(lang);
  const ui = UI[lang];
  return {
    nav: [
      { text: ui.guide, link: `${p}guide/getting-started`, activeMatch: `^${p}guide/` },
      { text: ui.charts, link: `${p}charts/line`, activeMatch: `^${p}charts/` },
      // TypeDoc output (npm run docs) is copied verbatim from docs/public/api/; English only
      { text: ui.api, link: '/api/index.html', target: '_self' },
      { component: 'SiteLink', props: { text: ui.examples, path: 'gallery.html' } },
      { component: 'SiteLink', props: { text: ui.playground, path: 'playground.html' } },
      { component: 'SiteLink', props: { text: ui.benchmarks, path: 'benchmarks.html' } },
    ],
    // The logo leads to the site home, not the docs home
    logoLink: { link: siteHref('index.html', lang), target: '_self' },
    sidebar: {
      [`${p}guide/`]: sidebar(lang, GUIDE),
      [`${p}charts/`]: sidebar(lang, CHARTS),
      [`${p}contributing/`]: sidebar(lang, CONTRIBUTING),
    },
    ...(lang === 'en' ? {} : THEME_TEXT[lang]),
  };
}

export default defineConfig({
  title: 'Charturbo',
  base: BASE,
  // Light / dark follows the OS until chosen; the site theme (data-theme) is set before first
  // paint by THEME_BOOT_SCRIPT, as on the examples pages
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  // Bench raw output, the agent hand-off note and the ECharts parity checklist are not pages;
  // public/ is copied as-is (the TypeDoc output there carries its own .md files)
  srcExclude: ['bench/**', 'public/**', 'HANDOFF.md', 'ECHARTS-PARITY.md'],
  head: [
    ['meta', { name: 'theme-color', content: '#080b12', media: '(prefers-color-scheme: dark)' }],
    ['meta', { name: 'theme-color', content: '#f6f8fb', media: '(prefers-color-scheme: light)' }],
    ['script', {}, THEME_BOOT_SCRIPT],
  ],
  markdown: {
    config(md) {
      const linkOpen = md.renderer.rules.link_open!;
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet('href');
        if (!href?.startsWith(PUBLISHED_SITE)) return linkOpen(tokens, idx, options, env, self);
        // A full page load: the router would look for a docs page at that path
        tokens[idx].attrSet('href', siteHref(href.slice(PUBLISHED_SITE.length), langOf(env.relativePath)));
        tokens[idx].attrSet('target', '_self');
        return self.renderToken(tokens, idx, options);
      };
    },
  },
  transformPageData(page) {
    // Hero buttons prefix every `/...` link with the docs base, so these are relative: one `../`
    // per directory of the page URL, plus one for docs/ itself
    const up = '../'.repeat(page.relativePath.split('/').length);
    for (const action of page.frontmatter.hero?.actions ?? []) {
      if (!action.link?.startsWith(PUBLISHED_SITE)) continue;
      action.link = siteHref(action.link.slice(PUBLISHED_SITE.length), langOf(page.relativePath), up);
      action.target = '_self';
    }
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      description: 'GPU-accelerated charts for the web, built with Rust and WebGPU.',
      themeConfig: themeConfig('en'),
    },
    ko: {
      label: '한국어',
      lang: 'ko-KR',
      description: 'Rust와 WebGPU로 만든 대용량 웹 차트 라이브러리.',
      themeConfig: themeConfig('ko'),
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '基于 Rust 与 WebGPU 的高性能 Web 图表库。',
      themeConfig: themeConfig('zh'),
    },
  },
  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/jparkk0517/Charturbo' }],
    editLink: { pattern: 'https://github.com/jparkk0517/Charturbo/edit/main/docs/:path' },
    search: { provider: 'local', options: { locales: { ko: { translations: SEARCH_TEXT.ko }, zh: { translations: SEARCH_TEXT.zh } } } },
    footer: { message: 'MIT License', copyright: '© Charturbo contributors' },
  },
});
