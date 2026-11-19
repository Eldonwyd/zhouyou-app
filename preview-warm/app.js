// 所有资料仅写入本试阅版的独立命名空间，绝不打开正式版的 IndexedDB。
const STORAGE_KEY = 'travel-warm-preview-v1';
const icons = {
  journal: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 3v18m3-12h5m-5 4h5"/>',
  achievements: '<circle cx="12" cy="9" r="6"/><path d="m8 14-2 8 6-3 6 3-2-8m-6-13 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  heart: '<path d="M20 5c-3-3-7-1-8 1-2-3-6-4-9-1-4 5 3 10 9 15 6-5 12-10 8-15Z"/>',
  mountain: '<path d="m2 20 8-16 5 9 3-5 5 12Zm4-8 4 3 3-3M4 20h17"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  leaf: '<path d="M19 3C5 1 1 10 7 16s15 2 12-13ZM5 21 16 8m-8 7 1-6m3 3h5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  backup: '<path d="M4 6h16v15H4ZM3 3h18v3H3Zm6 9 3 3 3-3m-3-4v7"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4 2 2 0 0 1 0-4h3a4 4 0 0 0 4-4c0-3-4-6-9-6Z"/><path d="M7 9h.01M10 6h.01M15 7h.01M6 14h.01"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.leaf}</svg>`;
const pageNames = { journal: '旅行记录', achievements: '旅途成就', profile: '个人中心' };
const defaultTrips = [
  { id: 'mountain', title: '在山里，慢慢过周末', city: '大理 · 丽江', date: '2026-10-16', days: 4, photos: 24, image: 'assets/scene-0.jpg', saved: true, notes: ['早上推开窗，山还在云里。我们没有赶行程，沿着湖边走了很久。', '回来以后，还是会想起那碗热腾腾的米线。'] },
  { id: 'lake', title: '把日子交给湖边', city: '青岛 · 威海', date: '2026-09-05', days: 3, photos: 18, image: 'assets/scene-1.jpg', saved: false, notes: ['找了个靠窗的位置，坐着看了一下午的水。这样的时间应该再多一点。'] },
  { id: 'forest', title: '一起去看秋天', city: '杭州', date: '2026-10-25', days: 2, photos: 12, image: 'assets/scene-3.jpg', saved: true, notes: ['走进林子以后，声音都变轻了。捡了一片叶子，夹进了书里。'] },
];
const initialState = { nickname: '小满', bio: '喜欢山、湖，还有路边的小店。', theme: 'green', trips: defaultTrips, badges: [], lastBackup: null };
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(initialState); }
catch { state = structuredClone(initialState); }
let page = ['journal', 'achievements', 'profile'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'journal';
let filter = 'all';
let query = '';
let year = 'all';
let toastTimer;
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateText = (date) => date.replaceAll('-', '.');

/** 本地存储失败时明确提示，避免让试阅者误以为已经保存成功。 */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
  catch { toast('本地空间不足，请先下载试阅资料备份。'); return false; }
}
function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 3000);
}
function modal(title, body) {
  document.querySelector('#dialog-content').innerHTML = `<div class="modal-top"><h2>${escapeHtml(title)}</h2><button class="close" aria-label="关闭">×</button></div>${body}`;
  document.querySelector('.close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('click', (event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });

function navigate(next) {
  page = next; history.replaceState(null, '', `#${page}`); render(); window.scrollTo({ top: 0 });
}
function render() {
  document.body.classList.toggle('tint-peach', state.theme === 'peach');
  document.querySelector('#breadcrumb').textContent = `我的收藏夹 / ${pageNames[page]}`;
  document.querySelectorAll('[data-page]').forEach((button) => {
    const key = button.dataset.page;
    if (!button.classList.contains('avatar-mini')) button.innerHTML = `${icon(key)}<span>${pageNames[key]}</span>`;
    button.classList.toggle('active', key === page);
    button.setAttribute('aria-current', key === page ? 'page' : 'false');
    button.onclick = () => navigate(key);
  });
  document.querySelector('.avatar-mini').textContent = state.nickname.slice(-1);
  if (page === 'journal') renderJournal();
  if (page === 'achievements') renderAchievements();
  if (page === 'profile') renderProfile();
}

function tripCard(trip) {
  return `<article class="trip-card"><div class="trip-picture" data-open="${escapeHtml(trip.id)}" role="button" tabindex="0" aria-label="打开${escapeHtml(trip.title)}"><img src="${escapeHtml(trip.image)}" alt="${escapeHtml(trip.title)}的示例风景照片" loading="lazy"><span class="date-pill">${dateText(trip.date)}</span></div><button class="heart ${trip.saved ? 'saved' : ''}" data-heart="${escapeHtml(trip.id)}" aria-label="${trip.saved ? '取消' : ''}收藏${escapeHtml(trip.title)}" aria-pressed="${trip.saved}">${icon('heart')}</button><div class="trip-info" data-open="${escapeHtml(trip.id)}" role="button" tabindex="0"><h3>${escapeHtml(filter === 'cities' ? trip.city : trip.title)}</h3><p>${escapeHtml(filter === 'cities' ? trip.title : trip.city)}</p><div class="trip-meta"><span>${trip.days} 天</span><span>${trip.photos} 张照片</span><span>${trip.notes.length} 条短记</span><span>翻开看看 ↗</span></div></div></article>`;
}
function renderJournal() {
  const featured = state.trips[0];
  app.innerHTML = `<div class="page-heading"><div><h1>旅行记录</h1><p>${state.trips.length} 段旅行，和一些舍不得忘的小事。</p></div><button class="primary orange" id="add-trip">${icon('plus')}添加记录</button></div>
    ${featured ? `<section class="journal-hero"><div class="featured" data-open="${escapeHtml(featured.id)}" role="button" tabindex="0"><img src="${escapeHtml(featured.image)}" alt="湖山之间的旅行封面"><span class="photo-badge">翻开最近的一页</span><div class="featured-copy"><small>${dateText(featured.date)} / ${featured.days} DAYS</small><h2>${escapeHtml(featured.title)}</h2><p>${escapeHtml(featured.city)}<span class="featured-arrow">↗</span></p></div></div><aside class="note-paper"><div class="note-top"><span>最近写下的</span>${icon('journal')}</div><h3>记得那天的风</h3><p class="note-body">${escapeHtml(featured.notes.at(-1) || '还没有写下的回忆，等你来补上一笔。')}</p><div class="note-bottom"><span>${escapeHtml(featured.city)} · ${dateText(featured.date).slice(5)}</span><span class="note-flower">✳</span></div></aside></section>` : ''}
    <div class="section-title"><h2>我的旅行小册<span>慢慢收集，一页一页</span></h2></div><div class="filter-row"><div class="tabs" role="group" aria-label="记录筛选"><button data-filter="all" class="${filter === 'all' ? 'active' : ''}">全部旅行</button><button data-filter="cities" class="${filter === 'cities' ? 'active' : ''}">城市记录</button><button data-filter="saved" class="${filter === 'saved' ? 'active' : ''}">收藏的回忆</button></div><label class="search">${icon('search')}<input id="search" aria-label="搜索旅行或城市" placeholder="找一段回忆" value="${escapeHtml(query)}"></label><select id="year" aria-label="按年份筛选"><option value="all">全部年份</option>${[...new Set(state.trips.map((trip) => trip.date.slice(0, 4)))].sort().reverse().map((item) => `<option ${year === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="trip-grid ${filter === 'cities' ? 'city-grid' : ''}" id="trip-grid"></div><div class="memory-strip">${icon('leaf')}<p>每次出发，都有新的小事值得记下来。</p><button id="random-memory">随便翻一页 →</button></div>`;
  drawTrips();
  document.querySelector('#add-trip').onclick = addTrip;
  document.querySelector('#random-memory').onclick = () => { if (state.trips.length) openTrip(state.trips[Math.floor(Math.random() * state.trips.length)].id); };
  document.querySelectorAll('[data-filter]').forEach((button) => { button.onclick = () => { filter = button.dataset.filter; renderJournal(); }; });
  document.querySelector('#search').oninput = (event) => { query = event.target.value; drawTrips(); };
  document.querySelector('#year').onchange = (event) => { year = event.target.value; drawTrips(); };
  bindTripOpeners();
}
function drawTrips() {
  const trips = state.trips.filter((trip) => (filter !== 'saved' || trip.saved) && (year === 'all' || trip.date.startsWith(year)) && `${trip.title}${trip.city}${trip.notes.join('')}`.includes(query));
  document.querySelector('#trip-grid').innerHTML = trips.length ? trips.map(tripCard).join('') : '<div class="empty">没有找到这段回忆，换个名字试试吧。</div>';
  document.querySelectorAll('[data-heart]').forEach((button) => { button.onclick = () => { const trip = state.trips.find((item) => item.id === button.dataset.heart); trip.saved = !trip.saved; save(); drawTrips(); }; });
  bindTripOpeners();
}
function bindTripOpeners() {
  document.querySelectorAll('[data-open]').forEach((node) => {
    node.onclick = () => openTrip(node.dataset.open);
    node.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTrip(node.dataset.open); } };
  });
}
function openTrip(id) {
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  modal('翻开这一页', `<img class="detail-photo" src="${escapeHtml(trip.image)}" alt="旅行风景"><div class="modal-body"><div class="detail-heading"><div><h2>${escapeHtml(trip.title)}</h2><p>${escapeHtml(trip.city)} / ${dateText(trip.date)} / ${trip.days} 天</p></div><span class="note-flower">✳</span></div><div class="detail-notes">${trip.notes.map((note, index) => `<article class="saved-note"><small>短记 ${String(index + 1).padStart(2, '0')}</small><p>${escapeHtml(note)}</p></article>`).join('')}</div><form class="note-form"><textarea name="note" aria-label="写一条回忆" placeholder="还有什么想记下来的？" required></textarea><button class="primary" type="submit">收好这条回忆</button></form></div>`);
  document.querySelector('.note-form').onsubmit = (event) => {
    event.preventDefault(); const value = new FormData(event.target).get('note').trim();
    if (!value) return;
    trip.notes.push(value); if (save()) { openTrip(id); toast('这条回忆收好啦'); if (page === 'journal') renderJournal(); }
  };
}
function addTrip() {
  modal('添一段新回忆', `<form class="modal-body form-grid" id="trip-form"><label>旅行名称<input name="title" placeholder="例如：去湖边过个周末" required maxlength="40"></label><label>去过的城市<input name="city" placeholder="例如：大理 · 丽江" required maxlength="40"></label><label>出发日期<input name="date" type="date" value="2026-11-16" required></label><label>玩了几天<input name="days" type="number" min="1" max="365" value="2" required></label><label>一张喜欢的照片<input name="image" type="file" accept="image/*"></label><label>写两句<textarea name="note" placeholder="最想记住的，是……" rows="3"></textarea></label><button type="submit" class="primary">放进旅行小册</button><small>这里只保存到独立试阅版，不会写入原来的旅行记录。</small></form>`);
  document.querySelector('#trip-form').onsubmit = async (event) => {
    event.preventDefault(); const data = new FormData(event.target); const file = data.get('image'); let image = 'assets/scene-4.jpg';
    // 图片缩为封面再存储，避免大照片很快占满试阅版 localStorage。
    if (file.size) {
      try { const bitmap = await createImageBitmap(file); const canvas = document.createElement('canvas'); const scale = Math.min(1, 1200 / bitmap.width); canvas.width = bitmap.width * scale; canvas.height = bitmap.height * scale; canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); image = canvas.toDataURL('image/jpeg', .78); }
      catch { toast('这张照片暂时读不了，换一张试试'); return; }
    }
    state.trips.unshift({ id: crypto.randomUUID(), title: data.get('title').trim(), city: data.get('city').trim(), date: data.get('date'), days: Number(data.get('days')), photos: file.size ? 1 : 0, image, saved: false, notes: data.get('note').trim() ? [data.get('note').trim()] : [] });
    if (save()) { dialog.close(); filter = 'all'; query = ''; year = 'all'; render(); toast('新的一页，收好啦'); }
  };
}

const badgeDefinitions = [
  { title: '第一次出发', icon: 'sun', text: '第一段旅行，值得记住', threshold: 1 },
  { title: '山野散步家', icon: 'mountain', text: '把喜欢的风景收进口袋', threshold: 2 },
  { title: '回忆收藏家', icon: 'camera', text: '攒下三段自己的故事', threshold: 3 },
  { title: '下一站见', icon: 'leaf', text: '再记录两段旅行就解锁', threshold: 5 },
];
function renderAchievements() {
  const cities = new Set(state.trips.flatMap((trip) => trip.city.split(/[·、，]/).map((city) => city.trim()))).size;
  const days = state.trips.reduce((total, trip) => total + trip.days, 0);
  const highlights = state.trips.filter((trip) => trip.saved);
  app.innerHTML = `<div class="page-heading"><div><h1>旅途成就</h1><p>不是为了集齐什么，只是喜欢这些走过的日子。</p></div><button class="secondary" id="new-badge">${icon('plus')}做一枚纪念章</button></div><section class="achievement-intro"><div><h2>走过的路，都算数。</h2><p>这一页，装着你的旅行收获。</p></div><div class="travel-stats"><div><strong>${cities}</strong><span>座城市</span></div><div><strong>${days}</strong><span>天在路上</span></div><div><strong>${highlights.length}</strong><span>段高光回忆</span></div></div></section><div class="section-title"><h2>我的旅行纪念章<span>每一枚都有故事</span></h2></div><div class="badge-grid">${[...badgeDefinitions, ...state.badges.map((title) => ({ title, icon: 'leaf', text: '给自己的小纪念', threshold: 0 }))].map((badge, index) => `<button class="badge-card ${state.trips.length >= badge.threshold ? '' : 'locked'}" data-badge="${index}"><div class="medal">${icon(badge.icon)}</div><h3>${escapeHtml(badge.title)}</h3><p>${state.trips.length >= badge.threshold ? badge.text : `再记录 ${badge.threshold - state.trips.length} 段旅行解锁`}</p></button>`).join('')}</div><div class="two-columns"><div><div class="section-title"><h2>想再看一遍的瞬间</h2><button class="text-link" id="see-saved">全部高光 ↗</button></div>${highlights[0] ? `<div class="highlight-card" data-open="${highlights[0].id}" role="button" tabindex="0"><img src="${escapeHtml(highlights[0].image)}" alt="收藏的风景"><div><h3>${escapeHtml(highlights[0].notes[0]?.split('。')[0] || highlights[0].title)}</h3><p>${escapeHtml(highlights[0].city)} / ${dateText(highlights[0].date)}</p></div></div>` : '<p class="empty">给喜欢的旅行点一颗心，就会留在这里。</p>'}</div><div><div class="section-title"><h2>这一年的小结</h2><span class="muted">2026</span></div><div class="year-note"><span class="year">2026</span><p>${state.trips.length} 段旅行 · ${cities} 座城市 · ${days} 个在路上的日子</p><div class="tiny-photos">${state.trips.slice(0, 3).map((trip) => `<img src="${escapeHtml(trip.image)}" alt="年度旅行缩影">`).join('')}</div><button id="year-review">翻开这一年 →</button></div></div></div>`;
  document.querySelector('#see-saved').onclick = () => { filter = 'saved'; navigate('journal'); };
  document.querySelector('#year-review').onclick = () => { year = '2026'; filter = 'all'; navigate('journal'); };
  document.querySelector('#new-badge').onclick = () => {
    modal('给这段旅行盖个章', '<form class="modal-body form-grid" id="badge-form"><label>纪念章名字<input name="title" required maxlength="12" placeholder="例如：第一次看雪"></label><button class="primary" type="submit">收进纪念册</button></form>');
    document.querySelector('#badge-form').onsubmit = (event) => { event.preventDefault(); const title = new FormData(event.target).get('title').trim(); if (!title) return; state.badges.push(title); if (save()) { dialog.close(); render(); toast('新的纪念章收好了'); } };
  };
  document.querySelectorAll('[data-badge]').forEach((button) => { button.onclick = () => {
    const badges = [...badgeDefinitions, ...state.badges.map((title) => ({ title, icon: 'leaf', text: '给自己的小纪念', threshold: 0 }))];
    const badge = badges[Number(button.dataset.badge)];
    if (state.trips.length < badge.threshold) { toast(`再记录 ${badge.threshold - state.trips.length} 段旅行，慢慢来。`); return; }
    modal(badge.title, `<div class="modal-body" style="text-align:center"><div class="medal">${icon(badge.icon)}</div><p>${escapeHtml(badge.text)}</p><button class="primary" id="download-badge">存一张纪念卡</button></div>`);
    document.querySelector('#download-badge').onclick = () => downloadBadge(badge);
  }; });
  bindTripOpeners();
}

/** 纪念卡在浏览器生成，下载不依赖外部服务，也不会上传照片。 */
function downloadBadge(badge) {
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1000; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f3e8'; ctx.fillRect(0, 0, 800, 1000); ctx.strokeStyle = '#bdc5a7'; ctx.lineWidth = 2; ctx.strokeRect(45, 45, 710, 910);
  ctx.fillStyle = '#dfe7ce'; ctx.beginPath(); ctx.arc(400, 350, 135, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#647d51'; ctx.font = '90px serif'; ctx.textAlign = 'center'; ctx.fillText('旅', 400, 385);
  ctx.fillStyle = '#354332'; ctx.font = '38px sans-serif'; ctx.fillText(badge.title, 400, 580); ctx.fillStyle = '#8a927c'; ctx.font = '22px sans-serif'; ctx.fillText(badge.text, 400, 640); ctx.font = '18px sans-serif'; ctx.fillText(`${state.nickname}的旅行纪念册 · 2026`, 400, 860);
  canvas.toBlob((blob) => { if (blob) download(blob, `${badge.title}-纪念卡.png`); });
}
function download(blob, name) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function renderProfile() {
  const bytes = new Blob([JSON.stringify(state)]).size;
  const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  app.innerHTML = `<div class="page-heading"><div><h1>个人中心</h1><p>自己的小角落，慢慢收拾。</p></div></div><section class="profile-banner"><div class="profile-avatar">${escapeHtml(state.nickname.slice(-1))}</div><div><h2>${escapeHtml(state.nickname)}</h2><p>${escapeHtml(state.bio)}</p><small>旅行小册主人 / ${state.trips.length} 段旅行</small></div><button class="secondary" id="edit-profile">编辑资料 ↗</button></section><div class="profile-columns"><div><section class="panel"><h2>我的小习惯</h2><div class="menu-list"><button class="menu-row" id="appearance"><span class="menu-icon">${icon('palette')}</span><span><b>换个喜欢的颜色</b><small>${state.theme === 'peach' ? '杏桃' : '草木'} · 温暖的浅色</small></span><span class="chevron">›</span></button><button class="menu-row" id="profile-favorites"><span class="menu-icon">${icon('heart')}</span><span><b>收藏的回忆</b><small>${state.trips.filter((trip) => trip.saved).length} 段想再看一遍的旅行</small></span><span class="chevron">›</span></button><button class="menu-row" id="profile-badges"><span class="menu-icon">${icon('achievements')}</span><span><b>我的纪念章</b><small>每一次出发，都留个纪念</small></span><span class="chevron">›</span></button></div></section><section class="panel storage-panel"><h2>这个小册子占了多少地方</h2><div class="storage-line"><strong>${size}</strong><span>试阅资料 · 本机保存</span></div><div class="storage-track"><div style="width:${Math.min(100, bytes / 50000)}%"></div></div><div class="storage-legend"><span>${state.trips.length} 段旅行</span><span>${state.trips.reduce((total, trip) => total + trip.notes.length, 0)} 条短记</span><span>${state.badges.length} 枚自制章</span></div></section></div><section class="panel"><div class="backup-illustration">${icon('backup')}</div><h2>给回忆留个备份</h2><p class="intro">换设备之前，记得把这本小册子带走。<br>下载一份，自己留着也安心。</p><div class="backup-buttons"><button class="primary" id="export-backup">${icon('backup')}下载试阅备份</button><button class="secondary" id="import-backup">导入备份</button><input type="file" id="backup-file" accept="application/json,.json" hidden></div><p class="backup-caption">${state.lastBackup ? `上次备份：${escapeHtml(new Date(state.lastBackup).toLocaleString('zh-CN'))}` : '还没有备份过，找个时间收好它。'}</p><div style="border-top:1px dashed var(--line);margin-top:30px;padding-top:20px"><p class="intro">这是独立试阅资料，只在这个版本中使用。<br>原来的照片、录音和账本，都还在原来的页面。</p><a class="text-link" href="http://localhost:5173/" target="_blank" rel="noopener">打开原来的版本 ↗</a></div></section></div><p class="local-note">资料留在这台设备，试阅版不会上传个人内容。</p>`;
  document.querySelector('#edit-profile').onclick = () => {
    modal('改一改自己的名片', `<form class="modal-body form-grid" id="profile-form"><label>怎么称呼你<input name="nickname" value="${escapeHtml(state.nickname)}" maxlength="20" required></label><label>一句话介绍<input name="bio" value="${escapeHtml(state.bio)}" maxlength="60"></label><button class="primary" type="submit">保存名片</button></form>`);
    document.querySelector('#profile-form').onsubmit = (event) => { event.preventDefault(); const data = new FormData(event.target); state.nickname = data.get('nickname').trim() || '旅行者'; state.bio = data.get('bio').trim(); if (save()) { dialog.close(); render(); toast('名片更新啦'); } };
  };
  document.querySelector('#appearance').onclick = () => {
    modal('选个喜欢的颜色', `<div class="modal-body"><p>给小册子换件衣服。</p><div class="theme-choice"><button data-theme="green" class="${state.theme === 'green' ? 'active' : ''}">草木绿</button><button data-theme="peach" class="${state.theme === 'peach' ? 'active' : ''}">杏桃色</button></div></div>`);
    document.querySelectorAll('[data-theme]').forEach((button) => { button.onclick = () => { state.theme = button.dataset.theme; save(); dialog.close(); render(); }; });
  };
  document.querySelector('#profile-favorites').onclick = () => { filter = 'saved'; navigate('journal'); };
  document.querySelector('#profile-badges').onclick = () => navigate('achievements');
  document.querySelector('#export-backup').onclick = () => { state.lastBackup = new Date().toISOString(); save(); download(new Blob([JSON.stringify({ format: STORAGE_KEY, data: state }, null, 2)], { type: 'application/json' }), '暖日试阅资料.json'); renderProfile(); toast('试阅资料已打包'); };
  document.querySelector('#import-backup').onclick = () => document.querySelector('#backup-file').click();
  document.querySelector('#backup-file').onchange = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try { const backup = JSON.parse(await file.text()); if (backup.format !== STORAGE_KEY || !Array.isArray(backup.data?.trips) || !Array.isArray(backup.data?.badges) || typeof backup.data?.nickname !== 'string' || typeof backup.data?.bio !== 'string') throw new Error();
      // 仅接受本版本导出的资料，不读取正式版的 ZIP 或数据库。
      if (!backup.data.trips.every((trip) => typeof trip.id === 'string' && typeof trip.title === 'string' && typeof trip.city === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trip.date) && Array.isArray(trip.notes) && typeof trip.image === 'string' && /^(assets\/|data:image\/)/.test(trip.image))) throw new Error();
      if (!confirm('导入会替换当前试阅资料，原来的正式版不会受影响。继续吗？')) return;
      state = backup.data; if (save()) { render(); toast('试阅资料已恢复'); }
    } catch { toast('请选择这个试阅版导出的 JSON 备份'); }
  };
}

document.querySelector('#about').onclick = () => modal('关于暖日试阅版', '<div class="modal-body"><p>旅行记录、旅途成就、个人中心的独立设计尝试。使用示例内容和风景配图，不代表你的真实记录；所有改动只保存在本试阅版。</p><p>参考了这些产品的照片浏览、旅行相册与回忆整理方式：</p><div class="reference-links"><a href="https://www.polarsteps.com/" target="_blank" rel="noopener">Polarsteps · 旅行相册与路线</a><a href="https://dayoneapp.com/guides/tips-and-tutorials/journal-views-in-day-one-for-ios/" target="_blank" rel="noopener">Day One · 日记的不同浏览方式</a><a href="https://1se.co/" target="_blank" rel="noopener">1 Second Everyday · 日常回忆</a></div><p><small>风景示例：Unsplash。当前正式版源码快照保存在项目 work 目录。</small></p></div>');
render();
