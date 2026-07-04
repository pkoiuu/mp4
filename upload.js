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
  // 小视频大小阈值(MB),超过则走 Releases
  const REPO_MAX_MB = 100;

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
      if (sizeMB <= REPO_MAX_MB) {
        await uploadToRepo(file, token, item);
      } else {
        await uploadToRelease(file, token, item);
      }
      updateItemStatus(item, 'success', '上传成功!Action 将自动更新画廊');
      showToast(`上传成功:${file.name}`);
    } catch (err) {
      console.error('[上传] 失败:', err);
      updateItemStatus(item, 'error', '失败:' + err.message);
      showToast(`上传失败:${file.name}`);
    }
  }

  // ===== 方式 A:上传小视频到仓库 Contents API =====
  async function uploadToRepo(file, token, item) {
    const baseName = uniqueName(file.name);
    const path = `${CONFIG.VIDEO_DIR || 'videos'}/${baseName}`;
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
      if (res.status === 422) {
        throw new Error('文件名冲突,请重命名后重试');
      }
      throw new Error(data.message || `上传失败 (HTTP ${res.status})`);
    }
    updateItemProgress(item, 100, '完成');
  }

  // ===== 方式 B:上传大视频到 Releases =====
  async function uploadToRelease(file, token, item) {
    // 大视频需要用户指定 tag
    const tag = await promptTag(file.name);
    if (!tag) {
      throw new Error('已取消(未填写 Release tag)');
    }

    updateItemStatus(item, 'uploading', '正在查找或创建 Release...');
    // 查找或创建 Release
    let release = await findReleaseByTag(tag, token);
    if (!release) {
      release = await createRelease(tag, file.name, token);
    }

    // 检查同名资产是否已存在
    const existing = release.assets.find((a) => a.name === file.name);
    if (existing) {
      throw new Error(`Release ${tag} 中已存在同名文件 ${file.name},请先删除或重命名`);
    }

    // 上传资产(用 XMLHttpRequest 获得进度)
    updateItemStatus(item, 'uploading', '正在上传到 Releases...');
    await uploadAsset(release.upload_url, file, token, (p) => {
      updateItemProgress(item, p, `上传中 ${Math.round(p)}%`);
    });
    updateItemProgress(item, 100, '完成');
  }

  /**
   * 用 XHR 上传 Release 资产,支持进度
   */
  function uploadAsset(uploadUrl, file, token, onProgress) {
    return new Promise((resolve, reject) => {
      // upload_url 格式:https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets{?name,label}
      const baseUrl = uploadUrl.split('{')[0];
      const url = `${baseUrl}?name=${encodeURIComponent(file.name)}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Accept', 'application/vnd.github+json');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let msg = `HTTP ${xhr.status}`;
          try {
            const data = JSON.parse(xhr.responseText);
            msg = data.message || msg;
          } catch (_) {
            /* 忽略 */
          }
          reject(new Error(msg));
        }
      };

      xhr.onerror = () => reject(new Error('网络错误,上传中断'));
      xhr.send(file);
    });
  }

  // ===== Release 操作 =====
  async function findReleaseByTag(tag, token) {
    const res = await fetch(
      `https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('查找 Release 失败');
    return res.json();
  }

  async function createRelease(tag, fileName, token) {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/releases`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: tag,
        name: `视频上传 - ${tag}`,
        body: `上传视频:${fileName}`,
        draft: false,
        prerelease: false,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '创建 Release 失败');
    }
    return res.json();
  }

  // ===== UI:上传任务卡片 =====
  function createUploadItem(file, sizeMB) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `
      <div class="upload-item-header">
        <span class="upload-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="upload-item-size">${formatBytes(file.size)} · ${sizeMB <= REPO_MAX_MB ? '仓库' : 'Releases'}</span>
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

  function promptTag(fileName) {
    const defaultTag = 'video-' + new Date().toISOString().slice(0, 10);
    const tag = window.prompt(
      `大视频需要上传到 GitHub Release。\n请输入 Release tag(用于生成直链):\n\n文件:${fileName}\n\n建议格式:video-2026-07-04 或 v1`,
      defaultTag
    );
    return tag ? tag.trim() : null;
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
