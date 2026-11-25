# ⚡ 极速刷题宝 v2.0 · 全平台云同步智能题库应用

一套代码覆盖 **微信小程序、Android App、iOS App、Web/PWA 网页、以及 Windows / macOS / Linux 电脑桌面客户端** 的智能刷题系统。采用 **本地离线优先 (Local-First) + `uniCloud` 免备案云端双向增量同步** 架构，断网毫秒级刷题，联网后多设备自动合并题库、错题本、斩杀进度与个人助记笔记。

> 📘 **保姆级全平台打包与云同步配置手册**：请阅读 **[完整操作文档 (`docs/操作文档.md`)](./docs/操作文档.md)**

---

## 🌐 全平台支持矩阵

| 平台 | 技术方案 | 获取 / 构建方式 |
|---|---|---|
| **Web / 手机 PWA** | `uni-app` Vue 3 H5 | 在线直达：**[https://atomboyc.github.io/exam-sprint-quiz/](https://atomboyc.github.io/exam-sprint-quiz/)**（GitHub Actions 自动构建） |
| **微信小程序** | `uni-app` 原生编译 (`mp-weixin`) | HBuilderX 导入根目录 → 运行到微信开发者工具 / 一键上传发布 |
| **Android App** | `uni-app` App 云打包 | HBuilderX → 发行 → 原生 App-云打包 → 直接生成 `.apk` 安装包 |
| **iOS App** | `uni-app` App 云打包 / Xcode | HBuilderX 云打包 `.ipa` 或生成 Xcode 工程真机签名 |
| **macOS / Windows / Linux 电脑端** | **Tauri v2** (~5MB 轻量原生壳) | GitHub 仓库 **Actions → Build Desktop Apps → Run workflow** 云端自动编译 `.dmg` / `.exe` / `.AppImage` |
| **免构建单页离线版** | 纯原生 HTML/JS | 双击 [`standalone-html/index.html`](./standalone-html/index.html) 或访问在线 `/lite/` |

---

## ✨ 核心亮点

1. **☁️ 多端无冲突增量云同步 + 双登录体系**
   - 支持 **通行证账号密码注册/登录** + **微信小程序一键快捷登录**，并支持微信账号与通行证账号互相绑定，实现小程序、手机 App、网页与电脑客户端跨生态无缝互通。
   - **按题级时间戳（`updatedAt`）智能合并**：手机地铁上离线刷 30 题、电脑上刷 20 题，联网后自动合并对错记录、斩杀状态、收藏和助记笔记，绝不互相覆盖。
   - 基于国内 **`uniCloud`** 云函数与云数据库，**微信小程序免自购服务器与免 ICP 域名备案**；同时支持「云函数 URL 化」供电脑端与外部网页直连。
2. **📂 零 DOM 依赖全端离线解析引擎**
   - 内置纯 JS 实现的 **RFC-1951 DEFLATE 解压器** 与 XML/CSV/文本解析器，不依赖浏览器 `DOMParser` 或 `DecompressionStream`，在**微信小程序 JSCore 环境**下同样原生支持从微信聊天/文件传输助手直接选择 **`.xlsx`、`.csv`、`.docx`、`.txt`、`.json`** 解析！
   - 智能粘贴框同时支持 PDF 复制文本、行内选项、括号内嵌答案（自动挖空）、文末答案汇总及无表头稀疏 CSV。
3. **🎯 6 大高效备考模式**
   - **📖 顺序刷题** · **🔀 随机乱序（含选项乱序）** · **⚔️ 斩杀冲刺模式** · **⚡ 极速背题闪卡** · **🎯 错题本高频攻坚** · **⏱️ 全真限时模拟考**。

---

## 📁 仓库目录结构

```text
exam-sprint-quiz/
├── pages/                       # uni-app Vue 3 跨端页面（小程序 / App / 网页 / 桌面共用）
│   ├── index/index.vue          # 刷题首页、进度仪表盘与 6 大模式入口
│   ├── study/study.vue          # 沉浸式刷题、背题闪卡、模拟考试与成绩复盘
│   ├── import/import.vue        # 跨端文件选择（含微信聊天选文件）与智能粘贴映射
│   ├── manage/manage.vue        # 多题库管理、全文检索、在线改题与错题导出
│   └── profile/profile.vue      # 账号登录/微信一键登录、跨端绑定与云同步中心
├── utils/
│   ├── doc-reader.js            # 纯 JS 跨端无依赖 ZIP / XLSX / DOCX / GBK 解码器
│   ├── parser.js                # 全题型智能解析与判题引擎
│   ├── merge.js                 # 多设备无冲突增量合并算法
│   ├── store.js                 # Local-First 分片持久化状态管理（规避小程序单键1MB限制）
│   └── cloud.js                 # uniCloud SDK + HTTP URL 双通道同步客户端
├── uniCloud-aliyun/             # 国内免备案云端后端
│   ├── cloudfunctions/quiz-sync/# 认证（账号密码 + 微信登录）与增量同步云函数
│   └── database/*.schema.json   # 5 张安全隔离的数据表结构定义
├── src-tauri/                   # Tauri v2 跨平台电脑客户端配置（Win / Mac / Linux）
├── .ci/build-h5.sh              # 官方 uni-preset-vue H5 & PWA 自动化构建脚本
├── .github/workflows/           # GitHub Actions 自动部署 Pages 与三端桌面安装包流水线
├── standalone-html/             # 经典双击即用免构建纯静态版
├── docs/操作文档.md              # 详细全平台打包、云同步开通与使用手册
├── App.vue / main.js / manifest.json / pages.json
└── LICENSE                      # MIT 开源协议
```

---

## 🚀 3 分钟快速上手路线

1. **立即在线体验 Web / 手机版**：打开 [https://atomboyc.github.io/exam-sprint-quiz/](https://atomboyc.github.io/exam-sprint-quiz/)。
2. **一键获取 Windows / macOS / Linux 电脑安装包**：进入本仓库顶部的 **Actions → Build Desktop Apps → Run workflow**，等待编译完成后直接下载 `.dmg` / `.exe` / `.AppImage`。
3. **运行微信小程序 / 打包手机 App / 激活云同步**：下载免费官方工具 [HBuilderX](https://www.dcloud.io/hbuilderx.html) 导入本仓库目录，按照 **[`docs/操作文档.md` 第 2～5 节](./docs/操作文档.md)** 指引点几下鼠标即可完成！
