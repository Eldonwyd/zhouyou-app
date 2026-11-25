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
  const isWeChatOrQQ = /MicroMessenger|QQ\/|MQQBrowser/i.test(ua);

  /* ---------- 0. 微信 / QQ 内置浏览器安全与下载提示 ---------- */
  if (isWeChatOrQQ && document.body) {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#fff4ec;color:#5a372a;border-bottom:1px solid #f0d5c4;font-size:13px;line-height:1.45;';
    bar.innerHTML = '<span>📱 当前在微信 / QQ 内置浏览器中打开：可直接安全浏览；如需下载 APK 安装包或添加到手机桌面，请点右上角 <strong>···</strong> 选择「在默认浏览器打开」。</span><button type="button" aria-label="关闭提示" style="border:0;background:transparent;color:#8a685b;font-size:18px;padding:2px 6px;cursor:pointer;flex:0 0 auto;">×</button>';
    const closeBtn = bar.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', () => bar.remove());
    document.body.insertBefore(bar, document.body.firstChild);
  }

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
      'hero.title1': 'One Page to Plan the Horizon,',
      'hero.title2': 'A Lifetime to Light Up Zhouyou',
      'hero.sub': 'An all-in-one cross-platform travel toolkit: one-click AI illustrated itineraries with backup plans, smooth Amap/Baidu/Google Maps & Xiaohongshu switching, friend group voting & auto AA splitting, and 370+ city footprint journals.',
      'hero.tryBtn': 'Try Interactive Web Tour',
      'tour.eyebrow': 'INTERACTIVE WEB SANDBOX',
      'tour.h2': 'Experience the Web App Right Here',
      'tour.p': 'Explore the Vintage Journal interface, light up 370+ China cities, and browse the sample Dali roadbook & photo journal. Install the client or full PWA to unlock cloud sync, friends, live AI, and photo storage.',
      'features.eyebrow': 'ALL-IN-ONE TRAVEL TOOLKIT',
      'features.h2': 'Everything from Planning to Memories, Seamlessly Connected',
      'features.p': 'Stop juggling 6 separate apps. AI illustrated roadbooks with backup plans, native map & Xiaohongshu switching, friend group polls & auto AA, and footprint journals all in one place.',
      'showcase.eyebrow': 'REAL APP SHOWCASE',
      'showcase.h2': 'Real Interface Highlights, Built for Effortless Travel',
      'showcase.p': 'Defaulting to the warm Vintage Journal look — switch tabs below to inspect AI roadbooks, group chat polls, auto AA settlement, footprint maps, and photo journals.',
      'compare.eyebrow': 'MULTI-PLATFORM EXPERIENCE',
      'compare.h2': 'Web, Mobile & Desktop — All Seamlessly Synced',
      'compare.p': 'Explore instantly in the browser, or install the free open-source Desktop/Mobile clients to sync itineraries, footprints, and friend chats across every device.',
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

  /* ---------- 5. 点击展开式全屏 / 浮层在线试玩窗口 ---------- */
  const tourModal = document.getElementById('tour-modal');
  const tourCloseBtn = document.getElementById('tour-close-btn');
  const tourIframe = document.getElementById('tour-iframe');
  const tourStage = document.getElementById('tour-stage');
  const tourLoading = document.getElementById('tour-loading');
  const tourVpBtns = document.querySelectorAll('[data-tour-viewport]');
  let tourLoaded = false;

  function loadTourIframe() {
    if (tourLoaded || !tourIframe) return;
    tourLoaded = true;
    tourIframe.src = './?demo=1&tour=1&embed=1';
  }
  function openTourModal() {
    if (!tourModal) return;
    loadTourIframe();
    tourModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeTourModal() {
    if (!tourModal || tourModal.hidden) return;
    tourModal.hidden = true;
    document.body.style.overflow = '';
  }

  if (tourIframe) {
    tourIframe.addEventListener('load', () => {
      if (tourLoading) tourLoading.classList.add('is-hidden');
    });
  }
  document.querySelectorAll('[data-open-tour]').forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openTourModal();
    });
  });
  if (tourCloseBtn) {
    tourCloseBtn.addEventListener('click', closeTourModal);
  }
  if (tourModal) {
    tourModal.addEventListener('click', (e) => {
      if (e.target === tourModal) closeTourModal();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTourModal();
  });

  tourVpBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-tour-viewport');
      tourVpBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (tourStage) tourStage.classList.toggle('is-mobile-view', mode === 'mobile');
    });
  });
  if (isMobileDevice && tourStage) {
    tourStage.classList.remove('is-mobile-view');
  }

  /* ---------- 6. 核心界面精选画廊：6 核心场景（默认复古手账，支持可选 5 套皮肤预览） ---------- */
  const SKIN_META = {
    journal: { name: '复古手账', desc: '默认主题 · 温润方格纸纹与温暖衬线标题，沉浸如翻阅纸本手账。' },
    candy: { name: '糖果贴纸', desc: '明快珊瑚红与手绘贴纸元素，轻快活泼。' },
    white: { name: '简洁纯白', desc: '干净纯白画布与松绿点缀，聚焦地图与内容本身。' },
    coast: { name: '海盐晴空', desc: '清透浅海蓝与深青色搭配，视觉清爽通透。' },
    warm: { name: '草木暖日', desc: '柔和草木绿与暖日米白，书卷气息十足。' },
  };
  const TAB_META = {
    planner: {
      label: 'AI 一键生成完整图文路书',
      filePrefix: 'skin-planner-',
      hasSkins: true,
      desc: '自带景点介绍与实景配图、预算拆解，一键直连主流地图导航与小红书，右侧还贴心预留备用玩法随时调整。',
    },
    companions: {
      label: '好友与行程群 · 同看同改计划',
      filePrefix: 'skin-companions-',
      hasSkins: true,
      desc: '一键共享最新行程，群里边聊边投票，投出最高票还能让 AI 自动改好路线并同步给所有人，旅途记账自动理清分摊。',
    },
    map: {
      label: '全国 34 省 × 370+ 城足迹地图',
      filePrefix: 'skin-',
      hasSkins: true,
      desc: '支持省级缩放下钻、一键点亮已去过/计划前往与按省离线缓存，坐飞机高铁无网照样看。',
    },
    compare: {
      label: '好友双人中国足迹对比地图',
      staticFile: 'desktop-footprint-compare.png',
      hasSkins: false,
      desc: '一键叠加查看你和好友「共同去过」「对方去过」「我去过」「共同想去」的城市清单。',
    },
    journal: {
      label: '照片手账与专属城市明信片',
      filePrefix: 'skin-journal-',
      hasSkins: true,
      desc: '按旅程或城市归档原图照片、短视频与现场语音评语，自动读取 EXIF 与 GPS 归属城市。',
    },
  };
  const showcaseImg = document.getElementById('showcase-img');
  const showcaseTitle = document.getElementById('showcase-title');
  const showcaseDesc = document.getElementById('showcase-desc');
  const mapToneSwitch = document.getElementById('map-tone-switch');
  const showcaseSkinWrap = document.getElementById('showcase-skin-wrap');
  const showcaseTabs = document.querySelectorAll('[data-shot-tab]');
  const toneBtns = document.querySelectorAll('[data-map-tone]');
  const skinBtns = document.querySelectorAll('[data-skin-preview]');
  let activeShotTab = 'planner';
  let activeMapTone = 'light';
  let activeSkin = 'journal';

  let switchSeq = 0;
  let dimTimer = null;
  const preloadedTabs = new Set();

  function preloadTabSkins(tabKey) {
    const info = TAB_META[tabKey];
    if (!info || preloadedTabs.has(tabKey)) return;
    preloadedTabs.add(tabKey);
    if (info.staticFile) {
      const img = new Image();
      img.src = `./screenshots/${info.staticFile}?v=1.0.64`;
      return;
    }
    Object.keys(SKIN_META).forEach((skin) => {
      const img = new Image();
      img.src = `./screenshots/${info.filePrefix}${skin}.png?v=1.0.64`;
    });
  }

  function renderShowcase() {
    if (!showcaseImg) return;
    const tabInfo = TAB_META[activeShotTab] || TAB_META.planner;
    const skinInfo = SKIN_META[activeSkin] || SKIN_META.journal;
    let fileName;
    let title;
    let desc;
    if (activeShotTab === 'map' && activeMapTone === 'dark') {
      fileName = 'desktop-map-dark.png';
      title = '全国 34 省 × 370+ 城市足迹地图（夜间深色）';
      desc = '深色护眼低眩光配色，夜晚翻看足迹与规划行程同样柔和清晰。';
    } else if (tabInfo.staticFile) {
      fileName = tabInfo.staticFile;
      title = `复古手账 · ${tabInfo.label}`;
      desc = tabInfo.desc;
    } else {
      fileName = `${tabInfo.filePrefix}${activeSkin}.png`;
      title = `${skinInfo.name} · ${tabInfo.label}`;
      desc = tabInfo.desc || skinInfo.desc;
    }

    const nextLocal = `./screenshots/${fileName}?v=1.0.64`;
    const nextFallback = `${FALLBACK_SHOT_BASE}${fileName}`;
    showcaseImg.alt = title;
    if (showcaseTitle) showcaseTitle.textContent = title;
    if (showcaseDesc) showcaseDesc.textContent = desc;
    if (mapToneSwitch) mapToneSwitch.hidden = activeShotTab !== 'map';
    if (showcaseSkinWrap) showcaseSkinWrap.hidden = !tabInfo.hasSkins;
    showcaseTabs.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-shot-tab') === activeShotTab));
    toneBtns.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-map-tone') === activeMapTone));
    const showSkinActive = Boolean(tabInfo.hasSkins) && !(activeShotTab === 'map' && activeMapTone === 'dark');
    skinBtns.forEach((btn) => btn.classList.toggle('is-active', showSkinActive && btn.getAttribute('data-skin-preview') === activeSkin));

    preloadTabSkins(activeShotTab);
    if (showcaseImg.getAttribute('src') === nextLocal) {
      showcaseImg.classList.remove('is-switching');
      return;
    }

    const seq = ++switchSeq;
    if (dimTimer) clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
      if (seq === switchSeq) showcaseImg.classList.add('is-switching');
    }, 120);

    const loader = new Image();
    loader.onload = () => {
      if (seq !== switchSeq) return;
      if (dimTimer) clearTimeout(dimTimer);
      showcaseImg.src = loader.src;
      showcaseImg.classList.remove('is-switching');
    };
    loader.onerror = () => {
      if (seq !== switchSeq) return;
      if (loader.src !== nextFallback) {
        loader.src = nextFallback;
      } else {
        if (dimTimer) clearTimeout(dimTimer);
        showcaseImg.classList.remove('is-switching');
      }
    };
    loader.src = nextLocal;
  }
  if (showcaseImg) {
    renderShowcase();
    const showcaseSection = document.getElementById('showcase');
    if (showcaseSection && 'IntersectionObserver' in window) {
      const shotIo = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ['planner', 'companions', 'map', 'compare', 'journal'].forEach(preloadTabSkins);
          shotIo.disconnect();
        }
      }, { rootMargin: '300px 0px' });
      shotIo.observe(showcaseSection);
    }
  }
  showcaseTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeShotTab = btn.getAttribute('data-shot-tab') || 'map';
      renderShowcase();
    });
  });
  toneBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMapTone = btn.getAttribute('data-map-tone') || 'light';
      renderShowcase();
    });
  });
  skinBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const skin = btn.getAttribute('data-skin-preview');
      if (!skin || !SKIN_META[skin]) return;
      activeSkin = skin;
      if (activeShotTab === 'map') activeMapTone = 'light';
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
    closeTourModal();
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
    heroMobileLabel.textContent = isMobileDevice
      ? '下载手机版（APK / iOS / PWA）'
      : '手机版（APK / iOS / PWA）';
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
  const heroSpec = HERO_DESKTOP_MAP[detected] || { label: isMobileDevice ? '电脑版下载' : '下载电脑桌面版', asset: null, fallback: '#desktop' };
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

  const iosIpaMask = document.getElementById('ios-ipa-guide-mask');
  const iosIpaContinueLink = document.getElementById('ios-ipa-continue-link');
  const iosIpaCloseBtn = document.getElementById('ios-ipa-close-btn');

  function openIosIpaGuide(targetUrl) {
    if (!iosIpaMask) return false;
    if (iosIpaContinueLink && targetUrl) iosIpaContinueLink.href = targetUrl;
    iosIpaMask.hidden = false;
    return true;
  }
  function closeIosIpaGuide() {
    if (iosIpaMask) iosIpaMask.hidden = true;
  }
  if (iosIpaCloseBtn) iosIpaCloseBtn.addEventListener('click', closeIosIpaGuide);
  if (iosIpaContinueLink) iosIpaContinueLink.addEventListener('click', () => closeIosIpaGuide());
  if (iosIpaMask) iosIpaMask.addEventListener('click', (e) => { if (e.target === iosIpaMask) closeIosIpaGuide(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIosIpaGuide(); });

  document.querySelectorAll('a.dl-link[data-asset], #hero-primary-dl').forEach((link) => {
    link.addEventListener('click', (e) => {
      const asset = link.dataset.asset || link.dataset.heroAsset || '';
      const href = link.getAttribute('href') || '';
      if (isInAppBrowser) {
        const isInstaller =
          asset === 'android-apk' ||
          asset === 'ios-ipa' ||
          /\.(apk|ipa|exe|dmg|AppImage|deb)(?:$|[?#])/i.test(href) ||
          /^win-|^mac-|^linux-/.test(asset);
        if (!isInstaller) return;
        e.preventDefault();
        const titleEl = link.querySelector('span');
        openInAppGuide(link.href, titleEl ? titleEl.textContent.trim() : '周游地图安装包');
        return;
      }
      if (asset === 'ios-ipa' && openIosIpaGuide(link.href)) {
        e.preventDefault();
      }
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

  function extractReleaseVersion(tag) {
    const cleaned = String(tag || '').trim().replace(/^(?:desktop|mobile)-v?/i, '').replace(/^v/i, '');
    const match = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    return match ? match[1] : cleaned;
  }

  function compareReleaseSemver(a, b) {
    const parse = (raw) => {
      const clean = extractReleaseVersion(raw);
      const [core, pre = ''] = clean.split('-', 2);
      const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, pre };
    };
    const va = parse(a);
    const vb = parse(b);
    if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
    if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
    if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
    if (va.pre === vb.pre) return 0;
    if (!va.pre && vb.pre) return 1;
    if (va.pre && !vb.pre) return -1;
    return va.pre.localeCompare(vb.pre);
  }

  function applyReleases(releases) {
    const list = (Array.isArray(releases) ? releases.filter((r) => !r.draft) : []).sort((a, b) => {
      const diff = compareReleaseSemver(b.tag_name, a.tag_name);
      if (diff !== 0) return diff;
      return Date.parse(b.published_at || '0') - Date.parse(a.published_at || '0');
    });
    if (!list.length) return false;
    const desktopRelease =
      list.find((r) => /^desktop-v/i.test(r.tag_name || '') && (r.assets || []).length > 0) ||
      list.find((r) => /^desktop-v/i.test(r.tag_name || '')) ||
      list.find((r) => (r.assets || []).some((a) => /\.(exe|dmg|AppImage|deb)$/i.test(a.name)));
    const mobileRelease =
      list.find((r) => /^mobile-v/i.test(r.tag_name || '') && (r.assets || []).length > 0) ||
      list.find((r) => /^mobile-v/i.test(r.tag_name || '')) ||
      list.find((r) => (r.assets || []).some((a) => /\.(apk|ipa)$/i.test(a.name)));

    const verSource = desktopRelease || mobileRelease;
    if (verSource && heroVerEl) {
      const cleanVer = String(verSource.tag_name || '').replace(/^(desktop|mobile)-/i, '');
      heroVerEl.textContent = cleanVer || 'v1.0.18';
    }

    if (desktopRelease) {
      boundDesktop = true;
      if (desktopTagEl) {
        desktopTagEl.textContent = `✨ 电脑版最新 ${desktopRelease.tag_name} · GitHub Release ↗`;
        desktopTagEl.href = desktopRelease.html_url;
      }
      document.querySelectorAll('a[data-release-kind="desktop"]').forEach((el) => {
        el.href = desktopRelease.html_url;
      });
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
        mobileTagEl.textContent = `✨ 手机版最新 ${mobileRelease.tag_name} · GitHub Release ↗`;
        mobileTagEl.href = mobileRelease.html_url;
      }
      document.querySelectorAll('a[data-release-kind="mobile"]').forEach((el) => {
        el.href = mobileRelease.html_url;
      });
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
    : `https://api.github.com/repos/${REPO}/releases?per_page=100`;

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
  const pwaOpenBtn = document.getElementById('pwa-open-btn');
  const pwaInstallStatus = document.getElementById('pwa-install-status');
  function setNativePwaAvailable(available) {
    if (pwaInstallBtn) pwaInstallBtn.hidden = !available;
    if (pwaOpenBtn) {
      pwaOpenBtn.classList.toggle('btn-primary', !available);
      pwaOpenBtn.classList.toggle('btn-pwa-lg', !available);
      pwaOpenBtn.classList.toggle('btn-secondary', available);
      const labelSpan = pwaOpenBtn.querySelector('span');
      if (labelSpan) {
        labelSpan.textContent = available ? '打开完整网页版' : '打开 PWA 添加到桌面（推荐）';
      }
    }
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    setNativePwaAvailable(true);
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
      setNativePwaAvailable(false);
    });
  }
  window.addEventListener('appinstalled', () => {
    setNativePwaAvailable(false);
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

  /* ---------- 11. 首屏暖阳山海背景：平滑鼠标视差与暖光跟随 ---------- */
  const heroSection = document.querySelector('.hero-section');
  const parallaxLayers = heroSection
    ? Array.from(heroSection.querySelectorAll('.hero-parallax-layer'))
    : [];
  const cursorGlow = heroSection ? heroSection.querySelector('.hero-cursor-glow') : null;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (heroSection && parallaxLayers.length > 0 && !reduceMotion) {
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let glowTargetX = 0;
    let glowTargetY = 0;
    let glowX = 0;
    let glowY = 0;
    let glowReady = false;
    let rafId = 0;

    const tickParallax = () => {
      rafId = 0;
      currentX += (targetX - currentX) * 0.075;
      currentY += (targetY - currentY) * 0.075;

      for (const layer of parallaxLayers) {
        const depth = Number(layer.getAttribute('data-depth') || '0.4');
        const tx = (currentX * depth * 32).toFixed(2);
        const ty = (currentY * depth * 20).toFixed(2);
        layer.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }

      if (cursorGlow && glowReady) {
        glowX += (glowTargetX - glowX) * 0.1;
        glowY += (glowTargetY - glowY) * 0.1;
        cursorGlow.style.transform = `translate3d(${(glowX - 260).toFixed(1)}px, ${(glowY - 260).toFixed(1)}px, 0)`;
      }

      const stillMoving =
        Math.abs(targetX - currentX) > 0.0008
        || Math.abs(targetY - currentY) > 0.0008
        || (glowReady && (Math.abs(glowTargetX - glowX) > 0.5 || Math.abs(glowTargetY - glowY) > 0.5));

      if (stillMoving) {
        rafId = window.requestAnimationFrame(tickParallax);
      }
    };

    const scheduleParallax = () => {
      if (!rafId) rafId = window.requestAnimationFrame(tickParallax);
    };

    heroSection.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = heroSection.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const relX = event.clientX - rect.left;
      const relY = event.clientY - rect.top;
      targetX = Math.max(-1, Math.min(1, (relX / rect.width) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (relY / rect.height) * 2 - 1));
      glowTargetX = relX;
      glowTargetY = relY;
      if (!glowReady) {
        glowX = relX;
        glowY = relY;
        glowReady = true;
      }
      heroSection.classList.add('is-pointer-active');
      scheduleParallax();
    }, { passive: true });

    heroSection.addEventListener('pointerleave', () => {
      targetX = 0;
      targetY = 0;
      heroSection.classList.remove('is-pointer-active');
      scheduleParallax();
    }, { passive: true });
  }
})();
