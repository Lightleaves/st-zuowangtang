# 坐忘堂 · SillyTavern 原生扩展 · 安装说明

把"坐忘堂议事面板"从预设中彻底抽象出来，作为 ST **第三方扩展**原生运行：
- 不依赖任何预设（写作/梦鲸/剑仙预设都能配用）
- 不依赖 TavernHelper、不需要 Tampermonkey
- 跑在页面主 realm：无 iframe 沙箱、无 TDZ 问题
- 讨论不进主聊天；大纲写入当前激活世界书的 constant 条目

## 文件

```
zuowangtang/
├── manifest.json   扩展清单
├── index.js        面板逻辑（generateQuietPrompt 议事 + 世界书大纲写入）
└── style.css       面板样式
```

## 安装（三选一）

### 方式 A：SSH / 远程桌面（最直接）
把整个 `zuowangtang` 文件夹上传到 ST 数据目录的第三方扩展目录：

```
<SillyTavern 数据目录>/data/<你的用户目录>/extensions/zuowangtang/
```

常见位置举例：
- 裸机/PM2：`/home/<user>/SillyTavern/data/<user-handle>/extensions/zuowangtang/`
- Docker：容器内 `/home/node/app/data/<user-handle>/extensions/zuowangtang/`
  （宿主机上通常是挂载卷，如 `/opt/sillytavern/data/...` 或宝塔站点目录下的 `data/...`）

放好后**刷新浏览器页面**即可（无需重启服务；若不出现再重启 ST）。

### 方式 B：ST 界面安装（需要 git 仓库）
把 `zuowangtang` 文件夹推到一个 GitHub 仓库，然后在 ST：
扩展程序 → 安装扩展 → 粘贴仓库 URL → 安装。

### 方式 C：宝塔面板
文件管理器进入 ST 的 `data/<user-handle>/extensions/`，上传并解压 `zuowangtang.zip`。

## 启用与使用

1. 刷新后：扩展程序列表里出现"坐忘堂"，确认勾选启用。
2. 页面右下角出现"坐忘堂"浮动按钮 → 点开面板。
3. 面板内与思客议事（简短自然回答，不进主聊天）。
4. 点"应用大纲到正文"→ 面板后台整理成 `<dream_outline>` 写入世界书常量条目"坐忘堂当前大纲"。
5. 回主聊天发写作指令：写作类预设（梦鲸思客V4-坐忘堂版 v0.2+）的"零、取大纲"会从 `<dream_setting>` 读到该大纲。

## 与预设的关系

- 预设侧只需保留 v0.2+ 的"双源取大纲"（M3/M4），**不再需要内嵌面板脚本**。
- 如需纯净预设，可用 `梦鲸思客V4-坐忘堂版-v0.2.json`（无内嵌面板）配合本扩展使用。

## 排查

| 症状 | 处理 |
|---|---|
| 右下角无按钮 | 扩展程序里确认"坐忘堂"已启用；刷新页面；检查目录层级是否为 `extensions/zuowangtang/manifest.json` |
| 按钮点不开 | 本扩展已用 pointerdown 绑定；若仍不开，检查是否有其它扩展全屏遮罩 |
| 应用大纲报"未找到激活的世界书" | 确认角色绑定了世界书（如《道渊》v5.4.2）或全局选了世界书 |
| 写作没吃大纲 | 确认预设是坐忘堂版 v0.2+（含双源取大纲）；确认世界书条目"坐忘堂当前大纲"存在且 constant |
