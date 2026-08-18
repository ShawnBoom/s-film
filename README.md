# See

一款为 iPhone 优先设计的轻量胶片滤镜网页 App。照片在浏览器本地处理，不需要账号，也不会上传到服务器。

## 首版功能

- `FUJI Classic Chrome`
- `KODAK Gold 200`
- `FUJI Youth Blue`（CORTIS 青春公路氛围方向）
- 批量选择最多 20 张照片
- 实时预览与按住对比原图
- 滤镜浓度、亮度、色彩、颗粒微调
- 使用 iOS 分享面板保存，或在其他浏览器中直接下载
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

滤镜计算位于 `app/page.tsx`，界面样式位于 `app/globals.css`。后续新增或微调单个滤镜时，修改对应预设分支即可。
