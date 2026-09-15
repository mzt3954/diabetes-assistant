/**
 * eslint.config.js — ESLint 9 扁平配置
 * ---------------------------------------------------------------------------
 * 本项目是「零构建」的静态前端：js/*.js 是直接由 <script> 加载的浏览器脚本
 * （IIFE + window 全局，ES5 风格），tests/*.js 是 CommonJS 的 Node 脚本。
 * 因此分两套环境分别校验。
 *
 * 规则取舍：
 *   - 打开「真会出 bug」的规则（no-undef / no-redeclare / no-dupe-keys /
 *     no-unreachable / valid-typeof / use-isnan / no-cond-assign …）
 *   - 关闭纯风格规则（no-var / prefer-const），因为 ES5 写法是刻意选择
 *     （项目要求零构建、不依赖 Babel，且要兼容 jsdom 与旧浏览器）
 * 运行：npx eslint js tests
 * ---------------------------------------------------------------------------
 */
'use strict';

/** 浏览器端脚本可见的全局对象 */
const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  history: 'readonly', screen: 'readonly', frames: 'readonly', self: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly',
  fetch: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  XMLHttpRequest: 'readonly', WebSocket: 'readonly', EventSource: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', TextDecoder: 'readonly',
  TextEncoder: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
  FormData: 'readonly', FileReader: 'readonly', File: 'readonly', FileList: 'readonly',
  Image: 'readonly', Audio: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  EventTarget: 'readonly', Node: 'readonly', NodeList: 'readonly', Element: 'readonly',
  HTMLElement: 'readonly', HTMLInputElement: 'readonly', DOMException: 'readonly',
  MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
  crypto: 'readonly', performance: 'readonly', getComputedStyle: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  btoa: 'readonly', atob: 'readonly', matchMedia: 'readonly', structuredClone: 'readonly',
  // 项目自定义全局（由 config.js / store.js / ui.js … 挂载到 window）
  DPA: 'writable', DPA_CONFIG: 'readonly', DPA_SEED: 'readonly',
  DPA_Crypto: 'readonly', DPA_MOCK: 'readonly', DPA_UI: 'readonly',
  DPA_AUTH: 'readonly', DPA_API: 'readonly'
};

const NODE_GLOBALS = {
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
  console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  Headers: 'readonly', Request: 'readonly', Response: 'readonly', Blob: 'readonly', FormData: 'readonly',
  globalThis: 'readonly'
};

/** 两端共用的「真 bug」规则 */
const CORRECTNESS_RULES = {
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-condition': ['error', { checkLoops: false }],
  'valid-typeof': 'error',
  'use-isnan': 'error',
  'no-unsafe-negation': 'error',
  'no-func-assign': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-unsafe-optional-chaining': 'error',
  'require-atomic-updates': 'error'
};

const STYLE_WARNINGS = {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'warn',
  'no-useless-escape': 'warn',
  'no-irregular-whitespace': 'warn',
  'no-misleading-character-class': 'warn',
  'no-fallthrough': 'warn'
};

module.exports = [
  {
    ignores: ['node_modules/**', 'tests/report/**', 'tests/results/**', 'dist/**']
  },
  {
    // 浏览器端脚本
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2019,
      sourceType: 'script',
      globals: BROWSER_GLOBALS
    },
    rules: Object.assign({}, CORRECTNESS_RULES, STYLE_WARNINGS)
  },
  {
    // Node 端脚本（测试 / 工具 / 配置）
    files: ['tests/**/*.js', 'tools/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: Object.assign({}, CORRECTNESS_RULES, STYLE_WARNINGS, {
      /*
       * 集成测试里大量使用「保存配置 → await 请求 → 还原配置」的写法，
       * require-atomic-updates 会把这种模式误判为竞态。测试是顺序 await 执行的，
       * 不存在并发写入，因此这里关闭该规则。
       */
      'require-atomic-updates': 'off'
    })
  },
  {
    // Playwright 用例：page.evaluate() 的回调体在**浏览器**里执行，
    // 需要同时认识 Node 与浏览器两套全局。
    files: ['tests/**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.assign({}, NODE_GLOBALS, BROWSER_GLOBALS)
    },
    rules: Object.assign({}, CORRECTNESS_RULES, STYLE_WARNINGS, {
      'require-atomic-updates': 'off'
    })
  }
];
