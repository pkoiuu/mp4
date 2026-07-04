/**
 * 视频仓库配置
 * 功能描述: 存放本站点所需的可配置项,GitHub 用户名/仓库名/直链策略等
 * 注意事项: 部署前请把 OWNER 和 REPO 改成你自己的 GitHub 用户名和仓库名
 *           修改后无需重新构建,GitHub Pages 推送即生效
 */
window.VIDEO_CONFIG = {
  // GitHub 用户名(个人仓库的 owner)
  OWNER: 'pkoiuu',
  // 仓库名
  REPO: 'mp4',
  // 默认分支(GitHub Pages 来源分支)
  BRANCH: 'main',
  // 视频存放目录(相对仓库根,小视频 git 提交到这里)
  VIDEO_DIR: 'videos',
  // 清单文件路径(相对站点根,由 GitHub Action 自动生成)
  MANIFEST: 'videos.json',

  // 直链策略:小文件走 jsDelivr CDN,超过阈值则切换源
  // jsDelivr 对大文件缓存不稳定,超过该阈值自动用 raw 链接
  JSDELIVR_MAX_MB: 50,
  // 单文件超过该阈值(MB)应放在 Releases 附件(git 单文件硬上限 100MB)
  // 页面对这类视频自动改用 Releases 下载链接
  RELEASE_THRESHOLD_MB: 100,

  // Releases 国内加速镜像(播放器自动尝试,失败回退到 GitHub 原始链接)
  // 镜像格式:把 https://github.com 替换为镜像前缀
  // 第一个为最优先源,依次尝试
  RELEASE_MIRRORS: [
    'https://ghmp4.5201125.xyz', // 自建 Cloudflare Worker(最稳定,推荐)
    'https://gh-proxy.com',       // 公共镜像(备选)
    'https://github.catvod.com',  // 公共镜像(备选)
  ],

  // 分页:每页显示视频数量
  PAGE_SIZE: 12,
  // 缩略图:不生成海报时使用 video 元素第一帧(seek 到该秒截图)
  THUMB_SEEK_SECONDS: 1,

  // 站点信息(显示在页头)
  SITE_TITLE: '视频仓库',
  SITE_SUBTITLE: '基于 GitHub 的视频托管与可视化',
};
