# 视频仓库(ghv)

基于 GitHub 平台的视频托管与可视化方案。利用 git 把视频上传到个人仓库,通过网页在线播放,并提供多种形式的直链( jsDelivr CDN 加速 / raw 原始链接 / Releases 下载链接)。

## 功能特性

- **git 上传视频**:小视频直接 `git push` 到 `videos/` 目录
- **大文件支持**:超过 100MB 的视频走 GitHub Releases 附件,不占用 git 仓库历史
- **网页可视化**:响应式视频画廊,缩略图懒加载,点击在线播放
- **多种直链**:每个视频提供 jsDelivr、raw、Releases 三种直链,一键复制
- **自动清单**:GitHub Action 自动扫描目录与 Releases,生成 `videos.json`,无需手动维护
- **零依赖**:纯静态 HTML + 原生 JS,无需构建,部署到 GitHub Pages 即用

## 工作原理

```
上传视频                      自动化                       展示
┌─────────────┐          ┌──────────────┐          ┌──────────────┐
│ 小视频 <100MB│  git push│              │          │              │
│ → videos/   │ ───────→ │ GitHub Action│ 生成      │ GitHub Pages │
│              │          │ 扫描目录+    │ videos.json│ 网页画廊      │
│ 大视频 >100MB│ 创建     │ Releases API │ ───────→ │              │
│ → Releases   │ Release  │              │          │ + 直链复制    │
└─────────────┘          └──────────────┘          └──────────────┘
```

## 快速开始

### 步骤 1:把项目推送到 GitHub

```bash
cd ghv
git init
git add .
git commit -m "feat: 初始化视频仓库"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 步骤 2:修改配置

打开 `config.js`,把 `OWNER` 和 `REPO` 改成你的 GitHub 用户名和仓库名:

```javascript
window.VIDEO_CONFIG = {
  OWNER: 'your-username',   // ← 改成你的用户名
  REPO: 'your-repo',         // ← 改成你的仓库名
  BRANCH: 'main',
  // ...其他配置保持默认
};
```

### 步骤 3:启用 GitHub Pages

1. 进入仓库 **Settings → Pages**
2. Source 选择 **Deploy from a branch**
3. 分支选 `main`,目录选 `/(root)`
4. 保存后稍等片刻,访问 `https://<你的用户名>.github.io/<仓库名>/`

### 步骤 4:上传视频

有三种上传方式,推荐用网页上传(最简单)。

#### 方式 A:网页上传(推荐)

1. 打开站点 `https://<你的用户名>.github.io/<仓库名>/upload.html`
2. 配置 GitHub Token:点页面上的链接创建一个 PAT(勾选 `repo` 权限),粘贴到输入框保存
3. Token 验证通过后,拖拽或选择视频文件
4. 小视频(≤100MB)自动上传到 `videos/`,大视频(>100MB)弹窗让你填 Release tag 后上传到 Releases
5. 上传成功后,Action 自动更新画廊

> Token 只存在浏览器 localStorage,不上传服务器。可在页面随时清除。

#### 方式 B:命令行上传小视频(< 100MB)

```bash
# 把 MP4 文件放入 videos/ 目录
cp /path/to/your-video.mp4 videos/
git add videos/your-video.mp4
git commit -m "feat: 添加视频 your-video.mp4"
git push
```

推送后 GitHub Action 会自动扫描 `videos/` 目录并更新 `videos.json`,网页随即显示新视频。

#### 方式 C:Releases 页面上传大视频(> 100MB)

> ⚠️ 单文件超过 100MB 无法直接 git 提交(GitHub 单文件硬上限),必须走 Releases。

1. 进入仓库 **Releases → Draft a new release**
2. 填写 tag(如 `v1`),上传视频文件作为附件
3. 发布 Release

Action 会在 Release 事件触发时自动扫描附件并更新清单。

### 步骤 5:确认 Action 已启用

1. 进入仓库 **Actions** 标签页
2. 如果提示需要启用,点击 **I understand my workflows, go ahead and enable them**
3. 之后每次 push 视频或发布 Release 都会自动更新清单

## 存储策略

| 视频大小 | 存储方式 | 操作 | 仓库容量影响 |
|---------|---------|------|------------|
| < 100MB | git 提交到 `videos/` | `git push` | 计入仓库大小(建议总量 <1GB) |
| > 100MB | GitHub Releases 附件 | 网页上传 | 不计入 git 历史,无总量限制 |

- GitHub 建议仓库总大小不超过 1GB,单文件不超过 100MB
- Releases 单个附件上限 2GB,且不占用 git 仓库空间,适合大视频
- 本方案不使用 Git LFS(避免带宽收费)

## 直链格式

页面为每个视频提供三种直链,按文件大小自动选择最优源:

| 直链类型 | 格式 | 适用 | 特点 |
|---------|------|------|------|
| jsDelivr ★ | `https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/videos/<file>` | < 50MB | 国内速度快,CDN 缓存加速 |
| raw | `https://raw.githubusercontent.com/<owner>/<repo>/main/videos/<file>` | 任意大小 | GitHub 原始链接,无大小限制 |
| Releases | `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` | > 100MB | 大文件专用,无带宽限制 |

> ★ 标记的为推荐直链,页面默认使用并优先复制该链接。

直链可直接用于:`<video src="...">`、Markdown 嵌入、下载工具、其他网站外链等。

## 目录结构

```
ghv/
├── index.html              # 视频画廊主页面
├── style.css               # 样式(白色主题,响应式)
├── app.js                  # 主逻辑(渲染、播放、复制直链)
├── config.js               # 站点配置(用户名、仓库名等)
├── videos.json             # 视频清单(Action 自动生成)
├── videos/                 # 小视频存放目录
│   └── .gitkeep
├── scripts/
│   └── generate-manifest.js # 清单生成脚本(Node.js)
├── .github/
│   └── workflows/
│       └── update-videos.yml # GitHub Action 工作流
└── README.md               # 本文档
```

## 本地预览

无需构建,直接用任意静态服务器即可预览:

```bash
# 方式 1:Python
python -m http.server 8000

# 方式 2:Node.js(需安装 npx)
npx serve .

# 然后浏览器打开 http://localhost:8000
```

仓库自带示例 `videos.json`(使用 Google 公开测试视频),本地预览即可看到效果。配置真实仓库并运行 Action 后,示例会被替换为你的视频。

### 本地生成清单

```bash
# 仅扫描本地 videos/ 目录(无法读取 Releases)
node scripts/generate-manifest.js

# 扫描时附带 Releases(需要 token)
GITHUB_TOKEN=ghp_xxx GITHUB_REPOSITORY=owner/repo node scripts/generate-manifest.js
```

## 常见问题

### Q: jsDelivr 链接打开是 404?

jsDelivr 对新文件需要几分钟同步。若长时间不生效,改用 raw 链接。jsDelivr 单文件建议不超过 50MB。

### Q: 推送视频后网页没更新?

1. 检查 **Actions** 标签页,确认 workflow 运行成功
2. GitHub Pages 缓存约 10 分钟,稍后刷新
3. 浏览器强制刷新(Ctrl + Shift + R)

### Q: 大视频上传到 Releases,网页怎么识别?

Action 在 Release 发布/编辑时会自动触发,读取所有 Releases 的视频附件并合并到清单。

### Q: 仓库总大小快超 1GB 了怎么办?

把大视频迁移到 Releases(删除仓库内的文件,改为 Release 附件)。Releases 不计入仓库大小。

### Q: 可以用私人仓库吗?

可以,但 GitHub Pages 私人仓库需要 GitHub Pro/Team 账号。直链的 raw 和 Releases 链接需要登录才能访问。jsDelivr 不支持私人仓库。

## 技术栈

- HTML5 `<video>` 原生播放
- 原生 JavaScript(无框架,加载快)
- Intersection Observer 缩略图懒加载
- GitHub Actions + REST API 自动化
- GitHub Pages 静态托管

## 许可证

MIT
