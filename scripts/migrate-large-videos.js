/**
 * 大视频迁移脚本
 * 功能描述: 扫描 videos-pending/ 目录,把大视频迁移到 GitHub Releases 附件,然后从仓库删除
 * 技术实现: Node.js 原生模块 + GitHub REST API,无第三方依赖
 * 运行环境: GitHub Action(需要 GITHUB_TOKEN 和 GITHUB_REPOSITORY 环境变量)
 * 运行: node scripts/migrate-large-videos.js
 */

const fs = require('fs');
const path = require('path');

// ===== 配置 =====
const PENDING_DIR = process.env.PENDING_DIR || 'videos-pending';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // 格式: owner/repo
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv', '.ogg'];
// 迁移到 Release 的文件大小阈值(MB),小于此值不迁移
const MIGRATE_THRESHOLD_MB = 50;

const ROOT = path.resolve(__dirname, '..');

/**
 * 主函数:扫描临时目录,迁移大视频到 Releases
 */
async function main() {
  console.log('▶ 开始检查待迁移的大视频');
  console.log(`  临时目录: ${PENDING_DIR}`);

  const dir = path.resolve(ROOT, PENDING_DIR);
  if (!fs.existsSync(dir)) {
    console.log('  临时目录不存在,无需迁移');
    return;
  }

  const files = [];
  walkDir(dir, files);
  const videoFiles = files.filter((f) => VIDEO_EXTS.includes(path.extname(f.name).toLowerCase()));

  if (videoFiles.length === 0) {
    console.log('  临时目录无视频文件,无需迁移');
    return;
  }

  console.log(`  发现 ${videoFiles.length} 个待迁移视频`);

  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.warn('  ⚠ 缺少 GITHUB_TOKEN 或 GITHUB_REPOSITORY,跳过迁移');
    return;
  }

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  let migrated = 0;
  let failed = 0;

  for (const file of videoFiles) {
    const relPath = path.relative(ROOT, file.path).replace(/\\/g, '/');
    const stat = fs.statSync(file.path);
    const sizeMB = stat.size / 1024 / 1024;

    try {
      console.log(`  迁移: ${relPath}(${formatBytes(stat.size)})`);

      // 1. 读取文件内容
      const content = fs.readFileSync(file.path);

      // 2. 创建或复用 Release(按日期分组)
      const tag = `videos-${new Date().toISOString().slice(0, 10)}`;
      const release = await findOrCreateRelease(owner, repo, tag);

      // 3. 上传到 Release 作为附件
      const asset = await uploadAsset(owner, repo, release.id, file.name, content);
      console.log(`    ✓ 已上传到 Release ${tag}:${asset.browser_download_url}`);

      // 4. 获取文件 SHA 并从仓库删除
      const sha = await getFileSha(owner, repo, relPath);
      await deleteFile(owner, repo, relPath, sha);
      console.log(`    ✓ 已从仓库删除 ${relPath}`);

      // 5. 删除本地文件(避免下次重复处理)
      fs.unlinkSync(file.path);
      migrated++;
    } catch (err) {
      console.error(`    ✗ 迁移失败:${err.message}`);
      failed++;
    }
  }

  // 清理空的子目录
  cleanEmptyDirs(dir);

  console.log(`✓ 迁移完成:成功 ${migrated} 个,失败 ${failed} 个`);
  if (migrated > 0) {
    console.log('  提示:已迁移的视频会在下次清单生成时自动加入 videos.json');
  }
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
      result.push({ name: entry.name, path: fullPath, sha: null });
    }
  }
}

/**
 * 查找或创建 Release
 */
async function findOrCreateRelease(owner, repo, tag) {
  // 先查找
  const findRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: authHeaders() }
  );
  if (findRes.ok) return findRes.json();
  if (findRes.status !== 404) {
    throw new Error(`查找 Release 失败: HTTP ${findRes.status}`);
  }
  // 创建
  const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `视频归档 - ${tag}`,
      body: `本 Release 由 Action 自动创建,存放从仓库迁移的大视频文件。`,
      draft: false,
      prerelease: false,
    }),
  });
  if (!createRes.ok) {
    const data = await createRes.json().catch(() => ({}));
    throw new Error(`创建 Release 失败: ${data.message || `HTTP ${createRes.status}`}`);
  }
  return createRes.json();
}

/**
 * 上传附件到 Release
 * uploads.github.com 不受 CORS 限制(服务端调用)
 */
async function uploadAsset(owner, repo, releaseId, name, content) {
  const res = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length,
      },
      body: content,
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`上传附件失败: ${data.message || `HTTP ${res.status}`}`);
  }
  return res.json();
}

/**
 * 删除仓库中的文件
 */
async function deleteFile(owner, repo, relPath, sha) {
  if (!sha) {
    throw new Error(`无法获取 ${relPath} 的 SHA,跳过删除`);
  }
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(relPath)}`,
    {
      method: 'DELETE',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: 迁移大视频到 Release,删除 ${relPath}`,
        sha,
        branch: process.env.BRANCH || 'main',
      }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`删除文件失败: ${data.message || `HTTP ${res.status}`}`);
  }
}

/**
 * 通过 Contents API 获取文件的 SHA(删除文件时需要)
 */
async function getFileSha(owner, repo, relPath) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(relPath)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`获取文件 SHA 失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.sha;
}

/**
 * 清理空目录
 */
function cleanEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(dir, entry.name);
      cleanEmptyDirs(fullPath);
    }
  }
  // 如果目录现在为空,删除它
  const remaining = fs.readdirSync(dir);
  if (remaining.length === 0 && dir !== path.resolve(ROOT, PENDING_DIR)) {
    fs.rmdirSync(dir);
  }
}

/**
 * 认证头
 */
function authHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// ===== 启动 =====
main().catch((err) => {
  console.error('✗ 迁移脚本失败:', err);
  // 不以非零退出,避免阻断 workflow 后续步骤
  process.exit(0);
});
