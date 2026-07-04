/**
 * 应用主逻辑
 * 功能描述: 加载视频清单、渲染画廊、播放、复制直链
 * 技术实现: 原生 JS + Intersection Observer 懒加载,无框架依赖
 * 注意事项: 直链源按文件大小自动选择(jsDelivr / raw / releases)
 */

(function () {
  'use strict';

  /** @type {typeof window.VIDEO_CONFIG} */
  const CONFIG = window.VIDEO_CONFIG || {};

  // DOM 引用
  const els = {
    grid: document.getElementById('videoGrid'),
    empty: document.getElementById('emptyState'),
    loading: document.getElementById('loadingState'),
    pagination: document.getElementById('pagination'),
    search: document.getElementById('searchInput'),
    sort: document.getElementById('sortSelect'),
    stats: document.getElementById('stats'),
    statCount: document.getElementById('statCount'),
    statSize: document.getElementById('statSize'),
    siteTitle: document.getElementById('siteTitle'),
    siteSubtitle: document.getElementById('siteSubtitle'),
    modal: document.getElementById('playerModal'),
    modalVideo: document.getElementById('modalVideo'),
    modalTitle: document.getElementById('modalTitle'),
    modalMeta: document.getElementById('modalMeta'),
    modalLinks: document.getElementById('modalLinks'),
    modalClose: document.getElementById('modalClose'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    toast: document.getElementById('toast'),
  };

  // 运行时状态
  let allVideos = [];
  let filteredVideos = [];
  let currentPage = 1;
  let toastTimer = null;

  // ===== 初始化 =====
  function init() {
    // 应用站点标题配置
    if (CONFIG.SITE_TITLE) els.siteTitle.textContent = CONFIG.SITE_TITLE;
    if (CONFIG.SITE_SUBTITLE) els.siteSubtitle.textContent = CONFIG.SITE_SUBTITLE;

    // 绑定事件
    els.search.addEventListener('input', debounce(onSearch, 200));
    els.sort.addEventListener('change', () => {
      currentPage = 1;
      render();
    });
    els.modalClose.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.modal.hidden) closeModal();
    });

    // 加载清单
    loadManifest();
  }

  // ===== 加载清单 =====
  async function loadManifest() {
    try {
      const res = await fetch(CONFIG.MANIFEST || 'videos.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('清单请求失败: ' + res.status);
      const data = await res.json();
      allVideos = Array.isArray(data.videos) ? data.videos : [];
      // 按时间倒序作为默认
      allVideos.sort((a, b) => compareDate(b, a));
      filteredVideos = allVideos.slice();
      updateStats(data);
      render();
    } catch (err) {
      console.error('[视频仓库] 加载清单失败:', err);
      els.loading.hidden = true;
      els.empty.hidden = false;
      els.empty.querySelector('.empty-title').textContent = '加载失败';
      els.empty.querySelector('.empty-hint').innerHTML =
        '无法读取 <code>videos.json</code><br />请确认已运行 GitHub Action 或检查文件是否存在';
    }
  }

  // ===== 更新统计 =====
  function updateStats(data) {
    const count = allVideos.length;
    const totalBytes = allVideos.reduce((sum, v) => sum + (v.size || 0), 0);
    els.statCount.textContent = count;
    els.statSize.textContent = formatBytes(totalBytes);
    els.stats.hidden = count === 0;
  }

  // ===== 搜索 =====
  function onSearch() {
    currentPage = 1;
    applyFilter();
    render();
  }

  function applyFilter() {
    const keyword = els.search.value.trim().toLowerCase();
    if (!keyword) {
      filteredVideos = allVideos.slice();
    } else {
      filteredVideos = allVideos.filter((v) =>
        (v.name || '').toLowerCase().includes(keyword)
      );
    }
    applySort();
  }

  function applySort() {
    const value = els.sort.value;
    const desc = value.startsWith('-');
    const key = desc ? value.slice(1) : value;
    filteredVideos.sort((a, b) => {
      let result;
      if (key === 'name') {
        result = (a.name || '').localeCompare(b.name || '', 'zh-CN');
      } else if (key === 'size') {
        result = (a.size || 0) - (b.size || 0);
      } else if (key === 'date') {
        result = compareDate(a, b);
      } else {
        result = 0;
      }
      return desc ? -result : result;
    });
  }

  // ===== 渲染 =====
  function render() {
    if (allVideos.length === 0 && els.loading.hidden) {
      els.grid.innerHTML = '';
      els.empty.hidden = false;
      els.pagination.hidden = true;
      return;
    }

    if (filteredVideos.length === 0) {
      els.loading.hidden = true;
      els.grid.innerHTML = '';
      els.empty.hidden = false;
      els.empty.querySelector('.empty-title').textContent = '没有匹配的视频';
      els.empty.querySelector('.empty-hint').textContent = '试试其他关键词';
      els.pagination.hidden = true;
      return;
    }

    els.loading.hidden = true;
    els.empty.hidden = true;

    const pageSize = CONFIG.PAGE_SIZE || 12;
    const totalPages = Math.ceil(filteredVideos.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageItems = filteredVideos.slice(start, start + pageSize);

    // 渲染卡片
    els.grid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    pageItems.forEach((video) => fragment.appendChild(createCard(video)));
    els.grid.appendChild(fragment);

    // 渲染分页
    renderPagination(totalPages);

    // 启动懒加载观察
    observeThumbs();
  }

  // ===== 创建卡片 =====
  function createCard(video) {
    const card = document.createElement('article');
    card.className = 'video-card';

    const links = getDirectLinks(video);
    const source = video.source || 'repo';
    const tagClass = source === 'release' ? 'tag-release' : 'tag-repo';
    const tagText = source === 'release' ? 'Releases' : '仓库';

    card.innerHTML = `
      <div class="card-thumb" data-src="${links.pages || links.preferred}" role="button" tabindex="0" aria-label="播放 ${escapeHtml(video.name)}">
        <div class="card-thumb-placeholder">
          <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
            <path fill="currentColor" d="M4 6h16v10H4zm0-2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
          </svg>
        </div>
        <div class="play-overlay">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title" title="${escapeHtml(video.name)}">${escapeHtml(video.name)}</div>
        <div class="card-meta">
          <span class="tag ${tagClass}">${tagText}</span>
          <span>${formatBytes(video.size)}</span>
        </div>
        <div class="card-actions">
          <button class="btn btn-primary" data-action="play">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            播放
          </button>
          <button class="btn" data-action="copy" data-url="${links.preferred}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z"/></svg>
            复制直链
          </button>
        </div>
      </div>
    `;

    // 播放事件
    const thumb = card.querySelector('.card-thumb');
    const playBtn = card.querySelector('[data-action="play"]');
    const open = () => openPlayer(video);
    thumb.addEventListener('click', open);
    thumb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    playBtn.addEventListener('click', open);

    // 复制直链
    const copyBtn = card.querySelector('[data-action="copy"]');
    copyBtn.addEventListener('click', () => {
      copyText(copyBtn.dataset.url).then(() => {
        flashCopyBtn(copyBtn);
        showToast('直链已复制');
      });
    });

    return card;
  }

  // ===== 缩略图懒加载 =====
  let thumbObserver = null;
  function observeThumbs() {
    if (!('IntersectionObserver' in window)) return;
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadThumb(entry.target);
            thumbObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '200px' }
    );
    els.grid.querySelectorAll('.card-thumb').forEach((el) => thumbObserver.observe(el));
  }

  function loadThumb(thumbEl) {
    const src = thumbEl.dataset.src;
    if (!src) return;
    const placeholder = thumbEl.querySelector('.card-thumb-placeholder');
    let settled = false;
    // 创建 video 元素加载第一帧作为缩略图
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = src;
    // 加载成功:seek 到代表性帧并显示
    video.addEventListener('loadeddata', () => {
      if (settled) return;
      // 尝试 seek 到指定秒数以获取更具代表性的画面
      const seek = CONFIG.THUMB_SEEK_SECONDS || 1;
      if (video.duration > seek) {
        try {
          video.currentTime = seek;
        } catch (_) {
          /* 忽略 seek 异常 */
        }
      }
      settled = true;
      if (placeholder) placeholder.remove();
      thumbEl.insertBefore(video, thumbEl.firstChild);
    });
    // 加载失败:静默保留占位符(跨域视频可能被浏览器 ORB 策略阻止,属预期行为,
    // 真实使用时视频与页面同源不会触发)
    const fail = () => { settled = true; };
    video.addEventListener('error', fail);
    // 超时保护:3 秒内未加载到则放弃,保留占位符
    setTimeout(fail, 3000);
  }

  // ===== 播放器模态框 =====
  function openPlayer(video) {
    const links = getDirectLinks(video);
    els.modalTitle.textContent = video.name;
    els.modalMeta.innerHTML = `
      <span class="tag ${video.source === 'release' ? 'tag-release' : 'tag-repo'}">
        ${video.source === 'release' ? 'Releases' : '仓库'}
      </span>
      <span>大小: ${formatBytes(video.size)}</span>
      ${video.uploadedAt ? `<span>上传: ${formatDate(video.uploadedAt)}</span>` : ''}
    `;
    els.modalLinks.innerHTML = renderLinkRows(video, links);
    els.modalVideo.src = links.pages || links.preferred;
    els.modal.hidden = false;
    document.body.style.overflow = 'hidden';

    // 绑定复制按钮
    els.modalLinks.querySelectorAll('.link-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        copyText(btn.dataset.url).then(() => {
          flashCopyBtn(btn);
          showToast('直链已复制');
        });
      });
    });

    // 尝试自动播放
    els.modalVideo.play().catch(() => {
      /* 自动播放被阻止,用户需手动点击 */
    });
  }

  function renderLinkRows(video, links) {
    const rows = [];
    if (links.jsdelivr) {
      rows.push(buildLinkRow('jsDelivr', links.jsdelivr, links.preferredType === 'jsdelivr'));
    }
    if (links.raw) {
      rows.push(buildLinkRow('原始', links.raw, links.preferredType === 'raw'));
    }
    if (links.release) {
      rows.push(buildLinkRow('Releases', links.release, links.preferredType === 'release'));
    }
    return rows.join('');
  }

  function buildLinkRow(label, url, isPreferred) {
    return `
      <div class="link-row">
        <span class="link-label">${label}${isPreferred ? ' ★' : ''}</span>
        <span class="link-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
        <button class="btn link-copy" data-url="${escapeHtml(url)}">复制</button>
      </div>
    `;
  }

  function closeModal() {
    els.modal.hidden = true;
    els.modalVideo.pause();
    els.modalVideo.removeAttribute('src');
    els.modalVideo.load();
    document.body.style.overflow = '';
  }

  // ===== 分页 =====
  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      els.pagination.hidden = true;
      els.pagination.innerHTML = '';
      return;
    }
    els.pagination.hidden = false;
    const items = [];
    // 上一页
    items.push(
      `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`
    );
    // 页码(最多显示 7 个,当前页居中)
    const maxShow = 7;
    let startPage = Math.max(1, currentPage - 3);
    let endPage = Math.min(totalPages, startPage + maxShow - 1);
    if (endPage - startPage < maxShow - 1) {
      startPage = Math.max(1, endPage - maxShow + 1);
    }
    if (startPage > 1) {
      items.push(`<button class="page-btn" data-page="1">1</button>`);
      if (startPage > 2) items.push(`<span class="page-info">...</span>`);
    }
    for (let i = startPage; i <= endPage; i++) {
      items.push(
        `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`
      );
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) items.push(`<span class="page-info">...</span>`);
      items.push(`<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`);
    }
    // 下一页
    items.push(
      `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`
    );
    els.pagination.innerHTML = items.join('');
    els.pagination.querySelectorAll('.page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          currentPage = page;
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  // ===== 直链生成(核心) =====
  /**
   * 根据视频来源与大小生成多种直链
   * - 仓库内视频: jsDelivr(小) / raw(大) / Pages 同源
   * - Releases 视频: releases 下载链接
   * @param {object} video
   * @returns {{preferred:string, preferredType:string, jsdelivr?:string, raw?:string, release?:string}}
   */
  function getDirectLinks(video) {
    const { OWNER, REPO, BRANCH, VIDEO_DIR, JSDELIVR_MAX_MB } = CONFIG;
    const sizeMB = (video.size || 0) / 1024 / 1024;

    // Releases 视频直接用下载链接
    if (video.source === 'release') {
      const url = video.url ||
        `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(video.tag || 'latest')}/${encodeURIComponent(video.name)}`;
      return { preferred: url, preferredType: 'release', release: url };
    }

    // 仓库内视频
    const path = video.path || `${VIDEO_DIR || 'videos'}/${video.name}`;
    const raw = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
    const jsdelivr = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${path}`;
    // Pages 同源链接:项目站点需带仓库名前缀(如 /mp4/videos/...)
    // 用相对当前页面路径,避免硬编码仓库名导致 user 站点失效
    const pages = `./${path}`;

    // 按大小选择优先源:小文件用 jsDelivr 加速,大文件用 raw
    let preferred, preferredType;
    if (sizeMB <= (JSDELIVR_MAX_MB || 50)) {
      preferred = jsdelivr;
      preferredType = 'jsdelivr';
    } else {
      preferred = raw;
      preferredType = 'raw';
    }
    return { preferred, preferredType, jsdelivr, raw, pages };
  }

  // ===== 工具函数 =====
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) {
      return dateStr || '';
    }
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function compareDate(a, b) {
    const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return ta - tb;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // 降级方案:用临时 textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error('[视频仓库] 复制失败:', err);
      showToast('复制失败,请手动选择链接');
    }
  }

  function flashCopyBtn(btn) {
    const original = btn.textContent;
    btn.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1500);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2000);
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
