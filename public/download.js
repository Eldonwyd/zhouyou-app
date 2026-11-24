(function () {
  const REPO = 'Eldonwyd/zhouyou-app';
  const FALLBACK_SHOT_BASE = 'https://eldonwyd.github.io/zhouyou-app/screenshots/';
  const ua = navigator.userAgent || '';
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';

  let detected = 'windows';
  if (/Android/i.test(ua)) detected = 'android';
  else if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) detected = 'ios';
  else if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) detected = 'macos';
  else if (/Linux/i.test(platform) || /Linux/i.test(ua)) detected = 'linux';

  const isMobileDevice = detected === 'android' || detected === 'ios';

  /* ---------- 1. 浅色 / 深色主题切换 ---------- */
  const themeBtn = document.getElementById('theme-toggle');
  const themeLabel = document.getElementById('theme-toggle-label');
  function isDarkActive() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeUi() {
    const dark = isDarkActive();
    if (themeLabel) themeLabel.textContent = dark ? '浅色' : '深色';
    if (themeBtn) themeBtn.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  }
  try {
    const savedTheme = localStorage.getItem('zhouyou-site-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      document.documentElement.dataset.theme = savedTheme;
    }
  } catch {}
  syncThemeUi();
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = isDarkActive() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('zhouyou-site-theme', next); } catch {}
      syncThemeUi();
    });
  }

  /* ---------- 2. 中 / EN 双语轻切换 ---------- */
  const langBtn = document.getElementById('lang-toggle');
  const I18N = {
    en: {
      'nav.tour': 'Live Tour',
      'nav.features': 'Features',
      'nav.showcase': 'Gallery',
      'nav.download': 'Download',
      'nav.faq': 'FAQ',
      'nav.cta': 'Download',
      'hero.title1': 'Keep Every City You Walked,',
      'hero.title2': 'Inside Your Own Travel Booklet',
      'hero.sub': 'An open-source, local-first travel companion for China footprints (34 provinces & 370+ cities), photo & voice journals, multi-model AI roadbooks, and one-tap Amap & Xiaohongshu links.',
      'hero.tryBtn': 'Try Interactive Web Tour',
      'tour.eyebrow': 'INTERACTIVE WEB SANDBOX',
      'tour.h2': 'Experience the Web App Right Here',
      'tour.p': 'Click provinces, drill down to light up 370+ cities, switch 5 aesthetic skins, and explore the sample Dali roadbook & photo journal. Live AI & photo storage unlock in the client.',
      'features.eyebrow': 'CRAFTED FOR EVERY JOURNEY',
      'features.h2': 'Everything from Planning to Memories, in One Local App',
      'features.p': 'No ads, no forced login, no juggling five different apps. From AI roadbooks to polaroid journals, everything stays smoothly connected.',
      'showcase.eyebrow': 'VISUAL CRAFT & 5 SKINS',
      'showcase.h2': 'Warm Paper Tactility, Built for Light & Night',
      'showcase.p': 'Switch effortlessly between 5 curated visual themes and light/dark modes — whether planning at night or browsing memories offline on a train.',
      'compare.eyebrow': 'WEB TOUR VS CLIENT',
      'compare.h2': 'Try Online First, Unlock Full Power on Your Device',
      'compare.p': 'Web Tour lets anyone explore the interface and light up China cities immediately; install the PWA or Desktop/Mobile client for full AI & photo vaults.',
      'download.eyebrow': 'DOWNLOAD CENTER',
      'download.h2': 'Choose Your Platform — Direct, Fast & Free',
      'download.p': 'Desktop and Mobile clients are independently built & released, with edge-accelerated downloads on zhouyou.online and zero-warning PWA install.',
      'faq.eyebrow': 'INSTALL TIPS & FAQ',
      'faq.h2': 'Common Questions & Quick Setup',
    },
  };
  const zhDefaults = new Map();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    zhDefaults.set(el.getAttribute('data-i18n'), el.textContent);
  });
  let currentLang = 'zh';
  function applyLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'zh';
    document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (currentLang === 'en' && I18N.en[key]) el.textContent = I18N.en[key];
      else if (zhDefaults.has(key)) el.textContent = zhDefaults.get(key);
    });
    if (langBtn) langBtn.textContent = currentLang === 'en' ? '中文' : 'EN';
    try { localStorage.setItem('zhouyou-site-lang', currentLang); } catch {}
  }
  try {
    if (localStorage.getItem('zhouyou-site-lang') === 'en') applyLang('en');
  } catch {}
  if (langBtn) {
    langBtn.addEventListener('click', () => applyLang(currentLang === 'zh' ? 'en' : 'zh'));
  }

  /* ---------- 3. 滚动揭示动画 & 卡片聚光灯 ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  document.querySelectorAll('.bento-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      card.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });
  });

  /* ---------- 4. 微信 / QQ / 小红书内置浏览器检测 ---------- */
  const inAppRegex = /MicroMessenger|QQ\/|xhs|XiaoHongShu/i;
  const isInAppBrowser = inAppRegex.test(ua);
  const inAppName = /MicroMessenger/i.test(ua)
    ? '微信'
    : /QQ\//i.test(ua)
      ? 'QQ'
      : /xhs|XiaoHongShu/i.test(ua)
        ? '小红书'
        : '内置浏览器';

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    try {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
  }

  const inappBanner = document.getElementById('inapp-banner');
  const inappBannerApp = document.getElementById('inapp-banner-app');
  const inappBannerGuide = document.getElementById('inapp-banner-guide');
  const inappBannerCopy = document.getElementById('inapp-banner-copy');
  const guideMask = document.getElementById('inapp-guide-mask');
  const guideDesc = document.getElementById('inapp-guide-desc');
  const copyBtn = document.getElementById('inapp-copy-btn');
  const continueLink = document.getElementById('inapp-continue-link');
  const closeBtn = document.getElementById('inapp-close-btn');
  const copyStatus = document.getElementById('inapp-copy-status');
  let pendingUrl = window.location.href;

  function openInAppGuide(targetUrl, labelText) {
    pendingUrl = targetUrl || window.location.href;
    if (guideDesc) {
      const label = labelText ? `下载「${labelText}」` : '下载安装包';
      guideDesc.textContent = `${inAppName}内置浏览器会拦截直接${label}。点击右上角「···」→「在默认浏览器中打开」即可下载：`;
    }
    if (continueLink) continueLink.href = pendingUrl;
    if (copyStatus) copyStatus.textContent = '';
    if (guideMask) guideMask.hidden = false;
  }
  function closeInAppGuide() {
    if (guideMask) guideMask.hidden = true;
  }
  if (isInAppBrowser) {
    if (inappBannerApp) inappBannerApp.textContent = `${inAppName}内置浏览器`;
    if (inappBanner) inappBanner.hidden = false;
  }
  if (inappBannerGuide) inappBannerGuide.addEventListener('click', () => openInAppGuide(window.location.href, '周游地图'));
  if (inappBannerCopy) {
    inappBannerCopy.addEventListener('click', async () => {
      const ok = await copyText(window.location.href);
      inappBannerCopy.textContent = ok ? '✅ 已复制链接' : '请长按地址栏复制';
      setTimeout(() => { inappBannerCopy.textContent = '复制下载页链接'; }, 2200);
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const isDirectDl = /\.apk(?:$|[?#])|\/api\/download\b|\/install\//i.test(pendingUrl);
      const urlToCopy = isDirectDl ? pendingUrl : window.location.href;
      const ok = await copyText(urlToCopy);
      if (copyStatus) {
        copyStatus.textContent = ok
          ? '✅ 链接已复制，请粘贴到手机系统浏览器地址栏打开下载'
          : '复制失败，请点击右上角「···」选择在默认浏览器中打开';
      }
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeInAppGuide);
  if (guideMask) guideMask.addEventListener('click', (e) => { if (e.target === guideMask) closeInAppGuide(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInAppGuide(); });

  /* ---------- 5. 嵌入式在线网页版漫游沙盒 (#tour) ---------- */
  const tourIframe = document.getElementById('tour-iframe');
  const tourStage = document.getElementById('tour-stage');
  const tourLoading = document.getElementById('tour-loading');
  const tourVeil = document.getElementById('tour-interact-veil');
  const tourUnlockBtn = document.getElementById('tour-lock-toggle');
  const tourVpBtns = document.querySelectorAll('[data-tour-viewport]');
  let tourLoaded = false;

  function loadTourIframe() {
    if (tourLoaded || !tourIframe) return;
    tourLoaded = true;
    tourIframe.src = './?demo=1&tour=1&embed=1';
  }
  if (tourIframe) {
    tourIframe.addEventListener('load', () => {
      if (tourLoading) tourLoading.classList.add('is-hidden');
    });
    if ('IntersectionObserver' in window) {
      const tourIo = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            loadTourIframe();
            tourIo.disconnect();
          }
        },
        { rootMargin: '220px 0px' },
      );
      tourIo.observe(tourIframe);
    } else {
      loadTourIframe();
    }
  }

  function setTourUnlocked(unlocked) {
    if (!tourVeil) return;
    tourVeil.classList.toggle('is-unlocked', unlocked);
    if (tourUnlockBtn) {
      tourUnlockBtn.textContent = unlocked ? '🔓 自由操作中' : '🖱️ 点击开始交互';
    }
  }
  if (tourVeil) {
    tourVeil.addEventListener('click', () => {
      loadTourIframe();
      setTourUnlocked(true);
    });
  }
  if (tourUnlockBtn) {
    tourUnlockBtn.addEventListener('click', () => {
      loadTourIframe();
      const next = tourVeil ? !tourVeil.classList.contains('is-unlocked') : true;
      setTourUnlocked(next);
    });
  }
  tourVpBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-tour-viewport');
      tourVpBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (tourStage) tourStage.classList.toggle('is-mobile-view', mode === 'mobile');
    });
  });
  if (isMobileDevice && tourStage) {
    tourStage.classList.add('is-mobile-view');
    tourVpBtns.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-tour-viewport') === 'mobile'));
  }

  /* ---------- 6. 界面精选画廊 & 5 套皮肤点击切换预览 ---------- */
  const SHOTS = {
    'map-light': {
      local: './screenshots/desktop-map-light.png',
      fallback: `${FALLBACK_SHOT_BASE}desktop-map-light.png`,
      title: '全国 34 省 × 370+ 城市足迹地图（浅色）',
      desc: '点击任意省份下钻，逐城点亮已去过足迹，实时统计探索进度并支持离线缓存。',
    },
    'map-dark': {
      local: './screenshots/desktop-map-dark.png',
      fallback: `${FALLBACK_SHOT_BASE}desktop-map-dark.png`,
      title: '全国 34 省 × 370+ 城市足迹地图（夜间深色）',
      desc: '深色护眼低眩光配色，夜晚翻看足迹与规划行程同样柔和清晰。',
    },
    planner: {
      local: './screenshots/desktop-planner.png',
      fallback: `${FALLBACK_SHOT_BASE}desktop-planner.png`,
      title: '多模型 AI 行程路书 + 高德 / 小红书联动',
      desc: '每日顺路排程、出发倒计时、预算拆解、离线 OCR 识票与单文件 HTML 路书导出。',
    },
    journal: {
      local: './screenshots/desktop-journal.png',
      fallback: `${FALLBACK_SHOT_BASE}desktop-journal.png`,
      title: '照片手账与专属城市明信片',
      desc: '按旅程或城市归档原图照片、视频与语音评语，自动整理高光时刻。',
    },
  };
  const SKIN_SHOTS = {
    candy: {
      local: './screenshots/skin-candy.png',
      fallback: `${FALLBACK_SHOT_BASE}skin-candy.png`,
      title: '糖果贴纸 · 明快珊瑚手绘风',
      desc: '暖橘珊瑚主色搭配手绘贴纸与明信片元素，默认风格活泼轻快。',
    },
    white: {
      local: './screenshots/skin-white.png',
      fallback: `${FALLBACK_SHOT_BASE}skin-white.png`,
      title: '纯白极简 · 干净留白松绿风',
      desc: '克制清爽的纯白画布与松绿点缀，让中国地图与旅途照片成为绝对主角。',
    },
    journal: {
      local: './screenshots/skin-journal.png',
      fallback: `${FALLBACK_SHOT_BASE}skin-journal.png`,
      title: '纸感手账 · 复古牛皮纸衬线风',
      desc: '米黄纸张纹理与大地棕配色，翻看每一页都像翻开一本复古纸质手账。',
    },
    coast: {
      local: './screenshots/skin-coast.png',
      fallback: `${FALLBACK_SHOT_BASE}skin-coast.png`,
      title: '海风海岸 · 蔚蓝清透海滨风',
      desc: '清透的浅海蓝与深青色搭配，视觉凉爽通透，适合夏日看海与长途行程。',
    },
    warm: {
      local: './screenshots/skin-warm.png',
      fallback: `${FALLBACK_SHOT_BASE}skin-warm.png`,
      title: '暖日手账 · 草木自然书卷风',
      desc: '柔和的草木绿与暖日米白，安静耐看，适合长时间整理游记与账本。',
    },
  };
  const showcaseImg = document.getElementById('showcase-img');
  const showcaseTitle = document.getElementById('showcase-title');
  const showcaseDesc = document.getElementById('showcase-desc');
  const mapToneSwitch = document.getElementById('map-tone-switch');
  const showcaseTabs = document.querySelectorAll('[data-shot-tab]');
  const toneBtns = document.querySelectorAll('[data-map-tone]');
  const skinBtns = document.querySelectorAll('[data-skin-preview]');
  let activeShotTab = 'map';
  let activeMapTone = isDarkActive() ? 'dark' : 'light';
  let activeSkin = isDarkActive() ? null : 'candy';

  function renderShowcase() {
    if (!showcaseImg) return;
    let spec;
    if (activeShotTab === 'map' && activeSkin && SKIN_SHOTS[activeSkin]) {
      spec = SKIN_SHOTS[activeSkin];
    } else {
      const key = activeShotTab === 'map' ? `map-${activeMapTone}` : activeShotTab;
      spec = SHOTS[key] || SHOTS['map-light'];
    }
    showcaseImg.dataset.fallback = spec.fallback;
    showcaseImg.src = spec.local;
    showcaseImg.alt = spec.title;
    if (showcaseTitle) showcaseTitle.textContent = spec.title;
    if (showcaseDesc) showcaseDesc.textContent = spec.desc;
    if (mapToneSwitch) mapToneSwitch.hidden = activeShotTab !== 'map';
    showcaseTabs.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-shot-tab') === activeShotTab));
    toneBtns.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-map-tone') === activeMapTone));
    skinBtns.forEach((btn) => btn.classList.toggle('is-active', activeShotTab === 'map' && btn.getAttribute('data-skin-preview') === activeSkin));
  }
  if (showcaseImg) {
    showcaseImg.addEventListener('error', () => {
      const fb = showcaseImg.dataset.fallback;
      if (fb && showcaseImg.src !== fb) showcaseImg.src = fb;
    });
    renderShowcase();
  }
  showcaseTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeShotTab = btn.getAttribute('data-shot-tab') || 'map';
      if (activeShotTab !== 'map') activeSkin = null;
      else if (activeMapTone === 'light' && !activeSkin) activeSkin = 'candy';
      renderShowcase();
    });
  });
  toneBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMapTone = btn.getAttribute('data-map-tone') || 'light';
      activeSkin = activeMapTone === 'dark' ? null : (activeSkin || 'candy');
      renderShowcase();
    });
  });
  skinBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const skin = btn.getAttribute('data-skin-preview');
      if (!skin || !SKIN_SHOTS[skin]) return;
      activeShotTab = 'map';
      activeMapTone = 'light';
      activeSkin = skin;
      renderShowcase();
    });
  });

  /* ---------- 7. 下载专区切换、当前设备高亮 & Hero 智能按钮 ---------- */
  const card = document.querySelector(`.dl-card[data-os="${detected}"]`);
  if (card) {
    card.classList.add('is-recommended');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '适合当前设备';
    card.appendChild(badge);
  }

  const tabs = document.querySelectorAll('.mode-tab');
  const panels = document.querySelectorAll('[data-panel]');
  function applyTab(tabName) {
    const valid = ['all', 'desktop', 'mobile'].includes(tabName) ? tabName : 'all';
    tabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === valid));
    panels.forEach((el) => {
      el.hidden = valid !== 'all' && el.dataset.panel !== valid;
    });
  }
  const params = new URLSearchParams(window.location.search);
  const defaultTab = isMobileDevice ? 'mobile' : 'all';
  const rawHash = window.location.hash.replace('#', '');
  const initialTab = params.get('tab') || (['desktop', 'mobile', 'all'].includes(rawHash) ? rawHash : defaultTab);
  applyTab(initialTab);

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab || 'all';
      applyTab(target);
      history.replaceState(null, '', target === 'all' ? './download.html#download' : `./download.html#${target}`);
    });
  });
  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '');
    if (['desktop', 'mobile', 'all'].includes(h)) applyTab(h);
  });

  function jumpToDownload(section) {
    if (section === 'desktop' || section === 'mobile') applyTab(section);
    const targetEl = document.getElementById(section === 'desktop' || section === 'mobile' ? section : 'download');
    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (card) {
      card.classList.remove('is-pulse');
      void card.offsetWidth;
      card.classList.add('is-pulse');
    }
  }

  // 接收嵌入式在线漫游页传来的「下载客户端」消息
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'zhouyou-tour-download') return;
    jumpToDownload(event.data.section || 'download');
  });

  /* ---------- 8. Cloudflare 边缘加速直链 + Releases 实时绑定 ---------- */
  const useEdgeProxy =
    /^https?:$/i.test(window.location.protocol) &&
    !/(^|\.)github\.io$/i.test(window.location.hostname) &&
    !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

  const INSTALL_ROUTE_BY_ASSET = {
    'win-setup': './install/win',
    'win-portable': './install/win-portable',
    'mac-arm64': './install/mac',
    'mac-x64': './install/mac-x64',
    'linux-appimage': './install/linux',
    'linux-deb': './install/linux-deb',
    'android-apk': './install/android',
    'ios-ipa': './install/ios',
  };

  if (useEdgeProxy) {
    for (const [assetKey, route] of Object.entries(INSTALL_ROUTE_BY_ASSET)) {
      const link = document.querySelector(`a[data-asset="${assetKey}"]`);
      if (link) link.href = route;
    }
  }

  // Hero 手机版 & 电脑版双下载按钮分别适配当前系统
  const heroMobileBtn = document.getElementById('hero-mobile-dl');
  const heroMobileLabel = document.getElementById('hero-mobile-dl-label');
  const heroPrimaryBtn = document.getElementById('hero-primary-dl');
  const heroPrimaryLabel = document.getElementById('hero-primary-dl-label');

  if (heroMobileLabel) {
    heroMobileLabel.textContent =
      detected === 'ios'
        ? 'iPhone / iPad · PWA 免自签安装'
        : detected === 'android'
          ? '下载手机版（PWA / 安卓 APK）'
          : '下载手机版（PWA / 安卓 / iOS）';
  }
  if (heroMobileBtn) {
    heroMobileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToDownload('mobile');
    });
  }

  const HERO_DESKTOP_MAP = {
    windows: { label: '下载 Windows 电脑版', asset: 'win-setup', fallback: '#desktop' },
    macos: { label: '下载 macOS 苹果版', asset: 'mac-arm64', fallback: '#desktop' },
    linux: { label: '下载 Linux 电脑版', asset: 'linux-appimage', fallback: '#desktop' },
  };
  const heroSpec = HERO_DESKTOP_MAP[detected] || { label: '下载电脑桌面版', asset: null, fallback: '#desktop' };
  if (heroPrimaryLabel) heroPrimaryLabel.textContent = heroSpec.label;
  if (heroPrimaryBtn) {
    if (heroSpec.asset && useEdgeProxy && INSTALL_ROUTE_BY_ASSET[heroSpec.asset]) {
      heroPrimaryBtn.href = INSTALL_ROUTE_BY_ASSET[heroSpec.asset];
      heroPrimaryBtn.dataset.heroAsset = heroSpec.asset;
    } else {
      heroPrimaryBtn.href = heroSpec.fallback;
      if (heroSpec.asset) heroPrimaryBtn.dataset.heroAsset = heroSpec.asset;
    }
  }

  document.querySelectorAll('a.dl-link[data-asset], #hero-primary-dl').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (!isInAppBrowser) return;
      const asset = link.dataset.asset || link.dataset.heroAsset || '';
      const href = link.getAttribute('href') || '';
      const isInstaller =
        asset === 'android-apk' ||
        asset === 'ios-ipa' ||
        /\.(apk|ipa|exe|dmg|AppImage|deb)(?:$|[?#])/i.test(href) ||
        /^win-|^mac-|^linux-/.test(asset);
      if (!isInstaller) return;
      e.preventDefault();
      const titleEl = link.querySelector('span');
      openInAppGuide(link.href, titleEl ? titleEl.textContent.trim() : '周游地图安装包');
    });
  });

  function buildAssetDownloadUrl(release, asset) {
    if (useEdgeProxy && release && release.tag_name && asset && asset.name) {
      return `./api/download?tag=${encodeURIComponent(release.tag_name)}&file=${encodeURIComponent(asset.name)}`;
    }
    return asset.browser_download_url;
  }

  function bindAssets(release, matchers) {
    if (!release || !Array.isArray(release.assets)) return;
    for (const [key, test] of Object.entries(matchers)) {
      const found = release.assets.find((a) => test(a.name));
      if (!found) continue;
      const dlUrl = buildAssetDownloadUrl(release, found);
      const link = document.querySelector(`a[data-asset="${key}"]`);
      if (link) {
        link.href = dlUrl;
        const meta = link.querySelector('.dl-meta');
        if (meta && found.size) meta.textContent = `${(found.size / (1024 * 1024)).toFixed(1)} MB`;
      }
      if (heroPrimaryBtn && heroPrimaryBtn.dataset.heroAsset === key) {
        heroPrimaryBtn.href = dlUrl;
      }
    }
  }

  const desktopTagEl = document.getElementById('desktop-release-link');
  const mobileTagEl = document.getElementById('mobile-release-link');
  const heroVerEl = document.getElementById('hero-latest-ver');
  let boundDesktop = false;
  let boundMobile = false;

  function applyReleases(releases) {
    const list = Array.isArray(releases) ? releases.filter((r) => !r.draft) : [];
    if (!list.length) return false;
    const desktopRelease =
      list.find((r) => /^desktop-v/i.test(r.tag_name || '')) ||
      list.find((r) => (r.assets || []).some((a) => /\.(exe|dmg|AppImage|deb)$/i.test(a.name)));
    const mobileRelease =
      list.find((r) => /^mobile-v/i.test(r.tag_name || '')) ||
      list.find((r) => (r.assets || []).some((a) => /\.(apk|ipa)$/i.test(a.name)));

    const verSource = desktopRelease || mobileRelease;
    if (verSource && heroVerEl) {
      const cleanVer = String(verSource.tag_name || '').replace(/^(desktop|mobile)-/i, '');
      heroVerEl.textContent = cleanVer || 'v1.0.9';
    }

    if (desktopRelease) {
      boundDesktop = true;
      if (desktopTagEl) {
        desktopTagEl.textContent = `✨ 电脑版最新 ${desktopRelease.tag_name} · 查看 Release`;
        desktopTagEl.href = desktopRelease.html_url;
      }
      bindAssets(desktopRelease, {
        'win-setup': (n) => /win.*setup\.exe$/i.test(n),
        'win-portable': (n) => /win.*portable\.exe$/i.test(n),
        'mac-arm64': (n) => /mac.*arm64\.dmg$/i.test(n),
        'mac-x64': (n) => /mac.*x64\.dmg$/i.test(n),
        'linux-appimage': (n) => /\.AppImage$/i.test(n),
        'linux-deb': (n) => /\.deb$/i.test(n),
      });
    }

    if (mobileRelease) {
      boundMobile = true;
      if (mobileTagEl) {
        mobileTagEl.textContent = `✨ 手机版最新 ${mobileRelease.tag_name} · 查看 Release`;
        mobileTagEl.href = mobileRelease.html_url;
      }
      bindAssets(mobileRelease, {
        'android-apk': (n) => /\.apk$/i.test(n),
        'ios-ipa': (n) => /\.ipa$/i.test(n),
      });
    }
    return boundDesktop || boundMobile;
  }

  function applyFallbackLabels() {
    if (!boundDesktop && desktopTagEl) desktopTagEl.textContent = '📦 前往 GitHub Releases 查看电脑版';
    if (!boundMobile && mobileTagEl) mobileTagEl.textContent = '📦 前往 GitHub Releases 查看手机版';
  }

  const liveReleasesUrl = useEdgeProxy
    ? './api/releases'
    : `https://api.github.com/repos/${REPO}/releases?per_page=20`;

  fetch('./releases.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : []))
    .then((data) => { applyReleases(data); })
    .catch(() => {})
    .finally(() => {
      fetch(liveReleasesUrl)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('api-error'))))
        .then((releases) => { applyReleases(releases); })
        .catch(() => {})
        .finally(() => { applyFallbackLabels(); });
    });

  /* ---------- 9. PWA 一键添加到主屏幕 ---------- */
  let deferredInstallPrompt = null;
  const pwaInstallBtn = document.getElementById('pwa-install-btn');
  const pwaInstallStatus = document.getElementById('pwa-install-status');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (pwaInstallBtn) pwaInstallBtn.hidden = false;
  });
  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (pwaInstallStatus) {
          pwaInstallStatus.textContent =
            choice && choice.outcome === 'accepted'
              ? '✅ 已触发添加到桌面，请稍候在手机桌面查看「周游地图」图标。'
              : '你也可以随时点击浏览器菜单「添加到主屏幕 / 添加到桌面」。';
        }
      } catch {}
      deferredInstallPrompt = null;
      pwaInstallBtn.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (pwaInstallBtn) pwaInstallBtn.hidden = true;
    if (pwaInstallStatus) pwaInstallStatus.textContent = '✅ 周游地图已添加到主屏幕！';
  });

  /* ---------- 10. 一键复制终端命令 & 永久直链 ---------- */
  document.querySelectorAll('[data-copy-text]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.getAttribute('data-copy-text') || '';
      const ok = await copyText(value);
      const prev = btn.textContent;
      btn.textContent = ok ? '✅ 已复制' : '复制失败';
      setTimeout(() => { btn.textContent = prev; }, 1800);
    });
  });
})();
