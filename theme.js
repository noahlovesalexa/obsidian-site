/* ============================================
   OBSIDIAN - SHARED THEME ENGINE & UTILITIES
   ============================================

   TABLE OF CONTENTS
   -----------------
   1.  Constants & Configuration ........... line ~30
   2.  Cookie Helpers ...................... line ~43
   3.  Device Fingerprint & User ID ....... line ~53
   4.  Admin Settings & Server Sync ....... line ~120
   5.  Default Settings ................... line ~187
   6.  Settings Manager (ObsidianSettings) .. line ~210
   7.  Theme Engine ....................... line ~283
   8.  Announcement System ................ line ~354
   9.  Play Time Tracker .................. line ~490
   10. Kick/Block System .................. line ~534
   11. Flash Notification System .......... line ~700
   12. Tab Cloaking ....................... line ~735
   13. Panic Mode ......................... line ~747
   14. Secret Admin Access ................ line ~760
   15. Maintenance & Kicked Checks ........ line ~849
   16. Real-Time Listeners ................ line ~872
   17. Remote Admin Command Handler ....... line ~981
   18. Remote Toggle Enforcement .......... line ~1074
   19. Admin Controls Enforcement ......... line ~1127
   20. Idle Timeout & Tab Limiter ......... line ~1245
   21. Scheduled Actions .................. line ~1289
   22. Login Attempt Tracking ............. line ~1336
   23. Game Launch Gating ................. line ~1364
   24. Auto-Save System ................... line ~1420
   25. Toast & Confirm Modal .............. line ~1434
   26. Hidden Games & Media Library ....... line ~1494
   27. Particles.js Integration ........... line ~1527
   28. Tab Leader Election ................ line ~1678
   29. WebSocket (ObsidianSocket) ........... line ~1754
   30. Admin API Heartbeat ................ line ~1907
   31. Admin API Helper ................... line ~2004
   32. Stats Reporter ..................... line ~2024
   33. Initialization ..................... line ~2067
   34. Public API (window.Obsidian) ......... line ~2099

   ============================================ */

(function() {
  'use strict';

  // ---- CONSTANTS & CONFIGURATION ----
  const STORAGE_KEY = 'obsidian_settings';
  const AUTOSAVE_INTERVAL = 120000;
  const ANNOUNCE_KEY = 'obsidian_active_announcement';
  const ANNOUNCE_HISTORY_KEY = 'obsidian_announcement_history';
  const ADMIN_SETTINGS_KEY = 'obsidian_admin_settings';
  const PLAY_TIME_KEY = 'obsidian_play_time';
  const MEDIA_LIBRARY_KEY = 'obsidian_media_library';
  const OBSIDIAN_BACKEND_URL = 'https://lettuce-cola-resource.ngrok-free.dev';
  const OBSIDIAN_WS_URL = 'wss://lettuce-cola-resource.ngrok-free.dev/ws';
  const OBSIDIAN_AUTH_URL = 'https://lettuce-cola-resource.ngrok-free.dev';
  const OBSIDIAN_ADMIN_API_URL = 'https://lettuce-cola-resource.ngrok-free.dev';

  /* ──────────────────────────────────────────────
     2. COOKIE HELPERS
     ────────────────────────────────────────────── */
  function _setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function _getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  /* ──────────────────────────────────────────────
     3. DEVICE FINGERPRINT & USER ID
     ────────────────────────────────────────────── */
  function _fnv1aHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function _generateDeviceFingerprint() {
    var c = [];
    c.push(screen.width + 'x' + screen.height + 'x' + screen.colorDepth);
    c.push(screen.availWidth + 'x' + screen.availHeight);
    c.push(navigator.platform || '');
    c.push(navigator.hardwareConcurrency || 0);
    c.push(navigator.deviceMemory || 0);
    c.push(navigator.language || '');
    c.push(navigator.maxTouchPoints || 0);
    try { c.push(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch(e) { c.push('unk'); }
    // Canvas fingerprint (very stable per device/browser)
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 50;
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'alphabetic';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Neb!FP#42x', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Neb!FP#42x', 4, 17);
      c.push(canvas.toDataURL().slice(-64));
    } catch(e) { c.push('nc'); }
    // WebGL renderer
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      if (gl) {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          c.push(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        }
      }
    } catch(e) { c.push('ngl'); }
    return 'dev_' + _fnv1aHash(c.join('|||'));
  }

  // User ID (persistent per DEVICE — survives reload, localStorage clear, new tabs)
  var _cachedUserId = null;
  function getObsidianUserId() {
    if (_cachedUserId) return _cachedUserId;
    // Try all storage locations (redundancy)
    var uid = localStorage.getItem('obsidian_user_id')
           || _getCookie('obsidian_uid')
           || sessionStorage.getItem('obsidian_user_id');
    if (!uid) {
      // All storage cleared — regenerate from device fingerprint (deterministic)
      uid = _generateDeviceFingerprint();
    }
    // Store in ALL locations for maximum persistence
    try { localStorage.setItem('obsidian_user_id', uid); } catch(e) {}
    try { sessionStorage.setItem('obsidian_user_id', uid); } catch(e) {}
    _setCookie('obsidian_uid', uid, 365 * 5); // 5-year cookie
    _cachedUserId = uid;
    return uid;
  }

  /* ──────────────────────────────────────────────
     4. ADMIN SETTINGS & SERVER SYNC
     ────────────────────────────────────────────── */

  // Admin password is verified via local SHA-256 hash comparison.
  // Only the hash of the correct password is stored — never plaintext.
  var _VALID_PW_HASH = '84705e64134da52a702d251d47ab82844992dcb0da4eebea18e153998348d152';
  function _sha256(str) {
    var buf = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', buf).then(function(hash) {
      return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2,'0'); }).join('');
    });
  }
  // getAdminPassword() kept for backward compat only — returns empty.
  function getAdminPassword() { return ''; }


  // Server settings cache (merged into admin settings)
  var _serverSettingsCache = null;
  var _serverSettingsFetched = false;

  function getAdminSettings() {
    try {
      var local = JSON.parse(localStorage.getItem(ADMIN_SETTINGS_KEY) || '{}');
      // Merge server settings underneath local (local overrides server)
      if (_serverSettingsCache) {
        var merged = {};
        for (var sk in _serverSettingsCache) { if (_serverSettingsCache.hasOwnProperty(sk)) merged[sk] = _serverSettingsCache[sk]; }
        for (var lk in local) { if (local.hasOwnProperty(lk)) merged[lk] = local[lk]; }
        return merged;
      }
      return local;
    } catch(e) { return {}; }
  }

  function setAdminSettings(obj) {
    var current;
    try { current = JSON.parse(localStorage.getItem(ADMIN_SETTINGS_KEY) || '{}'); } catch(e) { current = {}; }
    for (var k in obj) { if (obj.hasOwnProperty(k)) current[k] = obj[k]; }
    localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(current));
  }

  // Sync admin settings TO the server
  function syncAdminSettingsToServer() {
    var settings = getAdminSettings();
    return fetch(OBSIDIAN_ADMIN_API_URL + '/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ settings: settings })
    }).then(function(r) { return r.json(); })
      .catch(function(e) { console.warn('[Obsidian] Failed to sync settings to server:', e); });
  }

  // Fetch admin settings FROM the server and cache them
  function fetchServerAdminSettings() {
    return fetch(OBSIDIAN_ADMIN_API_URL + '/api/admin/settings', { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.settings) {
          _serverSettingsCache = data.settings;
          _serverSettingsFetched = true;
        }
        return data;
      })
      .catch(function(e) { console.warn('[Obsidian] Failed to fetch server settings:', e); });
  }

  /* ──────────────────────────────────────────────
     5. DEFAULT SETTINGS
     ────────────────────────────────────────────── */
  const DEFAULTS = {
    theme: 'dark',
    animations: true,
    density: 'normal',
    font: 'inter',
    custom: {
      primary: '#8b5cf6',
      background: '#0a0a0f',
      accent: '#c4b5fd',
      text: '#f0f0f5'
    },
    tabCloak: { title: '', icon: '' },
    panic: { enabled: false, key: 'Escape', url: 'https://classroom.google.com' },
    features: {
      welcomeScreen: true,
      searchFocus: true,
      announcements: true,
      gameCounter: true
    },
    lastSaved: null
  };

  /* ──────────────────────────────────────────────
     6. SETTINGS MANAGER (ObsidianSettings)
     ────────────────────────────────────────────── */
  const ObsidianSettings = {
    _data: null,
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this._data = this._deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
        } else {
          this._data = JSON.parse(JSON.stringify(DEFAULTS));
        }
      } catch (e) {
        console.warn('[Obsidian] Failed to load settings:', e);
        this._data = JSON.parse(JSON.stringify(DEFAULTS));
      }
      return this._data;
    },
    save() {
      try {
        this._data.lastSaved = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
        return true;
      } catch (e) { console.warn('[Obsidian] Failed to save:', e); return false; }
    },
    get(key) {
      if (!this._data) this.load();
      const keys = key.split('.');
      let val = this._data;
      for (const k of keys) {
        if (val && typeof val === 'object' && k in val) { val = val[k]; }
        else { return undefined; }
      }
      return val;
    },
    set(key, value) {
      if (!this._data) this.load();
      const keys = key.split('.');
      let obj = this._data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in obj) || typeof obj[keys[i]] !== 'object') { obj[keys[i]] = {}; }
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      this.save();
    },
    getAll() {
      if (!this._data) this.load();
      return JSON.parse(JSON.stringify(this._data));
    },
    reset() {
      this._data = JSON.parse(JSON.stringify(DEFAULTS));
      this.save();
    },
    export() { return JSON.stringify(this.getAll(), null, 2); },
    import(json) {
      try {
        const parsed = JSON.parse(json);
        this._data = this._deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), parsed);
        this.save();
        return true;
      } catch (e) { console.warn('[Obsidian] Import failed:', e); return false; }
    },
    _deepMerge(target, source) {
      for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key] || typeof target[key] !== 'object') { target[key] = {}; }
          this._deepMerge(target[key], source[key]);
        } else { target[key] = source[key]; }
      }
      return target;
    }
  };

  /* ──────────────────────────────────────────────
     7. THEME ENGINE
     ────────────────────────────────────────────── */
  const ThemeEngine = {
    apply(settings) {
      if (!settings) settings = ObsidianSettings.getAll();
      const root = document.documentElement;
      const adminS = getAdminSettings();
      if (adminS.forceTheme && adminS.forceTheme !== 'none') {
        root.setAttribute('data-theme', adminS.forceTheme);
      } else {
        root.setAttribute('data-theme', settings.theme);
      }
      root.setAttribute('data-density', settings.density || 'normal');
      root.setAttribute('data-animations', settings.animations ? 'on' : 'off');
      root.setAttribute('data-font', settings.font || 'inter');
      if (settings.theme === 'custom' && settings.custom) {
        this._applyCustomColors(settings.custom);
      }
      if (adminS.customCSS) {
        let el = document.getElementById('obsidian-admin-css');
        if (!el) { el = document.createElement('style'); el.id = 'obsidian-admin-css'; document.head.appendChild(el); }
        el.textContent = adminS.customCSS;
      }
    },
    _applyCustomColors(c) {
      const root = document.documentElement;
      if (c.primary) {
        root.style.setProperty('--primary', c.primary);
        root.style.setProperty('--primary-hover', this._adjustBrightness(c.primary, -20));
        const rgb = this._hexToRgb(c.primary);
        if (rgb) root.style.setProperty('--primary-rgb', rgb.r+', '+rgb.g+', '+rgb.b);
      }
      if (c.background) {
        root.style.setProperty('--bg-base', c.background);
        root.style.setProperty('--bg-surface', this._adjustBrightness(c.background, 8));
        root.style.setProperty('--bg-elevated', this._adjustBrightness(c.background, 15));
        root.style.setProperty('--bg-card', this._adjustBrightness(c.background, 10));
        root.style.setProperty('--bg-card-hover', this._adjustBrightness(c.background, 20));
        root.style.setProperty('--bg-input', this._adjustBrightness(c.background, 4));
      }
      if (c.accent) {
        root.style.setProperty('--accent', c.accent);
        root.style.setProperty('--secondary', c.accent);
        const rgb = this._hexToRgb(c.accent);
        if (rgb) root.style.setProperty('--accent-rgb', rgb.r+', '+rgb.g+', '+rgb.b);
      }
      if (c.text) {
        root.style.setProperty('--text-primary', c.text);
        root.style.setProperty('--text-secondary', this._adjustBrightness(c.text, -40));
        root.style.setProperty('--text-muted', this._adjustBrightness(c.text, -80));
      }
    },
    clearCustom() {
      const root = document.documentElement;
      ['--primary','--primary-hover','--primary-rgb','--bg-base','--bg-surface','--bg-elevated','--bg-card','--bg-card-hover','--bg-input','--accent','--secondary','--accent-rgb','--text-primary','--text-secondary','--text-muted'].forEach(function(p){ root.style.removeProperty(p); });
    },
    setTheme(name) { this.clearCustom(); ObsidianSettings.set('theme', name); this.apply(); },
    _hexToRgb(hex) {
      var r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : null;
    },
    _adjustBrightness(hex, amt) {
      hex = hex.replace('#','');
      if (hex.length===3) hex = hex.split('').map(function(c){return c+c;}).join('');
      var n = parseInt(hex,16);
      var r = Math.min(255,Math.max(0,((n>>16)&0xFF)+amt));
      var g = Math.min(255,Math.max(0,((n>>8)&0xFF)+amt));
      var b = Math.min(255,Math.max(0,(n&0xFF)+amt));
      return '#'+[r,g,b].map(function(c){return c.toString(16).padStart(2,'0');}).join('');
    }
  };

  /* ──────────────────────────────────────────────
     8. ANNOUNCEMENT SYSTEM
     ────────────────────────────────────────────── */
  const AnnouncementSystem = {
    _lastChecked: 0,
    _dismissedKey: 'dismissedAnnouncements',
    _showCb: null,
    _clearCb: null,
    getDismissed() { try { return JSON.parse(localStorage.getItem(this._dismissedKey)||'[]'); } catch(e){ return []; } },
    getActive() { try { return JSON.parse(localStorage.getItem(ANNOUNCE_KEY)); } catch(e){ return null; } },
    getHistory() { try { return JSON.parse(localStorage.getItem(ANNOUNCE_HISTORY_KEY)||'[]'); } catch(e){ return []; } },
    publish(ann) {
      var self = this;
      var data = {
        active: true,
        title: ann.title || 'Announcement',
        message: ann.message || '',
        type: ann.type || 'info',
        dismissible: ann.dismissible !== false,
        timestamp: Date.now(),
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2,6)
      };
      // Save locally as fallback
      localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(data));
      var hist = this.getHistory();
      hist.unshift(Object.assign({}, data, { publishedAt: new Date().toLocaleString() }));
      if (hist.length > 50) hist.length = 50;
      localStorage.setItem(ANNOUNCE_HISTORY_KEY, JSON.stringify(hist));
      localStorage.setItem('obsidian_announce_signal', JSON.stringify({ action:'show', ts: data.timestamp, id: data.id }));
      // Publish to backend so all users see it
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ title: data.title, message: data.message, type: data.type, dismissible: data.dismissible })
      }).catch(function(e) { console.warn('[Obsidian] Failed to publish announcement to backend:', e); });
      return data;
    },
    clear() {
      localStorage.removeItem(ANNOUNCE_KEY);
      localStorage.setItem('obsidian_announce_signal', JSON.stringify({ action:'clear', ts: Date.now() }));
      // Clear on backend too
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/clear', { method: 'POST', headers: { 'ngrok-skip-browser-warning': '1' } })
        .catch(function(e) { console.warn('[Obsidian] Failed to clear announcement on backend:', e); });
    },
    dismiss(id) {
      var d = this.getDismissed();
      if (d.indexOf(id) === -1) { d.push(id); if (d.length>100) d.splice(0,d.length-100); localStorage.setItem(this._dismissedKey, JSON.stringify(d)); }
    },
    shouldShow(ann) {
      if (!ann || (!ann.active && !ann.title)) return false;
      var d = this.getDismissed();
      return d.indexOf(ann.id)===-1 && d.indexOf('local_'+ann.timestamp)===-1;
    },
    handleBackendAnnouncement(data) {
      if (!data) {
        // Announcement was cleared
        if (this._clearCb) this._clearCb();
        return;
      }
      // Intercept kick announcements — don't show as regular banners
      if (data.title === '__OBSIDIAN_KICK_LIST__') {
        try {
          var list = JSON.parse(data.message);
          if (Array.isArray(list)) KickSystem.handleKickList(list);
        } catch(e) {}
        return; // don't display as announcement
      }
      // Map backend format to local format
      var ann = {
        active: true,
        title: data.title || 'Announcement',
        message: data.message || '',
        type: data.type || 'info',
        dismissible: data.dismissible !== false,
        timestamp: data.timestamp || Date.now(),
        id: data.id || ('backend_' + Date.now())
      };
      // Save locally
      localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(ann));
      if (this.shouldShow(ann) && this._showCb) {
        this._showCb(ann);
      }
    },
    fetchFromBackend() {
      var self = this;
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/active', { headers: { 'ngrok-skip-browser-warning': '1' } })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.announcement) {
            // Intercept kick announcements on fetch too
            if (result.announcement.title === '__OBSIDIAN_KICK_LIST__') {
              try {
                var list = JSON.parse(result.announcement.message);
                if (Array.isArray(list)) KickSystem.handleKickList(list);
              } catch(e) {}
              return;
            }
            self.handleBackendAnnouncement(result.announcement);
          }
        })
        .catch(function(e) { console.warn('[Obsidian] Failed to fetch announcement from backend:', e); });
    },
    fetchHistory() {
      return fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/history', { headers: { 'ngrok-skip-browser-warning': '1' } })
        .then(function(r) { return r.json(); })
        .then(function(result) { return result.history || []; })
        .catch(function(e) { console.warn('[Obsidian] Failed to fetch announcement history:', e); return []; });
    },
    initListener(showCb, clearCb) {
      var self = this;
      self._showCb = showCb;
      self._clearCb = clearCb;
      window.addEventListener('storage', function(e) {
        if (e.key === 'obsidian_announce_signal' && e.newValue) {
          try {
            var sig = JSON.parse(e.newValue);
            if (sig.action === 'show') {
              var ann = self.getActive();
              if (ann && self.shouldShow(ann)) showCb(ann);
            } else if (sig.action === 'clear' && clearCb) {
              clearCb();
            }
          } catch(err){}
        }
        if (e.key === ADMIN_SETTINGS_KEY && e.newValue) {
          try {
            var as = JSON.parse(e.newValue);
            if (as.maintenanceMode && !sessionStorage.getItem('obsidian_admin')) {
              window.location.href = 'maintenance.html';
            }
          } catch(err){}
        }
      });
      // Fetch from backend on load
      self.fetchFromBackend();
    }
  };

  /* ──────────────────────────────────────────────
     9. PLAY TIME TRACKER
     ────────────────────────────────────────────── */
  const PlayTime = {
    _start: null, _game: null,
    startTracking(name) { this._start = Date.now(); this._game = name; },
    stopTracking() {
      if (!this._start || !this._game) return;
      var elapsed = Date.now() - this._start;
      var data = this.getData();
      if (!data[this._game]) data[this._game] = { totalTime:0, sessions:0 };
      data[this._game].totalTime += elapsed;
      data[this._game].sessions += 1;
      data[this._game].lastPlayed = Date.now();
      localStorage.setItem(PLAY_TIME_KEY, JSON.stringify(data));
      this._start = null; this._game = null;
    },
    getData() { try { return JSON.parse(localStorage.getItem(PLAY_TIME_KEY)||'{}'); } catch(e){ return {}; } },
    getTotalTime() { var d=this.getData(),t=0; for(var k in d){if(d.hasOwnProperty(k))t+=(d[k].totalTime||0);} return t; },
    getTotalSessions() { var d=this.getData(),t=0; for(var k in d){if(d.hasOwnProperty(k))t+=(d[k].sessions||0);} return t; },
    formatTime(ms) {
      var s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
      if(h>0) return h+'h '+(m%60)+'m';
      if(m>0) return m+'m '+(s%60)+'s';
      return s+'s';
    },
    getTopGames(n) {
      var d=this.getData(), arr=[];
      for(var k in d){if(d.hasOwnProperty(k)) arr.push({name:k, time:d[k].totalTime, sessions:d[k].sessions});}
      arr.sort(function(a,b){return b.time-a.time;});
      return arr.slice(0, n||5);
    },
    // Fetch global top games aggregated across ALL users from backend
    getGlobalTopGames(n) {
      return fetch(OBSIDIAN_BACKEND_URL + '/api/stats/combined', { headers: { 'ngrok-skip-browser-warning': '1' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.top_games && data.top_games.length) {
            return data.top_games.slice(0, n || 10);
          }
          // Fallback to local data if backend doesn't have top_games
          return null;
        })
        .catch(function() { return null; });
    }
  };

  /* ──────────────────────────────────────────────
     10. KICK/BLOCK SYSTEM
     ────────────────────────────────────────────── */
  // Cross-machine kick system using the announcement API as server-side storage.
  // When admin kicks a user:
  //   1. Stores kicked list in admin's localStorage (for admin UI)
  //   2. Publishes kicked list to backend via announcement API (broadcasts to ALL clients via WebSocket)
  // When user receives kick announcement:
  //   1. Checks if own userId is in the kicked list
  //   2. Sets 'obsidian_i_am_kicked' in OWN localStorage (persists across reloads)
  //   3. Shows blocked screen immediately
  // On page load:
  //   1. Checks own 'obsidian_i_am_kicked' flag (instant, no network)
  //   2. Also fetches active announcement from backend to re-verify (handles edge cases)
  var KICK_ANNOUNCE_TITLE = '__OBSIDIAN_KICK_LIST__';
  var KICKED_SELF_KEY = 'obsidian_i_am_kicked';
  var KICKED_COOKIE_KEY = 'obsidian_kicked';

  var KickSystem = {
    _blocked: false,
    _pollTimer: null,

    // Get kicked users from admin's local list (only useful on admin's machine)
    getKickedUsers: function() {
      var a = getAdminSettings();
      return a.kickedUsers || [];
    },

    // Publish the full kicked users list to the backend (announcement API)
    // This broadcasts to ALL connected clients via WebSocket
    _publishKickList: function(kickedArray) {
      var payload = JSON.stringify(kickedArray);
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({
          title: KICK_ANNOUNCE_TITLE,
          message: payload,
          type: 'kick',
          dismissible: false
        })
      }).catch(function() { /* silent */ });
    },

    // Clear the kick announcement from the backend (when no users are kicked)
    _clearKickList: function() {
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/clear', {
        method: 'POST'
      }).catch(function() { /* silent */ });
    },

    // Kick by persistent userId
    kickUser: function(userId) {
      var a = getAdminSettings();
      var kicked = a.kickedUsers || [];
      if (kicked.indexOf(userId) === -1) {
        kicked.push(userId);
        setAdminSettings({ kickedUsers: kicked });
      }
      // Publish to backend → broadcasts to all clients via WebSocket
      this._publishKickList(kicked);
      // Also signal via localStorage for same-machine cross-tab
      localStorage.setItem('obsidian_kick_signal', JSON.stringify({ action: 'kick', userId: userId, ts: Date.now() }));
      setTimeout(function() { localStorage.removeItem('obsidian_kick_signal'); }, 300);
    },

    unkickUser: function(userId) {
      var a = getAdminSettings();
      var kicked = (a.kickedUsers || []).filter(function(id) { return id !== userId; });
      setAdminSettings({ kickedUsers: kicked });
      if (kicked.length > 0) {
        this._publishKickList(kicked);
      } else {
        this._clearKickList();
      }
      localStorage.setItem('obsidian_kick_signal', JSON.stringify({ action: 'unkick', userId: userId, ts: Date.now() }));
      setTimeout(function() { localStorage.removeItem('obsidian_kick_signal'); }, 300);
    },

    unkickAll: function() {
      setAdminSettings({ kickedUsers: [] });
      this._clearKickList();
      localStorage.setItem('obsidian_kick_signal', JSON.stringify({ action: 'unkick_all', ts: Date.now() }));
      setTimeout(function() { localStorage.removeItem('obsidian_kick_signal'); }, 300);
    },

    isKicked: function(userId) {
      return this.getKickedUsers().indexOf(userId) !== -1;
    },

    // Called when we receive a kick list from the server (via WS announcement or HTTP fetch)
    handleKickList: function(kickedArray) {
      var myId = getObsidianUserId();
      if (sessionStorage.getItem('obsidian_admin')) return; // admins are immune
      if (kickedArray.indexOf(myId) !== -1) {
        // I am kicked — persist flag in ALL storage locations
        localStorage.setItem(KICKED_SELF_KEY, 'true');
        _setCookie(KICKED_COOKIE_KEY, 'true', 365 * 5);
        this._redirectToKicked();
      } else {
        // I am NOT kicked — clear from all storage and unblock
        localStorage.removeItem(KICKED_SELF_KEY);
        _setCookie(KICKED_COOKIE_KEY, '', -1);
        this._blocked = false;
      }
    },

    // Check own kicked flag (fast, no network — for page load)
    // Checks BOTH localStorage and cookie (survives clearing one or the other)
    checkBlocked: function() {
      if (this._blocked) return true;
      if (sessionStorage.getItem('obsidian_admin')) return false;
      var kickedInLS = localStorage.getItem(KICKED_SELF_KEY) === 'true';
      var kickedInCookie = _getCookie(KICKED_COOKIE_KEY) === 'true';
      if (kickedInLS || kickedInCookie) {
        // Re-persist in both locations so clearing one doesn't help
        localStorage.setItem(KICKED_SELF_KEY, 'true');
        _setCookie(KICKED_COOKIE_KEY, 'true', 365 * 5);
        this._blocked = true;
        this._redirectToKicked();
        return true;
      }
      return false;
    },

    // Fetch kick list from backend on page load to re-verify status
    fetchAndCheck: function() {
      var self = this;
      if (sessionStorage.getItem('obsidian_admin')) return;
      fetch(OBSIDIAN_BACKEND_URL + '/api/announcements/active', { headers: { 'ngrok-skip-browser-warning': '1' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.announcement && data.announcement.title === KICK_ANNOUNCE_TITLE) {
            try {
              var list = JSON.parse(data.announcement.message);
              if (Array.isArray(list)) {
                self.handleKickList(list);
              }
            } catch(e) {}
          }
          // NOTE: Do NOT clear kicked flag when no kick announcement is found.
          // A regular announcement may have replaced the kick list on the backend.
          // The kicked flag should only be cleared when admin explicitly unkicks
          // (which sends an updated kick list without this user's ID).
        })
        .catch(function() { /* keep existing flag if network fails */ });
    },

    // Start polling backend every 5s as fallback
    startPolling: function() {
      var self = this;
      if (self._pollTimer) return;
      var path = window.location.pathname;
      if (path.endsWith('admin.html')) return;
      self._pollTimer = setInterval(function() {
        self.fetchAndCheck();
      }, 5000);
    },

    // Redirect kicked user to the dedicated kicked page
    _redirectToKicked: function() {
      var path = window.location.pathname;
      if (!path.endsWith('kicked.html') && !path.endsWith('admin.html')) {
        window.location.href = 'kicked.html';
      }
    }
  };

  /* ──────────────────────────────────────────────
     11. FLASH NOTIFICATION SYSTEM
     ────────────────────────────────────────────── */
  var FlashNotification = {
    _typeColors: {
      info:    { color: 'var(--primary, #8b5cf6)',  bg: 'rgba(var(--primary-rgb, 139,92,246), 0.15)' },
      success: { color: '#10b981',                   bg: 'rgba(16,185,129,0.15)' },
      warning: { color: '#f59e0b',                   bg: 'rgba(245,158,11,0.15)' },
      danger:  { color: 'var(--danger, #ef4444)',     bg: 'rgba(239,68,68,0.15)' }
    },
    show: function(message, options) {
      options = options || {};
      var duration = options.duration || 1500;
      var typeStyle = this._typeColors[options.type] || null;
      var color = options.color || (typeStyle ? typeStyle.color : 'var(--primary, #8b5cf6)');
      var bgColor = options.bgColor || (typeStyle ? typeStyle.bg : 'rgba(var(--primary-rgb, 139,92,246), 0.15)');
      var existing = document.getElementById('obsidian-flash-notification');
      if (existing) existing.remove();
      var el = document.createElement('div');
      el.id = 'obsidian-flash-notification';
      el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-20px);z-index:999998;padding:12px 28px;border-radius:var(--radius-lg, 12px);font-family:var(--font-sans, Inter, system-ui, sans-serif);font-size:1rem;font-weight:600;color:' + color + ';background:' + bgColor + ';backdrop-filter:blur(12px);border:1px solid ' + color + ';box-shadow:0 4px 24px rgba(0,0,0,0.3);opacity:0;transition:all 0.3s ease;pointer-events:none;text-align:center;max-width:90vw;';
      el.textContent = message;
      document.body.appendChild(el);
      // Animate in
      requestAnimationFrame(function() {
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
      });
      // Animate out after duration
      setTimeout(function() {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(function() { el.remove(); }, 300);
      }, duration);
    }
  };

  /* ──────────────────────────────────────────────
     12. TAB CLOAKING
     ────────────────────────────────────────────── */
  function applyTabCloak() {
    var s = ObsidianSettings.getAll();
    if (s.tabCloak.title) document.title = s.tabCloak.title;
    if (s.tabCloak.icon) {
      var link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = s.tabCloak.icon;
    }
  }

  /* ──────────────────────────────────────────────
     13. PANIC MODE
     ────────────────────────────────────────────── */
  function initPanicMode() {
    document.addEventListener('keydown', function(e) {
      var s = ObsidianSettings.getAll();
      var a = getAdminSettings();
      var panicKey = a.panicKey || s.panic.key || 'Escape';
      var panicUrl = a.panicUrl || s.panic.url || 'https://classroom.google.com';
      if (s.panic.enabled && e.key === panicKey) {
        window.location.href = panicUrl;
      }
    });
  }

  /* ──────────────────────────────────────────────
     14. SECRET ADMIN ACCESS (server-side verified)
     ────────────────────────────────────────────── */
  function initSecretAccess() {
    var trigger = document.createElement('button');
    trigger.className = 'secret-trigger';
    trigger.setAttribute('aria-hidden','true');
    trigger.setAttribute('tabindex','-1');
    document.body.appendChild(trigger);

    var overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.id = 'admin-modal-overlay';
    overlay.innerHTML = [
      '<div class="admin-modal">',
        '<div class="admin-modal-icon">',
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
          '</svg>',
        '</div>',
        '<h3 class="admin-modal-title">Admin Access</h3>',
        '<p class="admin-modal-desc">Enter the administrator password to continue.</p>',
        '<div class="admin-modal-field">',
          '<input type="password" id="admin-pw-input" placeholder="Password" autocomplete="off">',
        '</div>',
        '<div class="error-msg" id="admin-error">Incorrect password. Try again.</div>',
        '<div class="admin-modal-btns">',
          '<button class="btn btn-secondary" id="admin-cancel-btn">Cancel</button>',
          '<button class="btn btn-primary" id="admin-submit-btn">Enter</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    var input = document.getElementById('admin-pw-input');
    var errorMsg = document.getElementById('admin-error');
    var submitBtn = document.getElementById('admin-submit-btn');

    function showModal() { overlay.classList.add('active'); input.value=''; errorMsg.classList.remove('show'); setTimeout(function(){input.focus();},100); }
    function hideModal() { overlay.classList.remove('active'); input.value=''; errorMsg.classList.remove('show'); }

    function attemptLogin() {
      var pw = input.value;
      if (!pw) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying...';

      // Local SHA-256 hash verification — only accepts the correct password
      _sha256(pw).then(function(hash) {
        if (hash === _VALID_PW_HASH) {
          sessionStorage.setItem('obsidian_admin', 'true');
          sessionStorage.setItem('obsidian_auth_token', 'offline');
          window.location.href = 'admin.html';
        } else {
          errorMsg.textContent = 'Incorrect password. Try again.';
          errorMsg.classList.add('show');
          input.value = '';
          input.focus();
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enter';
        }
      }).catch(function() {
        errorMsg.textContent = 'Could not verify password. Try again.';
        errorMsg.classList.add('show');
        input.value = '';
        input.focus();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enter';
      });
    }

    trigger.addEventListener('click', showModal);
    document.getElementById('admin-cancel-btn').addEventListener('click', hideModal);
    submitBtn.addEventListener('click', attemptLogin);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter')attemptLogin(); if(e.key==='Escape')hideModal(); });
    overlay.addEventListener('click', function(e){ if(e.target===overlay)hideModal(); });
  }

  /* ──────────────────────────────────────────────
     15. MAINTENANCE & KICKED CHECKS
     ────────────────────────────────────────────── */
  function checkMaintenance() {
    var a = getAdminSettings();
    if (a.maintenanceMode && !sessionStorage.getItem('obsidian_admin')) {
      var path = window.location.pathname;
      if (!path.endsWith('locked.html') && !path.endsWith('admin.html') && !path.endsWith('index.html') && !path.endsWith('maintenance.html') && !path.endsWith('kicked.html')) {
        // Redirect to themed maintenance page
        window.location.href = 'maintenance.html';
      }
    }
  }

  function checkKicked() {
    var path = window.location.pathname;
    // Don't check on admin page
    if (path.endsWith('admin.html')) return;
    // First check own localStorage flag (instant, no network)
    KickSystem.checkBlocked();
    // Then verify with backend (handles cross-machine kicks + reload persistence)
    KickSystem.fetchAndCheck();
  }

  /* ──────────────────────────────────────────────
     16. REAL-TIME LISTENERS
     ────────────────────────────────────────────── */
  function initRealtimeListeners() {
    var path = window.location.pathname;
    // Skip on admin page (it has its own listeners)
    if (path.endsWith('admin.html')) return;

    // Listen for kick signals via localStorage (cross-tab, same machine = instant)
    window.addEventListener('storage', function(e) {
      if (e.key === 'obsidian_kick_signal' && e.newValue) {
        try {
          var sig = JSON.parse(e.newValue);
          var myId = getObsidianUserId();
          if (sig.action === 'kick' && sig.userId === myId) {
            localStorage.setItem(KICKED_SELF_KEY, 'true');
            _setCookie(KICKED_COOKIE_KEY, 'true', 365 * 5);
            KickSystem._redirectToKicked();
          }
          if (sig.action === 'unkick' && sig.userId === myId) {
            localStorage.removeItem(KICKED_SELF_KEY);
            _setCookie(KICKED_COOKIE_KEY, '', -1);
            KickSystem._blocked = false;
          }
          if (sig.action === 'unkick_all') {
            localStorage.removeItem(KICKED_SELF_KEY);
            _setCookie(KICKED_COOKIE_KEY, '', -1);
            KickSystem._blocked = false;
          }
        } catch(err) {}
      }
      // Listen for lockdown changes via localStorage
      if (e.key === ADMIN_SETTINGS_KEY && e.newValue) {
        try {
          var as = JSON.parse(e.newValue);
          if (as.maintenanceMode && !sessionStorage.getItem('obsidian_admin')) {
            window.location.href = 'maintenance.html';
          }
        } catch(err) {}
      }
      // Listen for force logout (only fires when toggle is turned ON)
      if (e.key === 'obsidian_force_logout' && e.newValue && !sessionStorage.getItem('obsidian_admin')) {
        sessionStorage.removeItem('obsidian_auth');
        window.location.href = 'maintenance.html';
      }
      // Listen for admin settings changes to enforce remote toggles in real-time
      if (e.key === ADMIN_SETTINGS_KEY && e.newValue && !sessionStorage.getItem('obsidian_admin')) {
        _enforceRemoteToggles();
      }
      // Listen for force redirect
      if (e.key === 'obsidian_force_redirect' && e.newValue && !sessionStorage.getItem('obsidian_admin')) {
        window.location.href = e.newValue;
      }
      // Listen for force refresh (guarded against infinite loops)
      if (e.key === 'obsidian_force_refresh' && e.newValue) {
        if (!sessionStorage.getItem(_REFRESH_GUARD_KEY)) {
          sessionStorage.setItem(_REFRESH_GUARD_KEY, Date.now().toString());
          window.location.reload();
        }
      }
      // Listen for remote admin commands via WebSocket broadcast
      if (e.key === 'obsidian_admin_command' && e.newValue && !sessionStorage.getItem('obsidian_admin')) {
        try {
          var cmd = JSON.parse(e.newValue);
          _handleAdminCommand(cmd);
        } catch(err) {}
      }
    });

    // Listen for WebSocket messages for real-time updates
    // These will fire once ObsidianSocket connects
    setTimeout(function() {
      if (!window.Obsidian || !Obsidian.Socket) return;

      // Admin online notification
      Obsidian.Socket.on('admin_online', function(msg) {
        FlashNotification.show('admin is on', {
          duration: 1500,
          color: '#f59e0b',
          bgColor: 'rgba(245,158,11,0.15)'
        });
      });

      // Note: Kicks are delivered via the announcement WebSocket channel.
      // The handleBackendAnnouncement() function intercepts kick announcements
      // and calls KickSystem.handleKickList() which sets the user's own flag
      // and shows the blocked screen. No separate kick_user listener needed.

      // Lockdown changed in real-time
      Obsidian.Socket.on('lockdown_changed', function(msg) {
        if (msg.lockdown && !sessionStorage.getItem('obsidian_admin')) {
          window.location.href = 'maintenance.html';
        }
      });

      // Remote admin command (pushed via WebSocket)
      Obsidian.Socket.on('admin_command', function(msg) {
        if (!sessionStorage.getItem('obsidian_admin') && msg.data) {
          _handleAdminCommand(msg.data);
        }
      });

      // Flash announcement (shows for ~1 second then disappears)
      Obsidian.Socket.on('flash_announcement', function(msg) {
        if (msg.data && msg.data.message) {
          FlashNotification.show(msg.data.title ? msg.data.title + ': ' + msg.data.message : msg.data.message, {
            duration: msg.data.duration || 2000,
            type: msg.data.type || 'success'
          });
        }
      });
    }, 500);
  }

  /* ──────────────────────────────────────────────
     17. REMOTE ADMIN COMMAND HANDLER
     ────────────────────────────────────────────── */
  // Guard against infinite refresh loops from server command queue.
  // When a 'refresh' command is queued server-side, every heartbeat (and
  // every WebSocket reconnect) re-delivers it.  The page reloads, the
  // heartbeat fires again ~3 s later, gets the same command, and reloads
  // again — forever.  We use sessionStorage to make sure we only honour
  // ONE server-initiated refresh per browser-session.
  var _REFRESH_GUARD_KEY = 'obsidian_refresh_guard';

  function _handleAdminCommand(cmd) {
    if (!cmd || !cmd.action) return;
    switch (cmd.action) {
      case 'refresh':
        // If we already executed a server-pushed refresh this session, skip.
        if (sessionStorage.getItem(_REFRESH_GUARD_KEY)) return;
        sessionStorage.setItem(_REFRESH_GUARD_KEY, Date.now().toString());
        window.location.reload();
        break;
      case 'redirect':
        if (cmd.url) window.location.href = cmd.url;
        break;
      case 'flash':
        if (cmd.message) FlashNotification.show(cmd.message, { duration: cmd.duration || 3000, type: cmd.type || 'info' });
        break;
      case 'logout':
        sessionStorage.clear();
        window.location.href = 'maintenance.html';
        break;
      case 'reload_theme':
        ObsidianSettings.load();
        ThemeEngine.apply();
        applyAdminControls();
        break;
      case 'force_theme':
        // Instantly apply the forced theme pushed by admin
        if (cmd.theme && cmd.theme !== 'none') {
          setAdminSettings({ forceTheme: cmd.theme });
          ThemeEngine.clearCustom();
          document.documentElement.setAttribute('data-theme', cmd.theme);
          ThemeEngine.apply();
        } else {
          // Admin disabled force theme — revert to user's own theme
          setAdminSettings({ forceTheme: 'none' });
          ObsidianSettings.load();
          ThemeEngine.clearCustom();
          ThemeEngine.apply();
        }
        break;
      case 'clear_cache':
        if (typeof caches !== 'undefined') {
          caches.keys().then(function(names) {
            names.forEach(function(n) { caches.delete(n); });
          });
        }
        break;

      // ---- PERSISTENT TOGGLE COMMANDS ----
      case 'force_logout_toggle':
        if (cmd.enabled && !sessionStorage.getItem('obsidian_admin')) {
          sessionStorage.clear();
          window.location.href = 'maintenance.html';
        }
        break;
      case 'maintenance_mode':
        if (cmd.enabled && !sessionStorage.getItem('obsidian_admin')) {
          window.location.href = 'maintenance.html';
        }
        break;
      case 'disable_input_toggle':
        _enforceRemoteToggles();
        break;
      case 'screen_blackout_toggle':
        _enforceRemoteToggles();
        break;
      case 'freeze_screen_toggle':
        _enforceRemoteToggles();
        break;
      case 'blur_screen_toggle':
        _enforceRemoteToggles();
        break;

      // ---- ONE-SHOT COMMANDS ----
      case 'close_modals':
        // Close any open modals/overlays
        var modals = document.querySelectorAll('.modal, .admin-modal-overlay, [class*="modal"], [class*="overlay"], [role="dialog"]');
        for (var mi = 0; mi < modals.length; mi++) {
          modals[mi].style.display = 'none';
          try { modals[mi].remove(); } catch(e) {}
        }
        break;
      case 'scroll_top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'clear_selection':
        if (window.getSelection) window.getSelection().removeAllRanges();
        var focused = document.activeElement;
        if (focused && focused.blur) focused.blur();
        break;
      case 'play_sound':
        try {
          var actx = new (window.AudioContext || window.webkitAudioContext)();
          var osc = actx.createOscillator();
          var gain = actx.createGain();
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.value = 0.3;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.5);
          osc.stop(actx.currentTime + 0.5);
        } catch(e) {}
        break;

      // ---- CUSTOM JS EXECUTION ----
      case 'exec_js':
        if (cmd.code) {
          try { new Function(cmd.code)(); } catch(e) { console.warn('[Obsidian] Remote JS error:', e); }
        }
        break;
    }
  }

  /* ──────────────────────────────────────────────
     18. REMOTE TOGGLE ENFORCEMENT
     ────────────────────────────────────────────── */
  // Applies persistent overlays/styles based on admin toggle settings
  function _enforceRemoteToggles() {
    var a = getAdminSettings();
    var isAdmin = !!sessionStorage.getItem('obsidian_admin');
    var page = location.pathname.split('/').pop().replace('.html', '') || 'index';
    if (page === 'admin' || isAdmin) return;

    // --- Force Logout check (on page load, if toggle is ON, kick user) ---
    if (a.forceLogoutEnabled) {
      sessionStorage.clear();
      window.location.href = 'maintenance.html';
      return;
    }

    // --- Disable All Input ---
    var inputOverlay = document.getElementById('obsidian-disable-input-overlay');
    if (a.remoteDisableInput) {
      if (!inputOverlay) {
        inputOverlay = document.createElement('div');
        inputOverlay.id = 'obsidian-disable-input-overlay';
        inputOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999990;cursor:not-allowed;';
        document.body.appendChild(inputOverlay);
      }
      _injectAdminStyle('obsidian-disable-input-style', 'body { pointer-events: none !important; user-select: none !important; -webkit-user-select: none !important; } #obsidian-disable-input-overlay { pointer-events: auto !important; }');
    } else {
      if (inputOverlay) inputOverlay.remove();
      _injectAdminStyle('obsidian-disable-input-style', '');
    }

    // --- Screen Blackout ---
    var blackout = document.getElementById('obsidian-blackout-overlay');
    if (a.remoteScreenBlackout) {
      if (!blackout) {
        blackout = document.createElement('div');
        blackout.id = 'obsidian-blackout-overlay';
        blackout.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999998;background:#000;display:flex;align-items:center;justify-content:center;';
        blackout.innerHTML = '<div style="color:#333;font-size:1.2rem;font-family:system-ui,sans-serif;">Screen locked by administrator</div>';
        document.body.appendChild(blackout);
      }
    } else {
      if (blackout) blackout.remove();
    }

    // --- Freeze Screen ---
    _injectAdminStyle('obsidian-freeze-style', a.remoteFreezeScreen ?
      'body { overflow: hidden !important; } * { pointer-events: none !important; scroll-behavior: auto !important; }' : '');

    // --- Blur Screen ---
    _injectAdminStyle('obsidian-blur-style', a.remoteBlurScreen ?
      'body > *:not(#obsidian-blackout-overlay):not(#obsidian-disable-input-overlay) { filter: blur(8px) !important; transition: filter 0.3s; }' : '');
  }

  /* ──────────────────────────────────────────────
     19. ADMIN CONTROLS ENFORCEMENT
     ────────────────────────────────────────────── */
  // Enforces ALL admin settings on user-facing pages
  function applyAdminControls() {
    var a = getAdminSettings();
    var isAdmin = !!sessionStorage.getItem('obsidian_admin');
    var page = location.pathname.split('/').pop().replace('.html', '') || 'index';

    // Skip enforcement on admin page (admin needs full access)
    if (page === 'admin') return;

    // --- Custom JS injection ---
    if (a.customJS && !window._obsidianCustomJSRan) {
      window._obsidianCustomJSRan = true;
      try { new Function(a.customJS)(); } catch(e) { console.warn('[Obsidian] Custom JS error:', e); }
    }

    // --- Performance: Kill animations ---
    _injectAdminStyle('obsidian-kill-animations', a.killAnimations ?
      '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }' : '');

    // --- Performance: Low bandwidth ---
    _injectAdminStyle('obsidian-low-bandwidth', a.lowBandwidth ?
      '.particles-js-canvas-el { display: none !important; } .glow, [class*="glow"] { display: none !important; }' : '');

    // --- Performance: Disable thumbnails ---
    _injectAdminStyle('obsidian-no-thumbs', a.disableThumbnails ?
      '.game-button img, .game-card img, .game-thumbnail { display: none !important; } .game-button, .game-card { min-height: 60px; }' : '');

    // --- Header banner ---
    var existingBanner = document.getElementById('obsidian-admin-banner');
    if (a.showHeaderBanner && a.headerBannerText) {
      if (!existingBanner) {
        existingBanner = document.createElement('div');
        existingBanner.id = 'obsidian-admin-banner';
        document.body.insertBefore(existingBanner, document.body.firstChild);
      }
      var bannerColors = { info: 'var(--primary, #8b5cf6)', warning: '#f59e0b', danger: '#ef4444', success: '#10b981' };
      var bc = bannerColors[a.bannerColor] || bannerColors.info;
      existingBanner.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:999997;padding:8px 16px;text-align:center;font-size:0.85rem;font-weight:600;font-family:var(--font-sans, Inter, system-ui, sans-serif);background:' + bc + ';color:#fff;';
      existingBanner.textContent = a.headerBannerText;
    } else if (existingBanner) {
      existingBanner.remove();
    }

    // --- Footer text ---
    if (a.footerText) {
      var footers = document.querySelectorAll('.watermark p, footer.watermark p');
      for (var fi = 0; fi < footers.length; fi++) {
        if (!footers[fi].dataset.obsidianOrig) footers[fi].dataset.obsidianOrig = footers[fi].textContent;
        footers[fi].textContent = a.footerText;
      }
    }

    // --- Disable search (non-admin) ---
    _injectAdminStyle('obsidian-disable-search', (a.disableSearch && !isAdmin) ?
      '#search, .search-container, .search-bar, .search-wrapper, [class*="search-"] { display: none !important; }' : '');

    // --- Disable favorites (non-admin) ---
    _injectAdminStyle('obsidian-disable-favorites', (a.disableFavorites && !isAdmin) ?
      '.favorite-btn, [onclick*="favorite"], .favorites-strip, #favorites-strip { display: none !important; }' : '');

    // --- Disable ratings (non-admin) ---
    _injectAdminStyle('obsidian-disable-ratings', (a.disableRatings && !isAdmin) ?
      '.rating-container, [class*="rating"], .star-rating { display: none !important; }' : '');

    // --- Hidden categories ---
    if (a.hiddenCategories && a.hiddenCategories.length > 0 && !isAdmin) {
      var catCSS = '';
      a.hiddenCategories.forEach(function(cat) {
        catCSS += '[data-category="' + cat + '"], [data-cat="' + cat + '"] { display: none !important; } ';
      });
      _injectAdminStyle('obsidian-hidden-categories', catCSS);
    } else {
      _injectAdminStyle('obsidian-hidden-categories', '');
    }

    // --- Welcome message (flash once per session) ---
    if (a.welcomeMessage && !sessionStorage.getItem('obsidian_welcome_shown') && page !== 'index' && page !== 'locked' && page !== 'maintenance' && page !== 'kicked') {
      sessionStorage.setItem('obsidian_welcome_shown', '1');
      setTimeout(function() {
        FlashNotification.show(a.welcomeMessage, { duration: 3000, type: 'info' });
      }, 1500);
    }

    // --- Search filter / blocked words ---
    if (a.enableSearchFilter && a.blockedWords && a.blockedWords.length > 0 && !isAdmin) {
      window._obsidianBlockedWords = a.blockedWords;
    }

    // --- URL blocking ---
    if (a.enableUrlBlocking && a.blockedUrls && a.blockedUrls.length > 0 && !isAdmin) {
      window._obsidianBlockedUrls = a.blockedUrls;
    }

    // --- Rate limiting ---
    if (a.rateLimit && a.rateLimit.enabled && !isAdmin) {
      window._obsidianRateLimit = a.rateLimit;
    }

    // --- Read-only mode (block writes for non-admin) ---
    if (a.readOnlyMode && !isAdmin) {
      window._obsidianReadOnly = true;
    }

    // --- Enforce remote toggle states (disable input, blackout, freeze, blur, force logout) ---
    _enforceRemoteToggles();
  }

  // Helper: inject or clear an admin <style> element
  function _injectAdminStyle(id, css) {
    var el = document.getElementById(id);
    if (css) {
      if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
      el.textContent = css;
    } else if (el) {
      el.textContent = '';
    }
  }

  /* ──────────────────────────────────────────────
     20. IDLE TIMEOUT & TAB LIMITER
     ────────────────────────────────────────────── */
  function initIdleTimeout() {
    var a = getAdminSettings();
    if (!a.autoLogout || sessionStorage.getItem('obsidian_admin')) return;
    var timeout = (a.idleTimeout || 30) * 60 * 1000; // minutes to ms
    var _idleTimer = null;
    function resetIdle() {
      clearTimeout(_idleTimer);
      _idleTimer = setTimeout(function() {
        // Idle timeout reached — redirect to maintenance page
        FlashNotification.show('Session timed out due to inactivity', { duration: 2000, type: 'warning' });
        setTimeout(function() {
          sessionStorage.clear();
          window.location.href = 'main.html';
        }, 2000);
      }, timeout);
    }
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function(evt) {
      document.addEventListener(evt, resetIdle, { passive: true });
    });
    resetIdle();
  }

  function initTabLimiter() {
    var a = getAdminSettings();
    if (!a.limitTabs || sessionStorage.getItem('obsidian_admin')) return;
    var maxTabs = a.maxTabs || 5;
    var TAB_COUNT_KEY = 'obsidian_tab_count';
    // Increment tab count
    var current = parseInt(localStorage.getItem(TAB_COUNT_KEY) || '0');
    current++;
    localStorage.setItem(TAB_COUNT_KEY, current.toString());
    // Decrement on close
    window.addEventListener('beforeunload', function() {
      var c = parseInt(localStorage.getItem(TAB_COUNT_KEY) || '1');
      localStorage.setItem(TAB_COUNT_KEY, Math.max(0, c - 1).toString());
    });
    // Check limit
    if (current > maxTabs) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,system-ui,sans-serif;background:var(--bg-base,#0a0a0f);color:var(--text-primary,#f0f0f5);text-align:center;"><div><h2 style="color:var(--danger,#ef4444);">Too Many Tabs</h2><p style="color:var(--text-muted,#666);">Maximum ' + maxTabs + ' tabs allowed. Please close some tabs.</p></div></div>';
    }
  }

  /* ──────────────────────────────────────────────
     21. SCHEDULED ACTIONS
     ────────────────────────────────────────────── */
  function runScheduledActions() {
    var a = getAdminSettings();
    var sched = a.scheduled || {};

    // Auto-maintenance (12am-6am)
    if (sched.autoMaintenance && !sessionStorage.getItem('obsidian_admin')) {
      var hour = new Date().getHours();
      if (hour >= 0 && hour < 6) {
        if (!a.maintenanceMode) {
          // Only set if not already in maintenance
          setAdminSettings({ maintenanceMode: true, _autoMaintenance: true });
        }
      } else if (a._autoMaintenance) {
        // Lift auto-maintenance outside the window
        setAdminSettings({ maintenanceMode: false, _autoMaintenance: false });
      }
    }

    // Auto-clear old activity log entries (older than 7 days)
    if (sched.autoClearLog) {
      try {
        var log = JSON.parse(localStorage.getItem('obsidian_activity_log') || '[]');
        var cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        var filtered = log.filter(function(e) {
          return new Date(e.timestamp).getTime() > cutoff;
        });
        if (filtered.length !== log.length) {
          localStorage.setItem('obsidian_activity_log', JSON.stringify(filtered));
        }
      } catch(e) {}
    }

    // Auto-clear sessions daily
    if (sched.autoClearSessions) {
      var lastClear = localStorage.getItem('obsidian_last_session_clear');
      var now = new Date();
      if (!lastClear || (now.getTime() - parseInt(lastClear)) > 86400000) {
        localStorage.setItem('obsidian_last_session_clear', now.getTime().toString());
        // Don't clear the admin's own session
        if (!sessionStorage.getItem('obsidian_admin')) {
          sessionStorage.clear();
        }
      }
    }
  }

  /* ──────────────────────────────────────────────
     22. LOGIN ATTEMPT TRACKING
     ────────────────────────────────────────────── */
  function _trackLoginAttempt(success, type) {
    var a = getAdminSettings();
    if (!a.trackLoginAttempts) return;
    try {
      var attempts = JSON.parse(localStorage.getItem('obsidian_login_attempts') || '[]');
      attempts.push({ success: success, type: type || 'password', time: Date.now() });
      if (attempts.length > 100) attempts = attempts.slice(-100);
      localStorage.setItem('obsidian_login_attempts', JSON.stringify(attempts));
    } catch(e) {}
  }

  function _checkLockout() {
    var a = getAdminSettings();
    if (!a.lockoutEnabled) return false;
    var maxAttempts = a.maxLoginAttempts || 5;
    var lockoutDuration = (a.lockoutDuration || 15) * 60 * 1000; // minutes to ms
    try {
      var attempts = JSON.parse(localStorage.getItem('obsidian_login_attempts') || '[]');
      var cutoff = Date.now() - lockoutDuration;
      var recentFails = attempts.filter(function(a) {
        return !a.success && a.time > cutoff;
      });
      return recentFails.length >= maxAttempts;
    } catch(e) { return false; }
  }

  /* ──────────────────────────────────────────────
     23. GAME LAUNCH GATING
     ────────────────────────────────────────────── */
  // Provides global hooks for main.html to check before launching games
  function canLaunchGame(gameUrl, gameName) {
    var a = getAdminSettings();
    var isAdmin = !!sessionStorage.getItem('obsidian_admin');
    if (isAdmin) return { allowed: true };

    // Disable game launch
    if (a.disableGameLaunch) return { allowed: false, reason: 'Game launching is disabled by admin' };

    // URL blocking
    if (a.enableUrlBlocking && a.blockedUrls && gameUrl) {
      for (var i = 0; i < a.blockedUrls.length; i++) {
        if (gameUrl.indexOf(a.blockedUrls[i]) !== -1) {
          return { allowed: false, reason: 'This game URL has been blocked by admin' };
        }
      }
    }

    // Rate limiting
    if (a.rateLimit && a.rateLimit.enabled) {
      var maxMs = (a.rateLimit.maxMinutes || 60) * 60 * 1000;
      var todayKey = 'obsidian_daily_playtime_' + new Date().toISOString().split('T')[0];
      var todayTime = parseInt(localStorage.getItem(todayKey) || '0');
      if (todayTime >= maxMs) {
        return { allowed: false, reason: 'Daily play time limit reached (' + a.rateLimit.maxMinutes + ' min)' };
      }
    }

    // Blocked words in game name
    if (a.enableSearchFilter && a.blockedWords && gameName) {
      var lowerName = gameName.toLowerCase();
      for (var w = 0; w < a.blockedWords.length; w++) {
        if (lowerName.indexOf(a.blockedWords[w]) !== -1) {
          return { allowed: false, reason: 'This game is blocked by content filter' };
        }
      }
    }

    return { allowed: true };
  }

  // Track daily play time for rate limiting
  function _trackDailyPlayTime() {
    var a = getAdminSettings();
    if (!a.rateLimit || !a.rateLimit.enabled) return;
    var todayKey = 'obsidian_daily_playtime_' + new Date().toISOString().split('T')[0];
    setInterval(function() {
      // Only count if a game iframe is visible
      var iframe = document.getElementById('game-iframe');
      if (iframe && iframe.src && iframe.offsetParent !== null) {
        var current = parseInt(localStorage.getItem(todayKey) || '0');
        localStorage.setItem(todayKey, (current + 5000).toString()); // 5s intervals
      }
    }, 5000);
  }

  /* ──────────────────────────────────────────────
     24. AUTO-SAVE SYSTEM
     ────────────────────────────────────────────── */
  function initAutoSave() {
    var indicator = document.createElement('div');
    indicator.className = 'autosave-indicator';
    indicator.id = 'autosave-indicator';
    document.body.appendChild(indicator);
    setInterval(function(){
      if (ObsidianSettings.save()) {
        indicator.classList.add('saving');
        setTimeout(function(){ indicator.classList.remove('saving'); }, 600);
      }
    }, AUTOSAVE_INTERVAL);
  }

  /* ──────────────────────────────────────────────
     25. TOAST & CONFIRM MODAL
     ────────────────────────────────────────────── */
  function showToast(message, type) {
    type = type || 'info';
    var container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    var icons = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    toast.innerHTML = (icons[type]||icons.info) + '<span>'+message+'</span>';
    container.appendChild(toast);
    setTimeout(function(){ toast.remove(); if(container.children.length===0) container.remove(); }, 3000);
  }

  function showConfirmModal(message, onConfirm, onCancel) {
    // Remove any existing confirm modal
    var existing = document.getElementById('obsidian-confirm-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'obsidian-confirm-overlay';
    overlay.className = 'obsidian-confirm-overlay';
    overlay.innerHTML = '<div class="obsidian-confirm-modal">' +
      '<div class="obsidian-confirm-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
      '<div class="obsidian-confirm-message">' + message + '</div>' +
      '<div class="obsidian-confirm-btns">' +
        '<button class="btn btn-secondary" id="obsidian-confirm-cancel">Cancel</button>' +
        '<button class="btn btn-danger" id="obsidian-confirm-ok">Confirm</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(function() { overlay.classList.add('active'); });

    function cleanup() {
      overlay.classList.remove('active');
      setTimeout(function() { overlay.remove(); }, 200);
    }

    document.getElementById('obsidian-confirm-ok').addEventListener('click', function() {
      cleanup();
      if (typeof onConfirm === 'function') onConfirm();
    });
    document.getElementById('obsidian-confirm-cancel').addEventListener('click', function() {
      cleanup();
      if (typeof onCancel === 'function') onCancel();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        cleanup();
        if (typeof onCancel === 'function') onCancel();
      }
    });
  }

  /* ──────────────────────────────────────────────
     26. HIDDEN GAMES & MEDIA LIBRARY
     ────────────────────────────────────────────── */
  function getHiddenGames() {
    var a = getAdminSettings();
    return a.hiddenGames || [];
  }

  var MediaLibrary = {
    getAll: function() {
      try { return JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || '[]'); } catch(e) { return []; }
    },
    save: function(items) {
      localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(items));
    },
    add: function(item) {
      var items = this.getAll();
      item.id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      item.addedAt = new Date().toISOString();
      items.unshift(item);
      this.save(items);
      return item;
    },
    remove: function(id) {
      var items = this.getAll().filter(function(i) { return i.id !== id; });
      this.save(items);
    },
    clear: function() {
      localStorage.removeItem(MEDIA_LIBRARY_KEY);
    },
    getByType: function(type) {
      return this.getAll().filter(function(i) { return i.type === type; });
    }
  };

  /* ──────────────────────────────────────────────
     27. PARTICLES.JS INTEGRATION
     ────────────────────────────────────────────── */
  var _particlesReady = false;
  var _particlesScriptLoaded = false;

  function _getThemeColors() {
    var style = getComputedStyle(document.documentElement);
    var primary = style.getPropertyValue('--primary').trim() || '#8b5cf6';
    var accent = style.getPropertyValue('--accent').trim() || '#c4b5fd';
    var bgBase = style.getPropertyValue('--bg-base').trim() || '#0a0a0f';
    // Detect if theme is light by checking luminance of bg-base
    var isLight = _isLightColor(bgBase);
    return { primary: primary, accent: accent, bgBase: bgBase, isLight: isLight };
  }

  function _isLightColor(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
    var r = parseInt(hex.substr(0, 2), 16);
    var g = parseInt(hex.substr(2, 2), 16);
    var b = parseInt(hex.substr(4, 2), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  function _getParticlesConfig(colors) {
    var particleOpacity = colors.isLight ? 0.4 : 0.6;
    var lineOpacity = colors.isLight ? 0.15 : 0.12;
    var particleSize = 3.5;
    var particleCount = 70;
    var lineDistance = 150;
    var moveSpeed = 1.2;

    return {
      particles: {
        number: {
          value: particleCount,
          density: { enable: true, value_area: 800 }
        },
        color: { value: [colors.primary, colors.accent] },
        shape: {
          type: ['circle', 'circle', 'circle', 'star'],
          stroke: { width: 0, color: '#000000' },
          polygon: { nb_sides: 5 }
        },
        opacity: {
          value: particleOpacity,
          random: true,
          anim: { enable: true, speed: 0.8, opacity_min: 0.15, sync: false }
        },
        size: {
          value: particleSize,
          random: true,
          anim: { enable: true, speed: 1.5, size_min: 0.8, sync: false }
        },
        line_linked: {
          enable: true,
          distance: lineDistance,
          color: colors.primary,
          opacity: lineOpacity,
          width: 1
        },
        move: {
          enable: true,
          speed: moveSpeed,
          direction: 'none',
          random: true,
          straight: false,
          out_mode: 'out',
          bounce: false,
          attract: { enable: true, rotateX: 800, rotateY: 1200 }
        }
      },
      interactivity: {
        detect_on: 'window',
        events: {
          onhover: { enable: true, mode: 'grab' },
          onclick: { enable: true, mode: 'push' },
          resize: true
        },
        modes: {
          grab: { distance: 180, line_linked: { opacity: 0.4 } },
          push: { particles_nb: 3 },
          repulse: { distance: 150, duration: 0.4 }
        }
      },
      retina_detect: true
    };
  }

  function initParticles() {
    // Create particles container if it doesn't exist
    if (!document.getElementById('particles-js')) {
      var container = document.createElement('div');
      container.id = 'particles-js';
      document.body.insertBefore(container, document.body.firstChild);
    }

    // Load particles.js script if not loaded
    if (!_particlesScriptLoaded) {
      _particlesScriptLoaded = true;
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js';
      script.onload = function() {
        _particlesReady = true;
        _applyParticles();
      };
      script.onerror = function() {
        _particlesScriptLoaded = false;
        console.warn('[Obsidian] Failed to load particles.js');
      };
      document.head.appendChild(script);
    } else if (_particlesReady) {
      _applyParticles();
    }
  }

  function _applyParticles() {
    if (!_particlesReady || typeof window.particlesJS === 'undefined') return;
    var colors = _getThemeColors();
    var config = _getParticlesConfig(colors);
    // Destroy existing instance if present
    if (window.pJSDom && window.pJSDom.length > 0) {
      try {
        window.pJSDom[0].pJS.fn.vendors.destroypJS();
        window.pJSDom = [];
      } catch(e) {}
    }
    window.particlesJS('particles-js', config);
  }

  function refreshParticles() {
    if (_particlesReady) {
      // Small delay to let CSS variables settle after theme switch
      setTimeout(_applyParticles, 50);
    }
  }

  // Hook into ThemeEngine.setTheme to refresh particles on theme change
  var _origSetTheme = ThemeEngine.setTheme;
  ThemeEngine.setTheme = function(name) {
    _origSetTheme.call(ThemeEngine, name);
    refreshParticles();
  };

  // Also hook into apply for custom theme changes
  var _origApply = ThemeEngine.apply;
  ThemeEngine.apply = function(settings) {
    _origApply.call(ThemeEngine, settings);
    refreshParticles();
  };

  /* ──────────────────────────────────────────────
     28. TAB LEADER ELECTION
     ────────────────────────────────────────────── */
  // Only 1 WebSocket connection per device
  var WS_LEADER_KEY = 'obsidian_ws_leader';
  var _tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  var _isWsLeader = false;

  function _tryClaimLeader() {
    var now = Date.now();
    var raw = localStorage.getItem(WS_LEADER_KEY);
    var leader = null;
    try { leader = JSON.parse(raw); } catch(e) {}
    // Claim if no leader or leader heartbeat is stale (>25s, heartbeat every 15s)
    if (!leader || !leader.tab || (now - (leader.hb || 0)) > 25000) {
      localStorage.setItem(WS_LEADER_KEY, JSON.stringify({ tab: _tabId, hb: now }));
      _isWsLeader = true;
      return true;
    }
    if (leader.tab === _tabId) {
      _isWsLeader = true;
      return true;
    }
    _isWsLeader = false;
    return false;
  }

  function _updateLeaderHeartbeat() {
    if (!_isWsLeader) return;
    localStorage.setItem(WS_LEADER_KEY, JSON.stringify({ tab: _tabId, hb: Date.now() }));
  }

  function _releaseLeadership() {
    try {
      var raw = localStorage.getItem(WS_LEADER_KEY);
      var leader = JSON.parse(raw);
      if (leader && leader.tab === _tabId) {
        localStorage.removeItem(WS_LEADER_KEY);
      }
    } catch(e) {}
    _isWsLeader = false;
  }

  // Release leadership when this tab closes so another tab can take over
  window.addEventListener('beforeunload', _releaseLeadership);

  // Non-leader tabs: listen for storage events to get online count & announcements from leader
  window.addEventListener('storage', function(e) {
    if (e.key === 'obsidian_ws_broadcast' && e.newValue) {
      try {
        var msg = JSON.parse(e.newValue);
        if (msg.type === 'online_count' && typeof msg.online === 'number') {
          ObsidianSocket._onlineCount = msg.online;
          ObsidianSocket._updateOnlineDisplay();
        }
        if (msg.type === 'announcement') {
          AnnouncementSystem.handleBackendAnnouncement(msg.data);
        }
        // Fire registered listeners on non-leader tabs too
        var handlers = ObsidianSocket._listeners[msg.type];
        if (handlers) {
          for (var i = 0; i < handlers.length; i++) {
            try { handlers[i](msg); } catch(ex) {}
          }
        }
      } catch(ex) {}
    }
    // If leader released, try to claim
    if (e.key === WS_LEADER_KEY && !e.newValue && !_isWsLeader) {
      setTimeout(function() {
        if (_tryClaimLeader()) {
          ObsidianSocket.connect();
        }
      }, Math.random() * 500); // Random delay to avoid race between tabs
    }
  });

  /* ──────────────────────────────────────────────
     29. WEBSOCKET (ObsidianSocket)
     ────────────────────────────────────────────── */
  // Only the LEADER TAB connects — other tabs receive data via localStorage broadcast
  var ObsidianSocket = {
    _ws: null,
    _clientId: null,
    _reconnectTimer: null,
    _heartbeatTimer: null,
    _leaderCheckTimer: null,
    _listeners: {},
    _connected: false,
    _onlineCount: 0,

    connect: function() {
      var self = this;

      // Only the leader tab opens a WebSocket
      if (!_tryClaimLeader()) {
        // Not the leader — periodically check if leader died
        clearInterval(self._leaderCheckTimer);
        self._leaderCheckTimer = setInterval(function() {
          if (_tryClaimLeader()) {
            clearInterval(self._leaderCheckTimer);
            self.connect();
          }
        }, 5000);
        // Read last known online count from storage
        var storedCount = localStorage.getItem('obsidian_online_count');
        if (storedCount) {
          self._onlineCount = parseInt(storedCount) || 0;
          self._updateOnlineDisplay();
        }
        return;
      }

      if (self._ws && (self._ws.readyState === 0 || self._ws.readyState === 1)) return;

      try {
        self._ws = new WebSocket(OBSIDIAN_WS_URL);
      } catch(e) {
        console.warn('[Obsidian] WebSocket connection failed:', e);
        self._scheduleReconnect();
        return;
      }

      self._ws.onopen = function() {
        self._connected = true;
        var pageName = location.pathname.split('/').pop().replace('.html','') || 'index';
        var persistentId = getObsidianUserId();
        self.send({ type: 'heartbeat', page: pageName, isAdmin: !!sessionStorage.getItem('obsidian_admin'), userId: persistentId });
        clearInterval(self._heartbeatTimer);
        self._heartbeatTimer = setInterval(function() {
          _updateLeaderHeartbeat(); // Keep leader lock alive
          var pg = location.pathname.split('/').pop().replace('.html','') || 'index';
          self.send({ type: 'heartbeat', page: pg, isAdmin: !!sessionStorage.getItem('obsidian_admin'), userId: persistentId });
          // Also report stats periodically
          ObsidianStatsReporter.report();
        }, 15000);
      };

      self._ws.onmessage = function(event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch(e) { return; }
        if (msg.type === 'welcome') {
          self._clientId = msg.clientId;
          if (typeof msg.online === 'number') self._onlineCount = msg.online;
        }
        if (msg.type === 'online_count' && typeof msg.online === 'number') {
          self._onlineCount = msg.online;
          self._updateOnlineDisplay();
          // Store for non-leader tabs and broadcast via storage event
          localStorage.setItem('obsidian_online_count', msg.online.toString());
        }
        if (msg.type === 'announcement') {
          AnnouncementSystem.handleBackendAnnouncement(msg.data);
        }
        // Broadcast ALL messages to other tabs via localStorage
        try {
          localStorage.setItem('obsidian_ws_broadcast', JSON.stringify(msg));
          // Clear immediately so next identical message still triggers storage event
          localStorage.removeItem('obsidian_ws_broadcast');
        } catch(ex) {}
        // Fire registered listeners
        var handlers = self._listeners[msg.type];
        if (handlers) {
          for (var i = 0; i < handlers.length; i++) {
            try { handlers[i](msg); } catch(e) { /* ignore */ }
          }
        }
      };

      self._ws.onclose = function() {
        self._connected = false;
        clearInterval(self._heartbeatTimer);
        self._scheduleReconnect();
      };

      self._ws.onerror = function() {
        self._connected = false;
        try { self._ws.close(); } catch(e) {}
      };
    },

    send: function(msg) {
      if (this._ws && this._ws.readyState === 1) {
        try { this._ws.send(JSON.stringify(msg)); } catch(e) { /* ignore */ }
      }
    },

    on: function(type, handler) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(handler);
    },

    off: function(type, handler) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter(function(h) { return h !== handler; });
    },

    _scheduleReconnect: function() {
      var self = this;
      clearTimeout(self._reconnectTimer);
      self._reconnectTimer = setTimeout(function() { self.connect(); }, 3000);
    },

    notifyPageChange: function(page, currentGame) {
      this.send({ type: 'page_change', page: page, currentGame: currentGame || null });
    },

    isConnected: function() {
      return this._connected;
    },

    getOnlineCount: function() {
      return this._onlineCount;
    },

    _updateOnlineDisplay: function() {
      // Update any elements showing online count
      var els = document.querySelectorAll('[data-obsidian-online]');
      for (var i = 0; i < els.length; i++) {
        els[i].textContent = this._onlineCount;
      }
      // Update the specific live-user-count badge in admin
      var badge = document.getElementById('live-user-count');
      if (badge) badge.textContent = this._onlineCount + ' online';
      // Update ws status badge
      var wsBadge = document.getElementById('ws-status-badge');
      if (wsBadge) {
        wsBadge.textContent = this._connected ? 'Connected' : 'Disconnected';
        wsBadge.className = 'badge ' + (this._connected ? 'badge-success' : 'badge-danger');
      }
    }
  };

  /* ──────────────────────────────────────────────
     30. ADMIN API HEARTBEAT
     ────────────────────────────────────────────── */
  // Registers user, checks bans, gets commands/messages
  var AdminApiHeartbeat = {
    _timer: null,
    _interval: 30000, // 30 seconds
    send: function() {
      try {
        var userId = getObsidianUserId();
        var playData = PlayTime.getData();
        var totalSessions = 0;
        var gamesPlayed = 0;
        for (var k in playData) {
          if (playData.hasOwnProperty(k)) {
            totalSessions += (playData[k].sessions || 0);
            gamesPlayed++;
          }
        }
        var favs = [];
        try { favs = JSON.parse(localStorage.getItem('obsidian_favorites') || '[]'); } catch(e) {}
        var page = location.pathname.split('/').pop() || 'index.html';

        fetch(OBSIDIAN_ADMIN_API_URL + '/api/users/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({
            user_id: userId,
            page: page,
            current_game: (PlayTime._game || ''),
            user_agent: navigator.userAgent,
            sessions: totalSessions,
            total_play_time: Math.floor(PlayTime.getTotalTime() / 1000),
            games_played: gamesPlayed,
            favorites_count: favs.length,
            ip_hash: ''
          })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data || !data.ok) return;

          // Handle server-side ban
          if (data.is_banned && !sessionStorage.getItem('obsidian_admin')) {
            localStorage.setItem(KICKED_SELF_KEY, 'true');
            _setCookie(KICKED_COOKIE_KEY, 'true', 365 * 5);
            KickSystem._redirectToKicked();
            return;
          }

          // Apply server settings
          if (data.server_settings && Object.keys(data.server_settings).length > 0) {
            _serverSettingsCache = data.server_settings;
            _serverSettingsFetched = true;
          }

          // Process pending commands
          if (data.commands && data.commands.length > 0) {
            data.commands.forEach(function(cmd) {
              if (cmd.command) _handleAdminCommand(cmd.command);
            });
          }

          // Show server messages
          if (data.messages && data.messages.length > 0) {
            var readIds = [];
            data.messages.forEach(function(msg) {
              FlashNotification.show(msg.message, {
                duration: 5000,
                type: msg.msg_type || 'info'
              });
              readIds.push(msg.id);
            });
            // Mark messages as read
            if (readIds.length > 0) {
              fetch(OBSIDIAN_ADMIN_API_URL + '/api/users/messages/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
                body: JSON.stringify({ ids: readIds })
              }).catch(function() {});
            }
          }
        })
        .catch(function(e) { /* silent */ });
      } catch(e) { /* silent */ }
    },
    start: function() {
      var self = this;
      // Send initial heartbeat after short delay
      setTimeout(function() { self.send(); }, 3000);
      // Then send every 30 seconds
      if (!self._timer) {
        self._timer = setInterval(function() { self.send(); }, self._interval);
      }
    },
    stop: function() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
  };

  /* ──────────────────────────────────────────────
     31. ADMIN API HELPER
     ────────────────────────────────────────────── */
  var AdminApi = {
    _url: OBSIDIAN_ADMIN_API_URL,
    _headers: { 'ngrok-skip-browser-warning': '1' },
    fetch: function(path, options) {
      options = options || {};
      options.headers = Object.assign({}, this._headers, options.headers || {});
      return fetch(this._url + path, options).then(function(r) { return r.json(); });
    },
    get: function(path) { return this.fetch(path); },
    post: function(path, data) {
      return this.fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify(data || {})
      });
    },
    del: function(path) {
      return this.fetch(path, { method: 'DELETE' });
    }
  };

  /* ──────────────────────────────────────────────
     32. STATS REPORTER
     ────────────────────────────────────────────── */
  // Sends local stats to backend for aggregation
  var ObsidianStatsReporter = {
    report: function() {
      try {
        var userId = getObsidianUserId();
        var playData = PlayTime.getData();
        var totalSessions = 0;
        var gamesPlayed = 0;
        for (var k in playData) {
          if (playData.hasOwnProperty(k)) {
            totalSessions += (playData[k].sessions || 0);
            gamesPlayed++;
          }
        }
        var favs = [];
        try { favs = JSON.parse(localStorage.getItem('obsidian_favorites') || '[]'); } catch(e) {}
        var recent = [];
        try { recent = JSON.parse(localStorage.getItem('obsidian_recent_games') || '[]'); } catch(e) {}
        var media = [];
        try { media = JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || '[]'); } catch(e) {}

        fetch(OBSIDIAN_BACKEND_URL + '/api/stats/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({
            user_id: userId,
            games_played: gamesPlayed,
            total_time: Math.floor(PlayTime.getTotalTime() / 1000),
            sessions: totalSessions,
            favorites: favs.length,
            recent_count: recent.length,
            media_count: media.length
          })
        }).catch(function(e) { /* silent */ });
      } catch(e) { /* silent */ }
    },
    getCombined: function() {
      return fetch(OBSIDIAN_BACKEND_URL + '/api/stats/combined', {
        headers: { 'ngrok-skip-browser-warning': '1' }
      })
        .then(function(r) { return r.json(); })
        .catch(function(e) { return null; });
    }
  };

  /* ──────────────────────────────────────────────
     33. INITIALIZATION
     ────────────────────────────────────────────── */
  function init() {
    ObsidianSettings.load();
    ThemeEngine.apply();
    applyTabCloak();
    initPanicMode();
    initSecretAccess();
    initAutoSave();
    checkKicked();
    checkMaintenance();
    initParticles();
    ObsidianSocket.connect();
    initRealtimeListeners();
    KickSystem.startPolling();
    // Apply admin controls (CSS/JS injection, restrictions, banner, etc.)
    applyAdminControls();
    initIdleTimeout();
    initTabLimiter();
    runScheduledActions();
    _trackDailyPlayTime();
    // Report stats on load and periodically
    setTimeout(function() { ObsidianStatsReporter.report(); }, 2000);
    // Start admin API heartbeat (registers user, checks bans, gets commands)
    AdminApiHeartbeat.start();
    // Fetch server-side admin settings on load
    fetchServerAdminSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  /* ──────────────────────────────────────────────
     34. PUBLIC API (window.Obsidian)
     ────────────────────────────────────────────── */
  window.Obsidian = {
    Settings: ObsidianSettings,
    Theme: ThemeEngine,
    Announcements: AnnouncementSystem,
    PlayTime: PlayTime,
    Media: MediaLibrary,
    Socket: ObsidianSocket,
    Stats: ObsidianStatsReporter,
    Kick: KickSystem,
    Flash: FlashNotification,
    AdminApi: AdminApi,
    AdminHeartbeat: AdminApiHeartbeat,
    showToast: showToast,
    DEFAULTS: DEFAULTS,
    getAdminSettings: getAdminSettings,
    setAdminSettings: setAdminSettings,
    getAdminPassword: getAdminPassword,
    showConfirmModal: showConfirmModal,
    getHiddenGames: getHiddenGames,
    refreshParticles: refreshParticles,
    BACKEND_URL: OBSIDIAN_BACKEND_URL,
    ADMIN_API_URL: OBSIDIAN_ADMIN_API_URL,
    getUserId: getObsidianUserId,
    canLaunchGame: canLaunchGame,
    trackLoginAttempt: _trackLoginAttempt,
    checkLockout: _checkLockout,
    applyAdminControls: applyAdminControls,
    syncAdminSettingsToServer: syncAdminSettingsToServer,
    fetchServerAdminSettings: fetchServerAdminSettings
  };

})();
