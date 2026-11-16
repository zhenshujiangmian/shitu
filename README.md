# 拾图 · 图片文字提取

一个可直接静态托管的浏览器 OCR 网页。支持拖放、选择或粘贴图片，使用 Tesseract.js 在浏览器本地识别中文、日文和英文，并按坐标整理阅读行序；开启“显示文字位置”可在原图上查看识别区域。结果可编辑、复制或导出为 TXT。

## 自定义视觉 AI API

在“识别方式”切换为“自定义 AI API”，填写 OpenAI Chat Completions 兼容的完整接口地址、支持图片输入的模型名称和 API Key。可以编辑识别提示词来要求 AI 保留题号、选项和换行。API 地址、模型名和提示词保存在浏览器本地设置中；API Key 可加密保存，解锁后只保留在页面内存。API 模式会把图片发送给所填服务商，且浏览器会把 API Key 随请求发往该地址；请只填入可信服务的地址。服务商需允许浏览器跨域请求（CORS），否则需经由自己的后端代理。

API 模式返回版面顺序文本，但不提供原图坐标框；本地 OCR 模式继续支持文字框位置显示。

## 密钥锁与划词解析

API Key 可通过“加密保存 Key”建立本机密钥锁。网页用 PBKDF2 派生 AES-GCM 密钥后才保存密文；每次新开网页会先锁定，输入解锁密码即可恢复，不必再次粘贴 API Key。忘记解锁密码时无法恢复密钥，只能删除本机密钥并重新填写。解锁密码和解密后的 API Key 不会被写入存储。若当前浏览器文件模式不支持 Web Crypto，请通过 `localhost` 或 HTTPS 打开网页。

识别结果支持鼠标拖选词句，之后点击“翻译 / 解析”。解析会调用配置的同一 API，结合选中文字附近的上下文给出中文翻译、读音/词义和语法说明。工作区里没有已有独立翻译插件代码，因此此功能直接集成在网页中。

## 运行

在项目目录启动任意静态 HTTP 服务，例如：

```bash
python -m http.server 8000
```

然后访问 `http://localhost:8000`。摄像头需要在 HTTPS 或 localhost 安全环境中使用，并在 Edge 提示时允许摄像头权限。首次本地识别需要网络连接以加载 Tesseract.js 与语言模型；本地 OCR 图片只在浏览器中处理，AI 模式图片会发送至配置的 API 服务。

## 分享为 HTTPS 网站

仓库已包含 `.github/workflows/pages.yml` 发布流程。把本目录的文件放到 GitHub 仓库根目录、推送到 `main`，然后在仓库 Settings → Pages 将 Source 设为 GitHub Actions。发布完成后可将 GitHub Pages 的 HTTPS 链接分享给他人。静态网页文件本身不会包含本机磁盘路径或 API Key。GitHub Pages 是公开网页；公开仓库的源代码也可被访问。

## 开源参考

- [hex3l/webocr](https://github.com/hex3l/webocr)：拖放图片、语言选择和 Tesseract.js 浏览器端 OCR 的实现思路。
- [altrudev/ocr](https://github.com/altrudev/ocr)：PaddleOCR、WASM、本地推理和版面分析的参考方向。

本项目是独立实现的界面与交互原型，使用 Tesseract.js 的公开 CDN；并未复制以上项目源代码。OCR 文字行通过识别框坐标近似重建，复杂多栏、表格、竖排日文的版面仍可能需要人工校正。
