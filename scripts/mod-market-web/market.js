(() => {
  const pageBase = new URL(location.pathname.replace(/\/?$/, '/') , location.origin);
  const apiUrl = (path) => new URL('api/' + path.replace(/^\//, ''), pageBase);
  const lang = (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const readJson = (raw, fallback) => {
    try { return JSON.parse(raw); } catch { return fallback; }
  };
  const downloaded = new Set(readJson(localStorage.getItem('shinawase-market-downloaded') || '[]', []));
  const viewed = new Set(readJson(sessionStorage.getItem('shinawase-market-viewed') || '[]', []));
  const state = { mods: [], query: '', tag: '', updatedAt: '', detail: null, user: null, manageOpen: '', manageScope: 'mine', randomPick: null, recPage: 1, listPage: 1 };
  const shuffleMods = (count) => {
    const pool = state.mods.filter((item) => !item.unlisted);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    return pool.slice(0, Math.min(count || RANDOM_COUNT, pool.length));
  };
  const STORE_COLS = 3;
  const LIST_PAGE = 6;
  const REC_PAGE = 3;
  const RANDOM_COUNT = 3;
  const slicePage = (items, page, size) => {
    const pages = Math.max(1, Math.ceil((items.length || 0) / size) || 1);
    const current = Math.min(Math.max(1, page || 1), pages);
    return { page: current, pages, items: items.slice((current - 1) * size, current * size) };
  };
  const storeColumns = () => {
    try {
      if (window.matchMedia('(max-width: 640px)').matches) return 1;
      if (window.matchMedia('(max-width: 980px)').matches) return 2;
    } catch {}
    return STORE_COLS;
  };
  const padStoreRow = (nodes) => {
    const list = Array.isArray(nodes) ? [...nodes] : [];
    const columns = storeColumns();
    if (!list.length || columns < 2) return list;
    const rem = list.length % columns;
    if (rem) {
      for (let i = rem; i < columns; i += 1) {
        const slot = document.createElement('div');
        slot.className = 'store-slot';
        slot.setAttribute('aria-hidden', 'true');
        list.push(slot);
      }
    }
    return list;
  };
  const paintPager = (host, pages, page, onPage) => {
    if (!host) return;
    host.replaceChildren();
    host.hidden = false;
    const total = Math.max(1, pages || 1);
    const add = (label, target, current) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (current) button.className = 'is-current';
      if (target && target !== page) button.onclick = () => onPage(target);
      else if (!current) button.disabled = true;
      host.append(button);
    };
    add('‹', page > 1 ? page - 1 : 0, false);
    for (let n = 1; n <= total; n += 1) add(String(n), n, n === page);
    add('›', page < total ? page + 1 : 0, false);
  };
  const assetUrl = (value) => {
    try { return new URL(String(value || ''), pageBase).href; } catch { return String(value || ''); }
  };
  const $ = (sel) => document.querySelector(sel);
  const api = (path, options = {}) => fetch(apiUrl(path), {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });

  const textOf = (item, key) => {
    const zh = item[key + 'Zh'] || '';
    const en = item[key] || item[key + 'En'] || '';
    return lang === 'zh' ? (zh || en) : (en || zh);
  };
  const formatBytes = (value) => {
    const size = Number(value) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB';
    return (size / (1024 * 1024)).toFixed(2) + ' MB';
  };
  const formatCount = (value) => {
    const n = Number(value) || 0;
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(n / 1000) + 'k';
  };
  const searchScore = (item, query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 1;
    const name = textOf(item, 'name').toLowerCase();
    const desc = (textOf(item, 'description') + ' ' + textOf(item, 'intro')).toLowerCase();
    const ident = String(item.id || '').toLowerCase();
    const author = String(item.author || '').toLowerCase();
    const tags = (item.tags || []).map((tag) => String(tag).toLowerCase());
    let score = 0;
    if (name === q) score += 200;
    else if (name.startsWith(q)) score += 120;
    else if (name.includes(q)) score += 80;
    if (ident.includes(q)) score += 70;
    if (tags.some((tag) => tag === q || tag.includes(q))) score += 60;
    if (desc.includes(q)) score += 24;
    if (author.includes(q)) score += 16;
    return score;
  };
  const recommendScore = (item, installed, tags) => {
    if (item.unlisted || installed.has(item.id)) return 0;
    let score = 0;
    if (item.featured) score += 48;
    if (item.channel === 'official') score += 18;
    for (const tag of item.tags || []) if (tags.has(tag)) score += 14;
    const downloads = Number(item.downloads) || 0;
    const views = Number(item.views) || 0;
    if (downloads > 0) score += Math.min(24, Math.sqrt(downloads) * 2.2);
    if (views > 0) score += Math.min(12, Math.sqrt(views));
    const uploaded = Date.parse(item.uploadedAt || '') || 0;
    if (uploaded && Date.now() - uploaded < 14 * 86400000) score += 8;
    return score;
  };
  const toast = (message, type = 'info') => {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    $('[data-toasts]').append(el);
    setTimeout(() => el.remove(), 4200);
  };
  const postEvent = (type, id) => api('event', {
    method: 'POST',
    body: JSON.stringify({ type, id }),
  }).catch(() => {});
  const canManage = (item) => {
    if (!state.user || !item) return false;
    if (state.user.isAdmin) return true;
    return String(item.authorId || '') === String(state.user.id);
  };
  const renderMarkdown = (host, source) => {
    host.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'md';
    const lines = String(source || '').replaceAll('\r\n', '\n').split('\n');
    let i = 0;
    let para = [];
    const flush = () => {
      if (!para.length) return;
      const p = document.createElement('p');
      p.textContent = para.join(' ');
      wrap.append(p);
      para = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('```')) {
        flush();
        const buf = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i += 1; }
        const pre = document.createElement('pre');
        pre.textContent = buf.join('\n');
        wrap.append(pre);
        i += 1;
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flush();
        const el = document.createElement('h' + Math.min(4, heading[1].length + 1));
        el.textContent = heading[2];
        wrap.append(el);
        i += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        flush();
        const ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          li.textContent = lines[i].replace(/^\s*[-*]\s+/, '');
          ul.append(li);
          i += 1;
        }
        wrap.append(ul);
        continue;
      }
      if (!line.trim()) { flush(); i += 1; continue; }
      para.push(line.trim());
      i += 1;
    }
    flush();
    if (!wrap.childElementCount) {
      const p = document.createElement('p');
      p.textContent = '作者还没有填写 README。';
      wrap.append(p);
    }
    host.append(wrap);
  };
  const iconFor = (item) => item.iconDataUrl || item.icon || '';
  const appendIcon = (host, item, size) => {
    const src = iconFor(item);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.width = size;
      img.height = size;
      host.append(img);
      return;
    }
    const fallback = document.createElement('span');
    fallback.className = 'icon-fallback';
    fallback.textContent = (textOf(item, 'name') || '?').slice(0, 1);
    host.append(fallback);
  };
  const card = (item, action) => {
    const el = document.createElement('article');
    el.className = 'card store-card';
    const top = document.createElement('div');
    top.className = 'store-top';
    appendIcon(top, item, 56);
    const copy = document.createElement('div');
    copy.className = 'copy';
    copy.innerHTML = '<h2></h2><div class="byline"></div><p></p>';
    top.append(copy);
    el.append(top);
    el.querySelector('h2').textContent = textOf(item, 'name') || item.id;
    el.querySelector('h2').onclick = () => void openDetail(item.id);
    el.querySelector('.byline').textContent = (item.author || '') + '  ★ ' + formatCount(item.downloads) + '  ·  ' + formatCount(item.views);
    el.querySelector('p').textContent = textOf(item, 'description') || item.id;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const detail = document.createElement('button');
    detail.type = 'button';
    detail.className = 'btn ghost';
    detail.textContent = '介绍';
    detail.onclick = () => void openDetail(item.id);
    const link = document.createElement('a');
    link.className = 'get';
    link.href = assetUrl(item.file);
    link.download = '';
    link.textContent = action || '安装';
    link.addEventListener('click', () => {
      downloaded.add(item.id);
      localStorage.setItem('shinawase-market-downloaded', JSON.stringify([...downloaded]));
      void postEvent('download', item.id);
    });
    actions.append(detail, link);
    el.append(actions);
    return el;
  };
  const empty = (title, hint) => {
    const el = document.createElement('div');
    el.className = 'empty';
    el.innerHTML = '<strong></strong><p></p>';
    el.querySelector('strong').textContent = title;
    el.querySelector('p').textContent = hint;
    return el;
  };
  const filtered = () => {
    const q = state.query.trim();
    return state.mods.map((item) => ({ item, score: searchScore(item, q) }))
      .filter((row) => row.score > 0)
      .filter((row) => !state.tag || (row.item.tags || []).includes(state.tag))
      .sort((a, b) => b.score - a.score || String(textOf(a.item, 'name')).localeCompare(textOf(b.item, 'name')))
      .map((row) => row.item);
  };
  const recommended = () => {
    const tags = new Set();
    state.mods.forEach((item) => { if (downloaded.has(item.id)) (item.tags || []).forEach((tag) => tags.add(tag)); });
    return state.mods.map((item) => ({ item, score: recommendScore(item, downloaded, tags) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item);
  };
  const renderSuggest = () => {
    const box = $('[data-suggest]');
    const q = state.query.trim();
    if (!q || document.activeElement !== $('[data-search]')) {
      box.hidden = true;
      return;
    }
    const hits = filtered().slice(0, 6);
    if (!hits.length) {
      box.hidden = true;
      return;
    }
    box.replaceChildren(...hits.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<span></span><small></small>';
      button.querySelector('span').textContent = textOf(item, 'name') || item.id;
      button.querySelector('small').textContent = item.id;
      button.onclick = () => {
        state.query = textOf(item, 'name') || item.id;
        $('[data-search]').value = state.query;
        box.hidden = true;
        render();
      };
      return button;
    }));
    box.hidden = false;
  };
  const renderTags = () => {
    const counts = new Map();
    state.mods.forEach((item) => (item.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
    const host = $('[data-tags]');
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (state.tag ? '' : ' active');
    all.innerHTML = '全部<span class="n"></span>';
    all.querySelector('.n').textContent = String(state.mods.length);
    all.onclick = () => { state.tag = ''; state.listPage = 1; state.recPage = 1; render(); };
    const chips = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([tag, count]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (state.tag === tag ? ' active' : '');
      chip.innerHTML = '<span></span><span class="n"></span>';
      chip.querySelector('span').textContent = tag;
      chip.querySelector('.n').textContent = String(count);
      chip.onclick = () => { state.tag = state.tag === tag ? '' : tag; state.listPage = 1; state.recPage = 1; render(); };
      return chip;
    });
    host.replaceChildren(all, ...chips);
  };
  const closeDetail = () => {
    state.detail = null;
    const overlay = $('[data-overlay]');
    overlay.hidden = true;
    overlay.replaceChildren();
    if (location.hash.startsWith('#mod/')) history.replaceState(null, '', location.pathname + location.search);
  };
  const openDetail = async (id) => {
    const overlay = $('[data-overlay]');
    overlay.hidden = false;
    overlay.replaceChildren();
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<header><div class="sheet-hero"></div><button class="btn ghost" type="button" data-close>关闭</button></header><div class="sheet-body"></div><footer></footer>';
    overlay.append(sheet);
    sheet.querySelector('[data-close]').onclick = closeDetail;
    overlay.onclick = (event) => { if (event.target === overlay) closeDetail(); };
    if (location.hash !== '#mod/' + id) history.replaceState(null, '', '#mod/' + id);
    try {
      const res = await api('mod/' + encodeURIComponent(id));
      const val = await res.json();
      if (!res.ok || val.ok === false) throw new Error(val.error || 'not found');
      const item = val.mod || {};
      state.detail = val;
      if (!viewed.has(id)) {
        viewed.add(id);
        sessionStorage.setItem('shinawase-market-viewed', JSON.stringify([...viewed]));
        void postEvent('view', id);
        item.views = (Number(item.views) || 0) + 1;
        const local = state.mods.find((row) => row.id === id);
        if (local) local.views = item.views;
      }
      const hero = sheet.querySelector('.sheet-hero');
      appendIcon(hero, item, 56);
      const heading = document.createElement('div');
      heading.innerHTML = '<div class="kicker"></div><h2></h2>';
      heading.querySelector('.kicker').textContent = item.author || (item.channel === 'official' ? '官方' : '社区');
      heading.querySelector('h2').textContent = textOf(item, 'name') || item.id;
      hero.append(heading);
      const body = sheet.querySelector('.sheet-body');
      const stats = document.createElement('div');
      stats.className = 'meta';
      [['下载', item.downloads], ['浏览', item.views], ['安装', item.installs], ['v' + (item.version || '1.0.0'), null], [formatBytes(item.size), null]].forEach(([label, count]) => {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = count == null ? label : label + ' ' + formatCount(count);
        stats.append(badge);
      });
      const intro = document.createElement('p');
      intro.className = 'sheet-intro';
      intro.textContent = textOf(item, 'intro') || textOf(item, 'description') || '';
      const readme = document.createElement('div');
      renderMarkdown(readme, val.readme || '');
      body.append(stats, intro, readme);
      const footer = sheet.querySelector('footer');
      if (val.canManage || canManage(item)) {
        const manage = document.createElement('button');
        manage.type = 'button';
        manage.className = 'btn ghost';
        manage.textContent = '去管理';
        manage.onclick = () => { closeDetail(); showView('manage', item.id); };
        footer.append(manage);
      }
      const link = document.createElement('a');
      link.className = 'get';
      link.href = assetUrl(item.file);
      link.download = '';
      link.textContent = '下载';
      link.onclick = () => void postEvent('download', id);
      footer.append(link);
    } catch (error) {
      sheet.querySelector('.sheet-body').textContent = String(error.message || error);
    }
  };
  const ownedMods = () => (state.mods || []).filter((item) => String(item.authorId || '') === String(state.user?.id || ''));
  const managedMods = () => {
    if (state.user?.isAdmin && state.manageScope === 'all') return state.mods || [];
    return ownedMods();
  };
  const runBusy = async (button, work) => {
    if (!button || button.disabled) return;
    button.disabled = true;
    try { await work(); } finally { button.disabled = false; }
  };
  const showView = (name, focusId) => {
    const market = $('[data-app]');
    const manage = $('[data-manage]');
    const navMarket = $('[data-nav-market]');
    const navManage = $('[data-nav-manage]');
    const onManage = name === 'manage';
    if (focusId && state.user?.isAdmin && !ownedMods().some((item) => item.id === focusId)) state.manageScope = 'all';
    if (focusId) state.manageOpen = focusId;
    if (market) market.hidden = onManage || !state.user;
    if (manage) manage.hidden = !onManage || !state.user;
    if (navMarket) navMarket.classList.toggle('is-here', !onManage);
    if (navManage) {
      navManage.hidden = !state.user;
      navManage.classList.toggle('is-here', onManage);
    }
    if (onManage) {
      if (location.hash !== '#manage') history.replaceState(null, '', '#manage');
      renderManage();
    } else if (location.hash.startsWith('#manage')) {
      history.replaceState(null, '', location.pathname);
    }
  };
  const renderManage = () => {
    const host = $('[data-manage-list]');
    if (!host) return;
    const items = managedMods();
    const scope = document.createElement('div');
    scope.className = 'manage-scope';
    if (state.user?.isAdmin) {
      [['mine', '我的插件'], ['all', '全部插件']].forEach(([id, label]) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (state.manageScope === id ? ' active' : '');
        chip.textContent = label;
        chip.onclick = () => { state.manageScope = id; renderManage(); };
        scope.append(chip);
      });
    }
    if (!items.length) {
      host.replaceChildren(scope, empty('没有可管理的插件', state.user?.isAdmin && state.manageScope === 'mine' ? '你还没有上传。管理员可切换到「全部插件」。' : '上传之后会出现在这里。'));
      if (!state.user?.isAdmin) scope.remove();
      return;
    }
    const cards = items.map((item) => {
      const open = state.manageOpen === item.id;
      const card = document.createElement('article');
      card.className = 'manage-card' + (open ? ' is-open' : '');
      card.dataset.id = item.id;
      card.innerHTML = '<header><div><div class="kicker"></div><h2></h2></div><span class="badge" data-state></span></header><div class="manage-actions" data-row></div><div class="manage-editor" data-editor hidden></div>';
      card.querySelector('.kicker').textContent = item.id;
      card.querySelector('h2').textContent = textOf(item, 'name') || item.id;
      card.querySelector('[data-state]').textContent = item.unlisted ? '已下架' : '已上架';
      if (item.channel === 'official') card.querySelector('[data-state]').classList.add('official');
      const row = card.querySelector('[data-row]');
      const editor = card.querySelector('[data-editor]');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn ghost';
      edit.textContent = open ? '收起' : '编辑';
      edit.onclick = () => {
        state.manageOpen = open ? '' : item.id;
        renderManage();
      };
      const unlist = document.createElement('button');
      unlist.type = 'button';
      unlist.className = 'btn ghost';
      unlist.textContent = item.unlisted ? '重新上架' : '下架';
      unlist.onclick = () => runBusy(unlist, async () => {
        const res = await api(item.unlisted ? 'relist' : 'unlist', { method: 'POST', body: JSON.stringify({ id: item.id }) });
        const saved = await res.json().catch(() => ({}));
        if (!res.ok || saved.ok === false) throw new Error(saved.error || ('HTTP ' + res.status));
        toast(item.unlisted ? '已重新上架' : '已下架', 'success');
        await load({ stay: 'manage' });
      }).catch((error) => toast(String(error.message || error), 'error'));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn danger';
      del.textContent = '删除';
      del.onclick = () => runBusy(del, async () => {
        const name = textOf(item, 'name') || item.id;
        if (item.channel === 'official' && !window.confirm('这是官方插件。删除会从市场隐藏并锁定 id，社区无法再上传「' + name + '」。')) return;
        if (!window.confirm('确定删除「' + name + '」？文件会从市场移除，无法恢复。')) return;
        const res = await api('delete', { method: 'POST', body: JSON.stringify({ id: item.id }) });
        const saved = await res.json().catch(() => ({}));
        if (!res.ok || saved.ok === false) throw new Error(saved.error || ('HTTP ' + res.status));
        toast('已删除 ' + name, 'success');
        state.manageOpen = '';
        await load({ stay: 'manage' });
      }).catch((error) => toast(String(error.message || error), 'error'));
      row.append(edit, unlist, del);
      if (open) {
        editor.hidden = false;
        editor.innerHTML = '<textarea data-intro></textarea><textarea data-readme></textarea><div class="manage-actions"></div>';
        const introBox = editor.querySelector('[data-intro]');
        const readmeBox = editor.querySelector('[data-readme]');
        introBox.placeholder = '介绍页文案';
        introBox.value = textOf(item, 'intro') || textOf(item, 'description') || '';
        readmeBox.placeholder = 'README.md';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn';
        save.textContent = '保存介绍';
        save.onclick = () => runBusy(save, async () => {
          const res = await api('page', {
            method: 'POST',
            body: JSON.stringify({ id: item.id, intro: introBox.value, introZh: introBox.value, readme: readmeBox.value }),
          });
          const saved = await res.json().catch(() => ({}));
          if (!res.ok || saved.ok === false) throw new Error(saved.error || 'save failed');
          toast('介绍页已保存', 'success');
          await load({ stay: 'manage' });
        }).catch((error) => toast(String(error.message || error), 'error'));
        editor.querySelector('.manage-actions').append(save);
        void api('mod/' + encodeURIComponent(item.id)).then((row) => row.json()).then((val) => {
          if (val && val.readme) readmeBox.value = val.readme;
        }).catch(() => {});
      }
      return card;
    });
    host.replaceChildren(scope, ...cards);
    if (state.manageOpen) host.querySelector('[data-id="' + String(state.manageOpen).replace(/"/g, '') + '"]')?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    renderTags();
    renderSuggest();
    const searching = Boolean(state.query.trim() || state.tag);
    const recWrap = $('[data-recommend-wrap]');
    const recHost = $('[data-recommend]');
    const hideRec = Boolean(searching || state.mods.length <= LIST_PAGE);
    const recPool = hideRec ? [] : recommended();
    recWrap.hidden = hideRec || !recPool.length;
    const recPage = slicePage(recPool, state.recPage, REC_PAGE);
    state.recPage = recPage.page;
    recHost.replaceChildren(...padStoreRow(recPage.items.map((item) => card(item, '获取'))));
    paintPager($('[data-recommend-pager]'), recPage.pages, recPage.page, (page) => { state.recPage = page; render(); });
    const recPager = $('[data-recommend-pager]');
    if (recPager) recPager.hidden = recWrap.hidden;
    const items = filtered();
    const listPage = slicePage(items, state.listPage, LIST_PAGE);
    state.listPage = listPage.page;
    $('[data-count]').textContent = String(items.length);
    const list = $('[data-list]');
    if (!items.length) list.replaceChildren(empty('没有匹配的插件', '试试其他关键词或标签。'));
    else list.replaceChildren(...padStoreRow(listPage.items.map((item) => card(item))));
    paintPager($('[data-list-pager]'), listPage.pages, listPage.page, (page) => { state.listPage = page; render(); });
    const listPager = $('[data-list-pager]');
    if (listPager) listPager.hidden = !items.length;
    const randomWrap = $('[data-random-wrap]');
    const randomHost = $('[data-random]');
    const hideRandom = searching || !state.mods.length;
    if (hideRandom) {
      if (randomWrap) randomWrap.hidden = true;
    } else {
      if (!state.randomPick) state.randomPick = shuffleMods(RANDOM_COUNT);
      if (randomWrap) randomWrap.hidden = !state.randomPick.length;
      if (randomHost) randomHost.replaceChildren(...padStoreRow(state.randomPick.map((item) => card(item))));
    }
    $('[data-footer]').textContent = `${state.mods.length} 个插件` + (state.updatedAt ? ' · 更新于 ' + state.updatedAt : '');
    $('[data-search-clear]').hidden = !state.query;
  };
  const fileToBase64 = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const upload = async (file) => {
    if (!file) return;
    if (!state.user) {
      toast('请先登录 Echow4seHub', 'error');
      return;
    }
    toast('正在上传 ' + file.name);
    try {
      const data = await fileToBase64(file);
      const res = await api('upload', {
        method: 'POST',
        body: JSON.stringify({ data, name: file.name }),
      });
      const val = await res.json().catch(() => ({}));
      if (!res.ok || val.ok === false) throw new Error(val.error || 'upload failed');
      toast('已发布 ' + (val.mod?.name || file.name), 'success');
      await load();
    } catch (error) {
      toast(String(error.message || error), 'error');
    }
  };
  const bindDrop = () => {
    const drop = $('[data-drop]');
    const input = $('[data-file]');
    const needLogin = () => {
      if (state.user) return false;
      const overlay = $('[data-login-overlay]');
      if (overlay) overlay.hidden = false;
      return true;
    };
    drop.onclick = () => { if (needLogin()) return; input.click(); };
    input.onchange = () => { upload(input.files?.[0]); input.value = ''; };
    drop.ondragover = (event) => { event.preventDefault(); if (state.user) drop.classList.add('is-over'); };
    drop.ondragleave = () => drop.classList.remove('is-over');
    drop.ondrop = (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
      if (needLogin()) return;
      void upload(event.dataTransfer?.files?.[0]);
    };
  };
  const bindSearch = () => {
    const input = $('[data-search]');
    const clear = $('[data-search-clear]');
    input.addEventListener('input', () => { state.query = input.value; state.listPage = 1; state.recPage = 1; render(); });
    input.addEventListener('focus', renderSuggest);
    input.addEventListener('blur', () => setTimeout(() => { $('[data-suggest]').hidden = true; }, 180));
    clear.onclick = () => { input.value = ''; state.query = ''; state.listPage = 1; state.recPage = 1; render(); input.focus(); };
    window.addEventListener('hashchange', () => {
      if (location.hash.startsWith('#manage')) {
        closeDetail();
        showView('manage');
        return;
      }
      const id = location.hash.startsWith('#mod/') ? location.hash.slice(5) : '';
      showView('market');
      if (id) void openDetail(id);
      else closeDetail();
    });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
    const navMarket = $('[data-nav-market]');
    if (navMarket) navMarket.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
      event.preventDefault();
      closeDetail();
      showView('market');
    });
    const back = $('[data-manage-back]');
    if (back) back.addEventListener('click', (event) => {
      event.preventDefault();
      showView('market');
    });
    const shuffle = $('[data-random-shuffle]');
    if (shuffle) shuffle.addEventListener('click', () => {
      state.randomPick = shuffleMods(RANDOM_COUNT);
      render();
    });
    const loginLink = $('[data-login-link]');
    const loginOverlay = $('[data-login-overlay]');
    if (loginLink && loginOverlay) {
      loginLink.addEventListener('click', (event) => {
        event.preventDefault();
        loginOverlay.hidden = false;
      });
      loginOverlay.addEventListener('click', (event) => {
        if (event.target === loginOverlay) loginOverlay.hidden = true;
      });
    }
  };
  const load = async (opts = {}) => {
    const stayManage = opts.stay === 'manage' || location.hash.startsWith('#manage');
    const me = await api('me').then((row) => row.json()).catch(() => ({}));
    state.user = me.user || null;
    const gate = $('[data-gate]');
    const app = $('[data-app]');
    const userEl = $('[data-user]');
    const hideManage = () => {
      const manage = $('[data-manage]');
      if (manage) manage.hidden = true;
      const navManage = $('[data-nav-manage]');
      if (navManage) navManage.hidden = true;
    };
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    const drop = $('[data-drop]');
    if (drop) {
      drop.hidden = false;
      drop.classList.toggle('is-locked', !state.user);
    }
    const loginLink = $('[data-login-link]');
    if (loginLink) loginLink.hidden = Boolean(state.user);
    const loginOverlay = $('[data-login-overlay]');
    if (state.user && loginOverlay) loginOverlay.hidden = true;
    if (!state.user) {
      if (userEl) userEl.hidden = true;
      hideManage();
    } else {
      if (userEl) {
        userEl.hidden = false;
        userEl.textContent = (state.user.displayName || state.user.username) + (state.user.isAdmin ? ' · 管理' : '');
      }
      const navManage = $('[data-nav-manage]');
      if (navManage) navManage.hidden = false;
    }
    const res = await api('catalog');
    if (!res.ok) {
      if (app) app.hidden = false;
      hideManage();
      return;
    }
    const catalog = await res.json();
    const seen = new Set();
    state.mods = (Array.isArray(catalog.mods) ? catalog.mods : []).filter((item) => {
      const ident = String(item?.id || '');
      if (!ident || seen.has(ident)) return false;
      seen.add(ident);
      return true;
    });
    state.updatedAt = catalog.updatedAt || '';
    render();
    showView(stayManage ? 'manage' : 'market');
  };
  bindDrop();
  bindSearch();
  load().then(() => {
    const id = location.hash.startsWith('#mod/') ? location.hash.slice(5) : '';
    if (id) void openDetail(id);
  }).catch((error) => {
    $('[data-list]').replaceChildren(empty('无法连接插件市场', String(error.message || error)));
  });
})();
