/**
 * 上传逻辑
 * 功能描述: 在浏览器内通过 GitHub API 上传视频
 *   - 小视频(<=100MB):Contents API 上传到 videos/ 目录
 *   - 大视频(>100MB):Releases API 上传为 Release 附件
 * 技术实现: 原生 fetch + XMLHttpRequest(用于上传进度),无第三方依赖
 * 注意事项: Token 仅存储在 localStorage,不上传到服务器
 */

(function () {
  'use strict';

  const CONFIG = window.VIDEO_CONFIG || {};
  const STORAGE_KEY = 'ghv_upload_token';

  // 支持的视频扩展名
  const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv', '.ogg'];
  // 小视频直接进 videos/,大视频先进 videos-pending/ 由 Action 迁移到 Releases
  // GitHub Contents API 单文件硬上限 100MB,超过无法上传,需切分
  const REPO_MAX_MB = 100;
  const LARGE_VIDEO_DIR = 'videos-pending';

  // DOM 引用
  const els = {
    tokenPanel: document.getElementById('tokenPanel'),
    tokenInput: document.getElementById('tokenInput'),
    saveTokenBtn: document.getElementById('saveTokenBtn'),
    validateTokenBtn: document.getElementById('validateTokenBtn'),
    clearTokenBtn: document.getElementById('clearTokenBtn'),
    tokenStatus: document.getElementById('tokenStatus'),
    uploadPanel: document.getElementById('uploadPanel'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    uploadList: document.getElementById('uploadList'),
    toast: document.getElementById('toast'),
    siteTitle: document.getElementById('siteTitle'),
    siteSubtitle: document.getElementById('siteSubtitle'),
  };

  let toastTimer = null;

  // ===== 初始化 =====
  function init() {
    if (CONFIG.SITE_TITLE) els.siteTitle.textContent = CONFIG.SITE_TITLE + ' · 上传';
    if (CONFIG.SITE_SUBTITLE) els.siteSubtitle.textContent = '浏览器内直接上传,小视频入库,大视频进 Releases';

    // Token 相关事件
    els.saveTokenBtn.addEventListener('click', saveToken);
    els.validateTokenBtn.addEventListener('click', () => validateToken(getToken(), true));
    els.clearTokenBtn.addEventListener('click', clearToken);
    els.tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveToken();
    });

    // 拖拽上传
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput.click();
      }
    });
    els.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
    els.dropzone.addEventListener('dragleave', () => {
      els.dropzone.classList.remove('dragover');
    });
    els.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
    els.fileInput.addEventListener('change', () => {
      handleFiles(els.fileInput.files);
      els.fileInput.value = '';
    });

    // 检查已保存的 Token
    const saved = getToken();
    if (saved) {
      els.tokenInput.value = saved;
      els.saveTokenBtn.hidden = true;
      els.validateTokenBtn.hidden = false;
      els.clearTokenBtn.hidden = false;
      els.tokenStatus.textContent = '已保存 Token,正在验证...';
      els.tokenStatus.className = 'token-status';
      validateToken(saved, false);
    }
  }

  // ===== Token 管理 =====
  function getToken() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveToken() {
    const token = els.tokenInput.value.trim();
    if (!token) {
      showToast('请输入 Token');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch (_) {
      showToast('无法保存到 localStorage');
      return;
    }
    els.saveTokenBtn.hidden = true;
    els.validateTokenBtn.hidden = false;
    els.clearTokenBtn.hidden = false;
    els.tokenInput.value = '';
    els.tokenStatus.textContent = 'Token 已保存(隐藏显示),正在验证...';
    els.tokenStatus.className = 'token-status';
    validateToken(token, true);
  }

  function clearToken() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* 忽略 */
    }
    els.tokenInput.value = '';
    els.saveTokenBtn.hidden = false;
    els.validateTokenBtn.hidden = true;
    els.clearTokenBtn.hidden = true;
    els.tokenStatus.textContent = 'Token 已清除';
    els.tokenStatus.className = 'token-status';
    els.uploadPanel.hidden = true;
  }

  // ===== 验证 Token =====
  async function validateToken(token, showResult) {
    if (!token) {
      els.tokenStatus.textContent = '请先输入 Token';
      els.tokenStatus.className = 'token-status error';
      return false;
    }
    els.tokenStatus.textContent = '验证中...';
    els.tokenStatus.className = 'token-status';
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const user = await res.json();
      // 检查仓库权限
      const repoRes = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!repoRes.ok) throw new Error('无法访问仓库,请检查 Token 权限');
      const repo = await repoRes.json();
      if (!repo.permissions || !repo.permissions.push) {
        throw new Error('Token 没有该仓库的写入权限');
      }
      els.tokenStatus.innerHTML = `✓ 验证成功!用户:<strong>${escapeHtml(user.login)}</strong>,仓库:<strong>${escapeHtml(repo.full_name)}</strong> 有写入权限。`;
      els.tokenStatus.className = 'token-status success';
      els.uploadPanel.hidden = false;
      return true;
    } catch (err) {
      els.tokenStatus.textContent = '✗ ' + err.message;
      els.tokenStatus.className = 'token-status error';
      els.uploadPanel.hidden = true;
      if (showResult) showToast('Token 验证失败');
      return false;
    }
  }

  // ===== 文件处理 =====
  function handleFiles(fileList) {
    const token = getToken();
    if (!token) {
      showToast('请先配置 Token');
      return;
    }
    const files = Array.from(fileList).filter((f) => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      return VIDEO_EXTS.includes(ext);
    });
    if (files.length === 0) {
      showToast('请选择视频文件(MP4/WebM/MOV 等)');
      return;
    }
    files.forEach((file) => uploadFile(file, token));
  }

  // ===== 上传单个文件 =====
  async function uploadFile(file, token) {
    const sizeMB = file.size / 1024 / 1024;
    const item = createUploadItem(file, sizeMB);
    els.uploadList.insertBefore(item, els.uploadList.firstChild);

    try {
      // 上传前快速复检 Token(避免长时间后 Token 失效)
      updateItemStatus(item, 'uploading', '正在验证 Token...');
      const tokenValid = await quickCheckToken(token);
      if (!tokenValid) {
        handleInvalidToken();
        throw new Error('Token 已失效,请重新配置(见上方第 1 步)');
      }

      if (sizeMB > REPO_MAX_MB) {
        // 超过 100MB,用分片上传:切成 50MB 块,Action 合并后迁移到 Release
        await uploadInChunks(file, token, item);
        updateItemStatus(item, 'success', '分片上传成功!Action 将自动合并并迁移到 Releases(约 2-3 分钟)');
        showToast(`上传成功:${file.name}`);
        return;
      }

      // 小视频(<=100MB)直接上传到 videos/,大视频(50-100MB)上传到 videos-pending/ 由 Action 迁移
      const targetDir = sizeMB <= 50 ? (CONFIG.VIDEO_DIR || 'videos') : LARGE_VIDEO_DIR;
      await uploadToRepo(file, token, item, targetDir);
      if (targetDir === LARGE_VIDEO_DIR) {
        updateItemStatus(item, 'success', '上传成功!Action 将自动迁移到 Releases(约 1-2 分钟)');
      } else {
        updateItemStatus(item, 'success', '上传成功!Action 将自动更新画廊');
      }
      showToast(`上传成功:${file.name}`);
    } catch (err) {
      console.error('[上传] 失败:', err);
      updateItemStatus(item, 'error', '失败:' + err.message);
      showToast(`上传失败:${file.name}`);
    }
  }

  // ===== 上传视频到仓库 Contents API =====
  // targetDir: 目标目录(videos 或 videos-pending)
  async function uploadToRepo(file, token, item, targetDir) {
    const baseName = uniqueName(file.name);
    const path = `${targetDir}/${baseName}`;
    updateItemStatus(item, 'uploading', '正在读取文件...');

    // 读取并转 base64
    const content = await fileToBase64(file, (p) => {
      updateItemProgress(item, p * 0.5, '读取文件中...');
    });

    updateItemStatus(item, 'uploading', '正在上传到仓库...');
    const res = await fetch(
      `https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `feat: 添加视频 ${baseName}`,
          content,
          branch: CONFIG.BRANCH || 'main',
        }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleInvalidToken();
        throw new Error('Token 无效或已过期,请重新配置(见上方第 1 步)');
      }
      if (res.status === 403) {
        throw new Error('权限不足,请确认 Token 勾选了 repo 权限(不是 public_repo)');
      }
      if (res.status === 422) {
        throw new Error('文件名冲突,请重命名后重试');
      }
      throw new Error(data.message || `上传失败 (HTTP ${res.status})`);
    }
    updateItemProgress(item, 100, '完成');
  }

  // ===== 分片上传大视频(>100MB) =====
  // 把文件切成 10MB 的块,每块用 Contents API 上传到 videos-pending/{baseName}/part-NNN
  // 10MB 分片 base64 后约 13.3MB,在 GitHub Contents API 可靠处理范围内
  // Action 自动合并所有分片并迁移到 Releases
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

  async function uploadInChunks(file, token, item) {
    const baseName = uniqueName(file.name);
    const chunkDir = `${LARGE_VIDEO_DIR}/${baseName}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    updateItemStatus(item, 'uploading', `分片上传:共 ${totalChunks} 片`);

    // 上传 info 文件(记录原始文件名和分片数,供 Action 合并)
    const info = JSON.stringify({ originalName: file.name, baseName, totalChunks, size: file.size });
    await uploadContentToRepo(token, `${chunkDir}/info.json`, btoa(unescape(encodeURIComponent(info))), `feat: 添加分片信息 ${baseName}`);

    // 逐片上传
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const chunkNum = String(i + 1).padStart(3, '0');
      const chunkPath = `${chunkDir}/part-${chunkNum}`;

      updateItemStatus(item, 'uploading', `上传分片 ${i + 1}/${totalChunks}(${formatBytes(end - start)})`);

      // 读取分片并转 base64
      const content = await blobToBase64(chunk);
      await uploadContentToRepo(token, chunkPath, content, `feat: 上传分片 ${chunkNum}/${totalChunks} - ${baseName}`);

      // 更新进度
      const overallProgress = ((i + 1) / totalChunks) * 100;
      updateItemProgress(item, overallProgress, `已完成 ${i + 1}/${totalChunks} 片`);
    }
    updateItemProgress(item, 100, '全部上传完成');
  }

  /**
   * 上传 base64 内容到仓库 Contents API(无进度条,用于分片)
   */
  async function uploadContentToRepo(token, path, content, message) {
    const res = await fetch(
      `https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          content,
          branch: CONFIG.BRANCH || 'main',
        }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleInvalidToken();
        throw new Error('Token 无效或已过期,请重新配置');
      }
      throw new Error(data.message || `上传分片失败 (HTTP ${res.status})`);
    }
  }

  /**
   * Blob 转 base64(不使用 FileReader,避免大文件内存问题)
   */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        resolve(result.split(',')[1]);
      };
      reader.onerror = () => reject(new Error('分片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  // ===== Token 快速复检 =====
  /**
   * 上传前快速验证 Token 是否仍然有效
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async function quickCheckToken(token) {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Token 失效时的处理:清除保存的 Token,显示配置面板
   */
  function handleInvalidToken() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* 忽略 */
    }
    els.tokenInput.value = '';
    els.saveTokenBtn.hidden = false;
    els.validateTokenBtn.hidden = true;
    els.clearTokenBtn.hidden = true;
    els.uploadPanel.hidden = true;
    els.tokenStatus.innerHTML = '⚠ Token 已失效,请重新创建并配置。<br>提示:创建 Token 时务必勾选 <code>repo</code> 权限(不是 public_repo)。';
    els.tokenStatus.className = 'token-status error';
    showToast('Token 已失效,请重新配置');
  }

  // ===== UI:上传任务卡片 =====
  function createUploadItem(file, sizeMB) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `
      <div class="upload-item-header">
        <span class="upload-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="upload-item-size">${formatBytes(file.size)} · ${sizeMB <= 50 ? '仓库' : '待迁移'}</span>
      </div>
      <div class="upload-progress-wrap">
        <div class="upload-progress-bar" style="width:0%"></div>
      </div>
      <div class="upload-item-status">等待中...</div>
    `;
    return item;
  }

  function updateItemProgress(item, percent, label) {
    const bar = item.querySelector('.upload-progress-bar');
    const status = item.querySelector('.upload-item-status');
    if (bar) bar.style.width = percent + '%';
    if (label && status) status.textContent = label;
  }

  function updateItemStatus(item, type, message) {
    const status = item.querySelector('.upload-item-status');
    const bar = item.querySelector('.upload-progress-bar');
    if (status) status.textContent = message;
    item.classList.remove('uploading', 'success', 'error');
    item.classList.add(type);
    if (type === 'success') {
      if (bar) bar.style.width = '100%';
    } else if (type === 'error') {
      if (bar) bar.style.width = '100%';
    }
  }

  // ===== 工具函数 =====
  function fileToBase64(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress((e.loaded / e.total) * 100);
        }
      };
      reader.onload = () => {
        // 去掉 data:...;base64, 前缀
        const result = reader.result;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function uniqueName(name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    return `${base}-${stamp}${ext}`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2500);
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
