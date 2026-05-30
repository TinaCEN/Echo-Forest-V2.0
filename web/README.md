# Echo Forest Web

这是 Echo Forest 的 iPad 友好网页版本，使用浏览器原生能力实现：

- Web Audio API 实时读取麦克风
- Canvas 绘制声音驱动的树木和叶片生长
- 支持鼠标、Apple Pencil 和触摸拖动树木
- 可保存当前画布为 PNG
- 无 npm 依赖，可以部署到任意静态网站服务

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server 8000
```

然后在电脑浏览器打开：

```text
http://localhost:8000/web/
```

## iPad 运行

iPad Safari 使用麦克风时需要安全上下文。推荐把 `web/` 目录部署到 HTTPS 静态站点，例如 GitHub Pages、Netlify、Vercel 或 Cloudflare Pages。

部署后在 iPad Safari 打开 HTTPS 链接，点击“录音”并允许麦克风权限即可。也可以通过 Safari 分享菜单添加到主屏幕，以近似 App 的方式使用。
