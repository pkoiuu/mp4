/**
 * 视频清单生成脚本
 * 功能描述: 扫描仓库 videos/ 目录与 GitHub Releases,合并生成 videos.json
 * 技术实现: Node.js 原生模块 + GitHub REST API,无第三方依赖
 * 注意事项: 在 GitHub Action 中运行时通过 GITHUB_TOKEN 读取 Releases
 *           本地运行时仅扫描仓库内视频(无 token 则跳过 Releases)
 * 运行: node scripts/generate-manifest.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ===== 配置(从环境变量读取,支持本地与 Action 环境) =====
const VIDEO_DIR = process.env.VIDEO_DIR || 'videos';
const OUTPUT = process.env.OUTPUT || 'videos.json';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // 格式: owner/repo
const BRANCH = process.env.BRANCH || 'main';

// 支持的视频扩展名
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv', '.ogg'];

// 仓库根目录(脚本从 scripts/ 运行,根在上一级)
const ROOT = path.resolve(__dirname, '..');

/**
 * 主函数:收集所有视频并写入清单
 */
async function main() {
  console.log('▶ 开始生成视频清单');
  console.log(`  视频目录: ${VIDEO_DIR}`);
  console.log(`  输出文件: ${OUTPUT}`);
  console.log(`  仓库: ${GITHUB_REPOSITORY || '(未指定)'}`);

  const videos = [];

  // 1. 扫描仓库内视频
  const repoVideos = scanRepoVideos();
  console.log(`  仓库内视频: ${repoVideos.length} 个`);
  videos.push(...repoVideos);

  // 2. 扫描 GitHub Releases 视频(需要 token)
  if (GITHUB_TOKEN && GITHUB_REPOSITORY) {
    try {
      const releaseVideos = await scanReleases();
      console.log(`  Releases 视频: ${releaseVideos.length} 个`);
      videos.push(...releaseVideos);
    } catch (err) {
      console.warn(`  ⚠ 读取 Releases 失败: ${err.message}`);
    }
  } else {
    console.log('  跳过 Releases 扫描(未提供 GITHUB_TOKEN 或 GITHUB_REPOSITORY)');
  }

  // 3. 生成清单
  const manifest = {
    generatedAt: new Date().toISOString(),
    repo: GITHUB_REPOSITORY || null,
    branch: BRANCH,
    videoDir: VIDEO_DIR,
    total: videos.length,
    videos,
  };

  const outputPath = path.resolve(ROOT, OUTPUT);
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✓ 清单已生成: ${OUTPUT}(${videos.length} 个视频)`);
}

/**
 * 扫描仓库内 videos/ 目录的视频文件
 * @returns {Array<object>} 视频信息列表
 */
function scanRepoVideos() {
  const dir = path.resolve(ROOT, VIDEO_DIR);
  if (!fs.existsSync(dir)) {
    console.log(`  视频目录不存在: ${VIDEO_DIR}`);
    return [];
  }

  const files = [];
  walkDir(dir, files);

  return files
    .filter((file) => VIDEO_EXTS.includes(path.extname(file.name).toLowerCase()))
    .map((file) => {
      const relPath = path.relative(ROOT, file.path).replace(/\\/g, '/');
      const stat = fs.statSync(file.path);
      return {
        name: file.name,
        path: relPath,
        size: stat.size,
        source: 'repo',
        uploadedAt: getGitCommitDate(relPath) || stat.mtime.toISOString(),
      };
    });
}

/**
 * 递归遍历目录
 */
function walkDir(dir, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, result);
    } else if (entry.isFile()) {
      result.push({ name: entry.name, path: fullPath });
    }
  }
}

/**
 * 用 git log 获取文件的最近提交日期(ISO 格式)
 * @param {string} relPath 相对仓库根的路径
 * @returns {string|null}
 */
function getGitCommitDate(relPath) {
  try {
    const date = execSync(
      `git log -1 --format=%cI -- "${relPath}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return date || null;
  } catch (_) {
    return null;
  }
}

/**
 * 调用 GitHub API 读取所有 Releases 的视频附件
 * @returns {Promise<Array<object>>}
 */
async function scanReleases() {
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const result = [];
  let page = 1;
  // 分页读取所有 releases(每页 100 条)
  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    const releases = await res.json();
    if (releases.length === 0) break;

    for (const release of releases) {
      const tag = release.tag_name;
      const releaseName = release.name || tag;
      const createdAt = release.created_at || release.published_at;
      for (const asset of release.assets || []) {
        if (!VIDEO_EXTS.includes(path.extname(asset.name).toLowerCase())) continue;
        result.push({
          name: asset.name,
          path: `releases/${tag}/${asset.name}`,
          size: asset.size,
          source: 'release',
          tag,
          releaseName,
          url: asset.browser_download_url,
          uploadedAt: asset.updated_at || createdAt,
        });
      }
    }
    if (releases.length < 100) break;
    page++;
    // 防止无限循环,最多读 10 页
    if (page > 10) break;
  }
  return result;
}

// ===== 启动 =====
main().catch((err) => {
  console.error('✗ 生成清单失败:', err);
  process.exit(1);
});
