# See

一款为 iPhone 优先设计的轻量胶片滤镜网页 App。照片在浏览器本地处理，不需要账号，也不会上传到服务器。

## 功能

- `FUJI Classic Chrome`
- `KODAK Gold 200`
- `FUJI Youth Blue`（CORTIS 青春公路氛围方向）
- 批量添加最多 20 张照片，每张照片独立保存滤镜与参数
- 点击切换原图 / 效果，调整时自动回到效果预览
- 滤镜浓度、线性光曝光、OKLab 色彩和多尺度胶片颗粒
- 一键应用到全部照片，支持删除和重置当前照片
- 原始分辨率、JPEG 0.95 批量导出；优先使用 iOS 分享面板，不支持时下载照片或 ZIP
- 支持添加到手机主屏幕

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

构建与测试：

```bash
npm run build
npm test
```

统一图像处理管线位于 `lib/image-engine.js`，GitHub Pages 使用同一份实现的
`docs/image-engine.js`。界面分别位于 `app/page.tsx` 与 `docs/index.html`，
样式位于 `app/globals.css` 与 `docs/styles.css`。
