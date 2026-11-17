<div align="center">
  <img src="./docs/brand/icon.png" width="96" height="96" alt="Mentor"/>
  <h1>Mentor</h1>
  <p>读书时身边的导师：AI 真的读过这整本书，告诉你哪里该精读、重点在哪，读到不懂随时问。</p>
</div>

## 核心功能

- **伴读**：一键生成本章 / 全书的阅读分级（略读、浅读、精读）与重点划线，直接标注在书页上；精读段落可展开「辅助阅读 / 知识关联 / 拓展阅读」。
- **本书导读**：逐章要点与全书导读（主线、章节地图、核心概念），章节与概念可点击跳转。
- **全书问答**：基于全书检索作答，回答附原文出处并由程序核对，可跳回原文。
- **AI 后端**：本机 Claude Code，或任意 OpenAI 兼容接口；所有书籍内容只发给你选定的后端。
- 支持 EPUB、PDF、MOBI、AZW3、TXT、FB2、CBZ、DOCX、MD 等格式；笔记、高亮、书签；iCloud 同步。

## 开发

```bash
yarn          # 安装依赖
yarn dev      # 桌面开发模式
yarn test     # 单元测试
yarn release  # 打包
```

架构与开发规范见 [AGENTS.md](./AGENTS.md)；AI 伴读的设计记录见 [docs/ai-reading/decisions.md](./docs/ai-reading/decisions.md)。
品牌图标由 `python3 scripts/gen-brand.py` 生成。

## 许可证与致谢

Mentor 基于开源项目 [Koodo Reader](https://github.com/koodo-reader/koodo-reader)（Copyright © 2020-2025 App by Troye）修改而来，
依照 [GNU AGPL-3.0](./LICENSE) 发布。分发本软件（包括以网络服务形式提供）时须同样以 AGPL-3.0 提供完整源码。
