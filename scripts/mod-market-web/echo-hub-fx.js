(function () {
function setupMotion() {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var sync = function () {
    var on = !reduce.matches && !document.hidden;
    root.classList.toggle('echo-motion', on);
    root.classList.toggle('echo-pixel', true);
    root.classList.toggle('echo-motion-paused', document.hidden);
  };
  sync();
  document.addEventListener('visibilitychange', sync);
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
}

function motionOK() {
  return (
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    document.documentElement.classList.contains('echo-motion')
  );
}

function removeToys() {
  var dock = document.querySelector('.echo-toys');
  if (dock) dock.remove();
}

function injectSky() {
  var sky = document.querySelector('.echo-sky');
  if (!sky) {
    sky = document.createElement('div');
    sky.className = 'echo-sky';
    sky.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sky);
  }
  if (!sky.querySelector('.echo-sky__field')) {
    sky.innerHTML =
      '<div class="echo-sky__aurora"></div>' +
      '<div class="echo-sky__shafts"></div>' +
      '<div class="echo-sky__horizon"></div>' +
      '<div class="echo-sky__field"></div>';
  }
}

function tickerGroup(items) {
  return (
    '<span class="echo-ticker__group">' +
    items
      .map(function (item) {
        return '<span class="echo-ticker__item">' + item + '</span>';
      })
      .join('') +
    '</span>'
  );
}

function injectTicker() {
  if (document.querySelector('.echo-ticker')) {
    document.documentElement.classList.add('echo-has-ticker');
    placeTicker(document.querySelector('.echo-ticker'));
    return;
  }
  var items = [
    'NOW PLAYING ♪ Pearl — Kirara Magic',
    'ECHO HUB · 一起听，一起聊',
    'BIT-PERFECT 直通中',
    'DSD NATIVE · DSF/DFF',
    'FLAC · WAV · APE · ALAC',
    'WASAPI EXCLUSIVE + ASIO',
    '僕らは今、花の塔の上',
    '本地曲库 · 原采样直通 ☆',
  ];
  var ticker = document.createElement('div');
  ticker.className = 'echo-ticker';
  ticker.setAttribute('data-ticker', '');
  ticker.innerHTML =
    '<button type="button" class="echo-ticker__cap" data-onair aria-pressed="true" aria-label="切换电台走带（ON AIR / OFF AIR）">' +
    '<i class="echo-ticker__dot" aria-hidden="true"></i>' +
    '<span class="echo-ticker__cap-label" data-onair-label>ON AIR</span>' +
    '<span class="echo-ticker__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '</button>' +
    '<div class="echo-ticker__viewport" aria-hidden="true">' +
    '<div class="echo-ticker__track">' +
    tickerGroup(items) +
    tickerGroup(items) +
    '</div>' +
    '</div>' +
    '<span class="echo-ticker__tail" aria-hidden="true">' +
    '<i class="echo-ticker__reel echo-ticker__reel--a"></i>' +
    '<i class="echo-ticker__tape"></i>' +
    '<i class="echo-ticker__reel echo-ticker__reel--b"></i>' +
    '</span>' +
    '<span class="echo-ticker__progress" aria-hidden="true"></span>';
  placeTicker(ticker);
  document.documentElement.classList.add('echo-has-ticker');
}

function placeTicker(ticker) {
  if (!ticker) return;
  if (!ticker.parentNode) document.body.appendChild(ticker);
}

function bindTicker() {
  var ticker = document.querySelector('.echo-ticker');
  if (!ticker || ticker.dataset.bound) return;
  ticker.dataset.bound = '1';
  var cap = ticker.querySelector('[data-onair]');
  var label = ticker.querySelector('[data-onair-label]');
  if (!cap) return;
  cap.addEventListener('click', function () {
    var off = ticker.classList.toggle('is-off');
    cap.setAttribute('aria-pressed', String(!off));
    if (label) label.textContent = off ? 'OFF AIR' : 'ON AIR';
    setDeckPlaying(!off);
  });
}

var ECHO_NETEASE_ID = '3332717302';
var ECHO_PEARL_SRC = (document.currentScript && document.currentScript.src) ? new URL('echo-pearl.mp3', document.currentScript.src).href : 'echo-pearl.mp3';
var echoDeckWanted = true;
var echoDeckAudio = null;

function injectDeck() {
  var existing = document.querySelector('.echo-deck');
  if (existing && existing.querySelector('.echo-deck__audio')) {
    ensureDeckToggle(existing);
    return;
  }
  if (existing) existing.remove();
  var deck = document.createElement('aside');
  deck.className = 'echo-deck';
  deck.setAttribute('aria-label', '正在播放 Pearl — Kirara Magic');
  deck.innerHTML =
    '<div class="echo-deck__chrome">' +
    '<i class="echo-deck__lamp" aria-hidden="true"></i>' +
    '<div class="echo-deck__meta">' +
    '<span class="echo-deck__eyebrow">NOW PLAYING</span>' +
    '<strong class="echo-deck__title">Pearl</strong>' +
    '<span class="echo-deck__artist">Kirara Magic</span>' +
    '</div>' +
    '<span class="echo-deck__eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
    '<a class="echo-deck__cloud" href="https://music.163.com/song?id=' +
    ECHO_NETEASE_ID +
    '" target="_blank" rel="noopener noreferrer">网易云</a>' +
    '</div>' +
    '<div class="echo-deck__stage">' +
    '<i class="echo-deck__vinyl" aria-hidden="true"></i>' +
    '<div class="echo-deck__transport">' +
    '<button type="button" class="echo-deck__play" aria-label="播放或暂停">播放</button>' +
    '<div class="echo-deck__bar" data-echo-seek><b></b></div>' +
    '<span class="echo-deck__time">0:00</span>' +
    '</div>' +
    '<audio class="echo-deck__audio" preload="auto" playsinline loop></audio>' +
    '</div>';
  document.body.appendChild(deck);
  ensureDeckToggle(deck);
}

function ensureDeckToggle(deck) {
  if (!deck.querySelector('.echo-deck__toggle')) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'echo-deck__toggle';
    btn.innerHTML = '<i class="echo-deck__chevron" aria-hidden="true"></i>';
    deck.appendChild(btn);
  }
  applyDeckStowed(deck, readDeckStowed());
}

function readDeckStowed() {
  try {
    return localStorage.getItem('echoDeckStowed') === '1';
  } catch (e) {
    return false;
  }
}

function applyDeckStowed(deck, on) {
  if (!deck) return;
  deck.classList.toggle('is-stowed', !!on);
  var toggle = deck.querySelector('.echo-deck__toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(!on));
  toggle.setAttribute('aria-label', on ? '展开播放器' : '收起播放器');
  toggle.setAttribute('title', on ? '展开播放器' : '收起播放器');
}

function setDeckStowed(on) {
  var deck = document.querySelector('.echo-deck');
  applyDeckStowed(deck, on);
  try {
    localStorage.setItem('echoDeckStowed', on ? '1' : '0');
  } catch (e) {}
}

function deckClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function syncDeckFace() {
  var deck = document.querySelector('.echo-deck');
  var audio = echoDeckAudio;
  if (!deck || !audio) return;
  var playing = !audio.paused && !audio.ended;
  deck.classList.toggle('is-off', !playing);
  deck.classList.toggle('is-on', playing);
  var play = deck.querySelector('.echo-deck__play');
  if (play) {
    play.textContent = playing && audio.muted ? '开声' : playing ? '暂停' : '播放';
  }
  var bar = deck.querySelector('.echo-deck__bar b');
  var time = deck.querySelector('.echo-deck__time');
  var ratio = audio.duration ? audio.currentTime / audio.duration : 0;
  if (bar) bar.style.width = Math.round(Math.min(1, Math.max(0, ratio)) * 100) + '%';
  if (time) time.textContent = deckClock(audio.currentTime);
}

function tryDeckPlay(fromGesture) {
  var audio = echoDeckAudio;
  if (!audio || !echoDeckWanted) return;
  if (fromGesture) audio.muted = false;
  var run = audio.play();
  if (run && run.catch) {
    run.catch(function () {
      if (fromGesture || !echoDeckWanted) return;
      audio.muted = true;
      audio.play().catch(function () {});
    });
  }
  syncDeckFace();
}

function setDeckPlaying(on) {
  echoDeckWanted = !!on;
  var deck = document.querySelector('.echo-deck');
  var audio = echoDeckAudio;
  if (deck) deck.classList.toggle('is-off', !on);
  if (!audio) return;
  if (on) {
    tryDeckPlay(true);
  } else {
    audio.pause();
    syncDeckFace();
  }
}

function bindDeckToggle(deck) {
  var toggle = deck.querySelector('.echo-deck__toggle');
  if (!toggle || toggle.dataset.bound) return;
  toggle.dataset.bound = '1';
  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (deck.dataset.echoSwiped === '1') {
      deck.dataset.echoSwiped = '';
      return;
    }
    setDeckStowed(!deck.classList.contains('is-stowed'));
  });
}

function bindDeckSwipe(deck) {
  if (deck.dataset.swipeBound) return;
  deck.dataset.swipeBound = '1';
  var startX = 0;
  var startY = 0;
  var dragging = false;
  var axis = '';

  function ignoreTarget(target) {
    return !!(
      target &&
      target.closest &&
      target.closest('.echo-deck__play, .echo-deck__bar, a.echo-deck__cloud')
    );
  }

  deck.addEventListener('pointerdown', function (event) {
    if (event.button && event.button !== 0) return;
    if (ignoreTarget(event.target)) return;
    startX = event.clientX;
    startY = event.clientY;
    dragging = true;
    axis = '';
    deck.dataset.echoSwiped = '';
  });

  document.addEventListener(
    'pointermove',
    function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!axis && Math.abs(dx) + Math.abs(dy) > 8) {
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
    },
    { passive: true }
  );

  document.addEventListener('pointerup', function (event) {
    if (!dragging) return;
    dragging = false;
    if (axis !== 'x') return;
    var dx = event.clientX - startX;
    var stowed = deck.classList.contains('is-stowed');
    if (!stowed && dx < -48) {
      deck.dataset.echoSwiped = '1';
      setDeckStowed(true);
    } else if (stowed && dx > 36) {
      deck.dataset.echoSwiped = '1';
      setDeckStowed(false);
    }
  });
}

function bindDeck() {
  var deck = document.querySelector('.echo-deck');
  if (!deck) return;
  ensureDeckToggle(deck);
  bindDeckToggle(deck);
  bindDeckSwipe(deck);
  if (deck.dataset.bound) return;
  deck.dataset.bound = '1';
  var audio = deck.querySelector('.echo-deck__audio');
  var play = deck.querySelector('.echo-deck__play');
  var seek = deck.querySelector('[data-echo-seek]');
  if (!audio) return;
  echoDeckAudio = audio;
  audio.src = ECHO_PEARL_SRC;
  audio.loop = true;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');

  audio.addEventListener('timeupdate', syncDeckFace);
  audio.addEventListener('play', syncDeckFace);
  audio.addEventListener('pause', syncDeckFace);
  audio.addEventListener('ended', function () {
    if (!echoDeckWanted) return;
    audio.currentTime = 0;
    tryDeckPlay(true);
  });
  audio.addEventListener('canplay', function () {
    if (echoDeckWanted) tryDeckPlay(false);
  });

  if (play) {
    play.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!audio.paused && audio.muted) {
        audio.muted = false;
        syncDeckFace();
        return;
      }
      setDeckPlaying(!!audio.paused);
      var ticker = document.querySelector('.echo-ticker');
      var cap = ticker && ticker.querySelector('[data-onair]');
      var label = ticker && ticker.querySelector('[data-onair-label]');
      if (ticker) ticker.classList.toggle('is-off', !echoDeckWanted);
      if (cap) cap.setAttribute('aria-pressed', String(echoDeckWanted));
      if (label) label.textContent = echoDeckWanted ? 'ON AIR' : 'OFF AIR';
    });
  }

  if (seek) {
    seek.addEventListener('click', function (event) {
      if (!audio.duration) return;
      var rect = seek.getBoundingClientRect();
      audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
    });
  }

  function unlock(event) {
    if (!echoDeckWanted) return;
    if (event && event.target && event.target.closest && event.target.closest('.echo-deck__play')) {
      return;
    }
    tryDeckPlay(true);
  }

  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('touchstart', unlock, true);
  document.addEventListener('click', unlock, true);

  tryDeckPlay(false);
  window.setTimeout(function () {
    tryDeckPlay(false);
  }, 400);
}

function injectRail() {
  var markup =
    '<button type="button" class="echo-rail__btn" data-echo-rail="top" title="回到顶部" aria-label="回到顶部">↑</button>' +
    '<div class="echo-rail__track" role="slider" aria-label="页面滚动" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
    '<button type="button" class="echo-rail__thumb" aria-label="拖动滚动"><i class="echo-rail__kite"></i></button>' +
    '</div>' +
    '<div class="echo-rail__meter" aria-hidden="true">0</div>' +
    '<button type="button" class="echo-rail__btn" data-echo-rail="bottom" title="去底部" aria-label="去底部">↓</button>';
  var rail = document.querySelector('.echo-rail');
  if (rail) {
    if (!rail.querySelector('.echo-rail__kite')) {
      rail.innerHTML = markup;
      delete rail.dataset.bound;
    }
    return;
  }
  rail = document.createElement('div');
  rail.className = 'echo-rail';
  rail.innerHTML = markup;
  document.body.appendChild(rail);
}

function scrollMax() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function scrollProgress() {
  var max = scrollMax();
  return max <= 0 ? 0 : Math.min(1, Math.max(0, window.pageYOffset / max));
}

function updateRail() {
  var rail = document.querySelector('.echo-rail');
  if (!rail) return;
  var track = rail.querySelector('.echo-rail__track');
  var thumb = rail.querySelector('.echo-rail__thumb');
  var meter = rail.querySelector('.echo-rail__meter');
  if (!track || !thumb) return;
  var p = scrollProgress();
  var room = Math.max(0, track.clientHeight - thumb.offsetHeight);
  thumb.style.top = Math.round(p * room) + 'px';
  track.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  if (meter) meter.textContent = String(Math.round(p * 100));
}

function bindRail() {
  var rail = document.querySelector('.echo-rail');
  if (!rail || rail.dataset.bound) return;
  rail.dataset.bound = '1';
  var track = rail.querySelector('.echo-rail__track');
  var thumb = rail.querySelector('.echo-rail__thumb');
  var dragging = false;

  function jumpFromClientY(clientY) {
    var rect = track.getBoundingClientRect();
    var ratio = (clientY - rect.top) / rect.height;
    window.scrollTo({
      top: Math.round(scrollMax() * Math.min(1, Math.max(0, ratio))),
      behavior: motionOK() ? 'smooth' : 'auto',
    });
  }

  rail.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-echo-rail]');
    if (!btn) return;
    var max = scrollMax();
    window.scrollTo({
      top: btn.getAttribute('data-echo-rail') === 'top' ? 0 : max,
      behavior: motionOK() ? 'smooth' : 'auto',
    });
  });

  track.addEventListener('pointerdown', function (event) {
    if (event.target.closest('.echo-rail__thumb')) return;
    jumpFromClientY(event.clientY);
  });

  thumb.addEventListener('pointerdown', function (event) {
    dragging = true;
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  thumb.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    var rect = track.getBoundingClientRect();
    var ratio = (event.clientY - rect.top) / rect.height;
    window.scrollTo(0, Math.round(scrollMax() * Math.min(1, Math.max(0, ratio))));
  });

  thumb.addEventListener('pointerup', function () {
    dragging = false;
  });
}

function bindParallax() {
  var ticking = false;

  function paint() {
    ticking = false;
    document.documentElement.style.setProperty('--echo-scroll', scrollProgress().toFixed(3));
    updateRail();
  }

  function requestPaint() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(paint);
  }

  document.addEventListener('scroll', requestPaint, { passive: true, capture: true });
  window.addEventListener('resize', requestPaint);
  requestPaint();
}

function floaterSpecs() {
  return [
    ['cloud', 300, 126, 0.58, 15],
    ['cloud', 260, 110, 0.64, 17],
    ['cloud', 340, 140, 0.5, 13],
    ['cloud', 220, 92, 0.7, 18],
    ['cloud', 280, 118, 0.6, 16],
    ['cloud', 200, 84, 0.74, 19],
    ['cloud', 248, 104, 0.66, 17],
    ['cloud', 188, 80, 0.78, 20],
    ['cloud', 160, 70, 0.62, 16],
    ['cloud', 210, 88, 0.68, 18],
    ['sun', 64, 64, 0.92, 12],
    ['moon', 48, 48, 0.88, 11],
    ['star', 34, 34, 0.95, 26],
    ['star', 28, 28, 0.9, 24],
    ['star', 34, 34, 0.95, 28],
    ['star', 22, 22, 0.85, 30],
    ['star', 18, 18, 0.8, 22],
    ['heart', 34, 30, 0.95, 27],
    ['heart', 28, 24, 0.9, 25],
    ['heart', 22, 20, 0.86, 23],
    ['flower', 34, 34, 0.95, 23],
    ['flower', 28, 28, 0.9, 26],
    ['flower', 20, 20, 0.84, 21],
    ['note', 30, 36, 0.95, 29],
    ['note', 24, 28, 0.9, 27],
    ['note', 18, 22, 0.86, 24],
    ['kite', 40, 62, 0.95, 22],
    ['kite', 34, 52, 0.9, 24],
    ['balloon', 28, 52, 0.95, 21],
    ['balloon', 24, 44, 0.9, 23],
    ['lantern', 28, 44, 0.92, 20],
    ['bow', 36, 28, 0.92, 25],
    ['vinyl', 38, 38, 0.92, 22],
    ['cassette', 46, 30, 0.92, 21],
    ['headphones', 46, 30, 0.92, 23],
    ['spark', 22, 22, 0.88, 32],
    ['spark', 18, 18, 0.82, 34],
    ['dust', 16, 16, 0.7, 18],
    ['dust', 14, 14, 0.66, 16],
    ['ticket', 42, 26, 0.92, 24],
    ['fish', 40, 24, 0.92, 31],
    ['plane', 52, 32, 0.95, 58],
    ['bird', 40, 30, 0.95, 52],
    ['pinwheel', 34, 34, 0.92, 26],
    ['comet', 72, 18, 0.95, 64],
  ];
}

function skyActorTarget() {
  var area = window.innerWidth * window.innerHeight;
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var min = coarse ? 20 : 32;
  var max = coarse ? 28 : 46;
  return Math.max(min, Math.min(max, Math.round(area / (coarse ? 42000 : 38000))));
}

function bindSkyLife() {
  if (window.__echoSkyLife || !motionOK()) return;
  window.__echoSkyLife = true;

  var field = document.querySelector('.echo-sky__field');
  if (!field) return;

  var fine = window.matchMedia('(pointer: fine)').matches;
  var mouseX = window.innerWidth * 0.5;
  var mouseY = window.innerHeight * 0.35;
  var hasMouse = false;
  var lastTrail = 0;
  var lastX = 0;
  var lastY = 0;
  var actors = [];
  var last = 0;
  var trailKinds = ['lemon', 'pink', 'sky', 'star'];

  function makeActor(spec) {
    var kind = spec[0];
    var w = spec[1];
    var h = spec[2];
    var el = document.createElement('i');
    if (kind === 'cloud') {
      el.className = 'echo-sky__cloud echo-floater';
    } else if (kind === 'comet') {
      el.className = 'echo-sky__sprite echo-sky__sprite--spark echo-floater';
      el.style.backgroundImage = 'var(--echo-comet)';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    } else {
      el.className = 'echo-sky__sprite echo-sky__sprite--' + kind + ' echo-floater';
    }
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.opacity = String(spec[3]);
    field.appendChild(el);

    var dir = Math.random() < 0.72 ? 1 : -1;
    var speed = spec[4] * (0.82 + Math.random() * 0.36);
    var actor = {
      el: el,
      w: w,
      h: h,
      alpha: spec[3],
      fade: 1,
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      cx: dir * speed,
      cy: (Math.random() - 0.5) * speed * 0.28,
      vx: 0,
      vy: 0,
      phase: Math.random() * Math.PI * 2,
      wob: 0.7 + Math.random() * 0.9,
    };
    actor.vx = actor.cx;
    actor.vy = actor.cy;
    return actor;
  }

  function respawn(actor, vw, vh) {
    var edge = Math.floor(Math.random() * 4);
    var speed = Math.sqrt(actor.cx * actor.cx + actor.cy * actor.cy) || 18;
    if (edge === 0) {
      actor.x = -actor.w - 10;
      actor.y = Math.random() * vh;
      actor.cx = Math.abs(speed);
      actor.cy = (Math.random() - 0.5) * speed * 0.4;
    } else if (edge === 1) {
      actor.x = vw + 10;
      actor.y = Math.random() * vh;
      actor.cx = -Math.abs(speed);
      actor.cy = (Math.random() - 0.5) * speed * 0.4;
    } else if (edge === 2) {
      actor.x = Math.random() * vw;
      actor.y = -actor.h - 10;
      actor.cx = (Math.random() < 0.5 ? -1 : 1) * speed * 0.85;
      actor.cy = Math.abs(speed) * 0.35;
    } else {
      actor.x = Math.random() * vw;
      actor.y = vh + 10;
      actor.cx = (Math.random() < 0.5 ? -1 : 1) * speed * 0.85;
      actor.cy = -Math.abs(speed) * 0.35;
    }
    actor.vx = actor.cx;
    actor.vy = actor.cy;
    actor.fade = 0;
  }

  function wrap(actor, vw, vh) {
    if (
      actor.x < -actor.w - 20 ||
      actor.x > vw + 20 ||
      actor.y < -actor.h - 20 ||
      actor.y > vh + 20
    ) {
      respawn(actor, vw, vh);
    }
  }

  function pushFrom(x, y, radius, power, dt) {
    var i;
    var actor;
    var dx;
    var dy;
    var dist;
    var force;
    var falloff;
    for (i = 0; i < actors.length; i++) {
      actor = actors[i];
      dx = actor.x + actor.w * 0.5 - x;
      dy = actor.y + actor.h * 0.5 - y;
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1 || dist > radius) continue;
      falloff = 1 - dist / radius;
      force = power * falloff * falloff;
      if (dt) force *= dt;
      actor.vx += (dx / dist) * force;
      actor.vy += (dy / dist) * force;
    }
  }

  function dropTrail(x, y) {
    var dot = document.createElement('i');
    dot.className = 'echo-cursor-dot is-' + trailKinds[Math.floor(Math.random() * trailKinds.length)];
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    document.body.appendChild(dot);
    window.setTimeout(function () {
      dot.remove();
    }, 520);
  }

  function burst(x, y) {
    pushFrom(x, y, 120, 420);
    var ring = document.createElement('i');
    ring.className = 'echo-burst-ring';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    document.body.appendChild(ring);
    var gone = false;
    var drop = function () {
      if (gone) return;
      gone = true;
      ring.remove();
    };
    ring.addEventListener('animationend', drop, { once: true });
    window.setTimeout(drop, 520);
  }

  function tick(now) {
    if (!motionOK()) {
      window.requestAnimationFrame(tick);
      return;
    }
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var i;
    var actor;
    var bob;
    var settle = Math.min(0.12, dt * 1.35);

    if (hasMouse && fine) {
      pushFrom(mouseX, mouseY, 168, 2680, dt);
    }

    for (i = 0; i < actors.length; i++) {
      actor = actors[i];
      actor.vx += (actor.cx - actor.vx) * settle;
      actor.vy += (actor.cy - actor.vy) * settle;
      actor.x += actor.vx * dt;
      actor.y += actor.vy * dt;
      wrap(actor, vw, vh);
      if (actor.fade < 1) {
        actor.fade = Math.min(1, actor.fade + dt / 0.38);
      }
      bob = Math.sin(now * 0.001 * actor.wob + actor.phase) * 7;
      actor.el.style.opacity = String((actor.alpha * actor.fade).toFixed(3));
      actor.el.style.transform =
        'translate3d(' + actor.x.toFixed(1) + 'px,' + (actor.y + bob).toFixed(1) + 'px,0)';
    }
    window.requestAnimationFrame(tick);
  }

  var specs = floaterSpecs().slice();
  var target = skyActorTarget();
  var s;
  for (s = specs.length - 1; s > 0; s--) {
    var swap = Math.floor(Math.random() * (s + 1));
    var tmp = specs[s];
    specs[s] = specs[swap];
    specs[swap] = tmp;
  }
  for (s = 0; s < Math.min(target, specs.length); s++) {
    actors.push(makeActor(specs[s]));
  }

  document.addEventListener(
    'pointermove',
    function (event) {
      mouseX = event.clientX;
      mouseY = event.clientY;
      hasMouse = true;
      if (!fine || !motionOK()) return;
      var t = Date.now();
      if (t - lastTrail < 28) return;
      if (Math.abs(mouseX - lastX) + Math.abs(mouseY - lastY) < 8) return;
      lastTrail = t;
      lastX = mouseX;
      lastY = mouseY;
      dropTrail(mouseX, mouseY);
    },
    { passive: true }
  );

  document.addEventListener('pointerdown', function (event) {
    if (!fine || !motionOK()) return;
    if (event.target && event.target.closest && event.target.closest('.echo-rail, .echo-deck, .echo-ticker, .hub-bar, .App-header')) {
      return;
    }
    burst(event.clientX, event.clientY);
  });

  window.requestAnimationFrame(tick);
}

function decorateOnce() {
  document.documentElement.classList.add('echo-ready');
}


  function boot() {
    if (window.__echoHubThemeReady) return;
    window.__echoHubThemeReady = true;
    setupMotion();
    injectSky();
    injectTicker();
    injectDeck();
    injectRail();
    bindTicker();
    bindDeck();
    bindRail();
    bindParallax();
    bindSkyLife();
    decorateOnce();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
