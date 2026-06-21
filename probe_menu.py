"""
真实打开浏览器，加载画布页，点击 + 按钮，读 computed style，截图。
不靠"工具返回 success" 相信——要看到真实像素。
"""
import json
import base64
import asyncio
import urllib.request

CDP_URL = 'http://127.0.0.1:9222'
TARGET_URL = 'http://127.0.0.1:5173/canvas/1'

# 1. 创建新页面
import websockets

async def main():
    # 创建 target
    req = urllib.request.Request(f'{CDP_URL}/json/new?{TARGET_URL}', method='PUT')
    response = urllib.request.urlopen(req, timeout=10)
    target = json.loads(response.read())
    ws_url = target['webSocketDebuggerUrl']
    target_id = target['id']
    print(f'[+] 创建新页面: {TARGET_URL} (id={target_id})')

    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        msg_id = 0
        async def call(method, params=None):
            nonlocal msg_id
            msg_id += 1
            payload = {'id': msg_id, 'method': method, 'params': params or {}}
            await ws.send(json.dumps(payload))
            while True:
                raw = await ws.recv()
                obj = json.loads(raw)
                if obj.get('id') == msg_id:
                    return obj

        def get_value(result):
            """递归解包 CDP 嵌套 result，拿到 JS 返回的 value"""
            # ws 消息结构可能是：
            # {'id':N, 'result': {'result': {'type':'object', 'value': {...}}}}
            # 或 {'id':N, 'result': {'type':'object', 'value': {...}}}
            # 或 {'id':N, 'result': {其他数据}}
            seen = []
            cur = result
            while isinstance(cur, dict) and 'result' in cur:
                cur = cur['result']
                seen.append('result')
                if len(seen) > 5:
                    break
            if isinstance(cur, dict) and 'value' in cur and len(cur) <= 4:
                return cur['value']
            return cur

        # 等待页面加载
        await call('Page.enable')
        await call('Runtime.enable')
        await call('Page.navigate', {'url': TARGET_URL})
        print('[+] 已导航，等待 4 秒加载')

        await asyncio.sleep(4)

        # 找 + 按钮
        result = await call('Runtime.evaluate', {
            'expression': '''
            (() => {
              const btn = document.querySelector('.uc-toolbar-add-btn');
              if (!btn) return { found: false, html: document.body.innerHTML.slice(0, 500) };
              const rect = btn.getBoundingClientRect();
              return { found: true, x: rect.left + rect.width/2, y: rect.top + rect.height/2, w: rect.width, h: rect.height };
            })()
            ''',
            'returnByValue': True
        })
        btn_info = get_value(result)
        print(f'[+] 完整 result: {json.dumps(result, ensure_ascii=False)}')
        print(f'[+] get_value 后: {btn_info}')

        if not btn_info['found']:
            print('[!] 没找到 .uc-toolbar-add-btn，截图当前页')
            shot = await call('Page.captureScreenshot', {'format': 'png'})
            with open('C:\\Users\\Administrator\\WorkBuddy\\2026-06-12-12-34-09\\output\\probe_no_btn.png', 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            return

        # 点击 + 按钮
        await call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': btn_info['x'], 'y': btn_info['y'], 'button': 'left', 'clickCount': 1})
        await call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': btn_info['x'], 'y': btn_info['y'], 'button': 'left', 'clickCount': 1})
        print(f'[+] 已点击 + 按钮 ({btn_info["x"]}, {btn_info["y"]})')
        await asyncio.sleep(0.6)

        # 读弹层的 computed style + 位置
        result = await call('Runtime.evaluate', {
            'expression': '''
            (() => {
              const menu = document.querySelector('.uc-toolbar-add-menu');
              if (!menu) return { found: false };
              const cs = getComputedStyle(menu);
              const rect = menu.getBoundingClientRect();
              return {
                found: true,
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                background: cs.background.slice(0, 200),
                backgroundColor: cs.backgroundColor,
                backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
                border: cs.border,
                borderRadius: cs.borderRadius,
                boxShadow: cs.boxShadow.slice(0, 150),
                zIndex: cs.zIndex,
                position: cs.position,
              };
            })()
            ''',
            'returnByValue': True
        })
        style_info = get_value(result)
        print(f'[+] 弹层样式:')
        print(json.dumps(style_info, indent=2, ensure_ascii=False))

        # 截图（带弹层）
        shot = await call('Page.captureScreenshot', {'format': 'png'})
        with open('C:\\Users\\Administrator\\WorkBuddy\\2026-06-12-12-34-09\\output\\probe_menu_open.png', 'wb') as f:
            f.write(base64.b64decode(shot['result']['data']))
        print(f'[+] 截图已保存: output/probe_menu_open.png')

        # 关闭 target
        await call('Target.closeTarget', {'targetId': target_id})

asyncio.run(main())
