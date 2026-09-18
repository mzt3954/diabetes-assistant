"""extract_inline_scripts.py — 把页面内联 script 抽取为外链 .js，修复 CSP 拦截

背景：
  桩服务与 Nginx 均下发 CSP `script-src 'self'`（无 'unsafe-inline'），
  而 8 个页面末尾各有一段内联 <script>，会被浏览器拦截，
  导致「近7日打卡趋势折线」「热门资讯条形图」「生活方案进度环形图」
  以及各页错误态保护逻辑全部失效。

做法：
  将内联块内容抽取为 js/pages/<name>-init.js，
  原位置替换为 <script src="js/pages/<name>-init.js" defer></script>。
  由于原内联块位于所有 defer 脚本之后、</body> 之前，
  改为 defer 后执行顺序与 DOMContentLoaded 时机均不变。

用法：
  python extract_inline_scripts.py           # 预演（不写盘）
  python extract_inline_scripts.py --apply   # 实际执行（自动备份）
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# 页面 → 目标脚本文件名
MAP = {
    'admin.html':          'admin-init.js',
    'checkin.html':        'checkin-init.js',
    'doctor.html':         'doctor-init.js',
    'health-news.html':    'news-init.js',
    'help.html':           'help-init.js',
    'life-plan.html':      'lifeplan-init.js',
    'personal.html':       'personal-init.js',
    'risk-prediction.html': 'risk-init.js',
}

# 匹配末尾的内联块：\n  <script>\n ... \n  </script>\n
PATTERN = re.compile(r'\n[ \t]*<script>\n(?P<body>.*?)\n[ \t]*</script>\n', re.DOTALL)

HEADER = """/**
 * {name} — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：{src} 文件末尾、</body> 之前
 */
"""


def main():
    apply = '--apply' in sys.argv
    pages_dir = ROOT / 'js' / 'pages'
    if not pages_dir.is_dir():
        print('[错误] 未找到目录 js/pages')
        return 1

    backup_dir = ROOT / '_backup_inline_20260917'
    total = 0
    changed = []

    for html_name, js_name in MAP.items():
        src = ROOT / html_name
        if not src.is_file():
            print(f'[跳过] {html_name} 不存在')
            continue

        text = src.read_text(encoding='utf-8')
        matches = list(PATTERN.finditer(text))
        if not matches:
            print(f'[跳过] {html_name} 未匹配到内联块')
            continue
        if len(matches) > 1:
            print(f'[警告] {html_name} 匹配到 {len(matches)} 个内联块，取最后一个')

        m = matches[-1]
        body = m.group('body')
        js_rel = f'js/pages/{js_name}'
        replacement = f'\n  <script src="{js_rel}" defer></script>\n'

        new_text = text[:m.start()] + replacement + text[m.end():]

        # 校验：替换后 script 标签数不变（1 个内联 → 1 个外链）
        before = text.count('<script')
        after = new_text.count('<script')
        status = 'OK' if before == after else f'标签数变化 {before}→{after}'

        print(f'\n[{html_name}] → {js_rel}　({status})')
        print(f'  内联块行数：{body.count(chr(10)) + 1}　字符数：{len(body)}')
        print(f'  首行：{body.strip().splitlines()[0][:70] if body.strip() else "(空)"}')

        if apply:
            backup_dir.mkdir(exist_ok=True)
            shutil.copy2(src, backup_dir / html_name)

            target = pages_dir / js_name
            if target.exists():
                shutil.copy2(target, backup_dir / js_name)
            target.write_text(HEADER.format(name=js_name, src=html_name) + body.rstrip() + '\n',
                              encoding='utf-8')
            src.write_text(new_text, encoding='utf-8')
            changed.append(html_name)

        total += 1

    print('\n' + '=' * 64)
    if apply:
        print(f'已处理 {total} 个页面，实际写入 {len(changed)} 个')
        print(f'备份目录：{backup_dir}')
    else:
        print(f'预演完成：将处理 {total} 个页面（未写盘）')
        print('确认无误后执行：python extract_inline_scripts.py --apply')
    print('=' * 64)
    return 0


if __name__ == '__main__':
    sys.exit(main())
