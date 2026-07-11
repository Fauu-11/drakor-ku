(function () {
  const config = window.KSTREAM_CONFIG;
  const storagePrefix = 'kstream:';
  let client = null;
  let viewerSessionPromise = null;

  function getClient() {
    if (client) return client;
    if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
      throw new Error('Konfigurasi Supabase belum lengkap.');
    }
    if (!window.supabase?.createClient) {
      throw new Error('Library Supabase gagal dimuat.');
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  async function testConnection() {
    try {
      const { error } = await getClient().from('drakor').select('id').limit(1);
      if (error) throw error;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function isMissingTable(error) {
    return error?.code === 'PGRST205' || /could not find the table/i.test(error?.message || '');
  }

  async function ensureViewerSession() {
    if (viewerSessionPromise) return viewerSessionPromise;

    viewerSessionPromise = (async () => {
      const supabaseClient = getClient();
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session) return sessionData.session;

      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      return data.session;
    })();

    try {
      return await viewerSessionPromise;
    } catch (error) {
      viewerSessionPromise = null;
      throw error;
    }
  }

  function parseGenres(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value || 'Drama')
      .split(/[,/|]/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function safeJsonGet(key, fallback) {
    try {
      const value = localStorage.getItem(storagePrefix + key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function safeJsonSet(key, value) {
    localStorage.setItem(storagePrefix + key, JSON.stringify(value));
  }

  function generateLocalId(prefix = 'local-drama') {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function normalizeEpisode(episode = {}, index = 0) {
    return {
      epsName: episode.epsName || `Episode ${index + 1}`,
      videoUrl: episode.videoUrl || '',
      linkStatus: episode.linkStatus || 'Unchecked'
    };
  }

  function normalizeDrama(item = {}, fallbackId = '') {
    const episodes = Array.isArray(item.episodes)
      ? item.episodes.map((episode, index) => normalizeEpisode(episode, index)).filter(entry => entry.epsName || entry.videoUrl)
      : [];

    return {
      id: item.id ?? fallbackId ?? generateLocalId(),
      title: item.title || 'Tanpa Judul',
      image: item.image || '',
      genre: item.genre || 'Drama',
      year: item.year ? String(item.year) : '',
      synopsis: item.synopsis || '',
      created_at: item.created_at || new Date().toISOString(),
      episodes
    };
  }

  function getCatalogDrafts() {
    return safeJsonGet('catalog-drafts', {});
  }

  function setCatalogDraft(id, payload) {
    const drafts = getCatalogDrafts();
    drafts[String(id)] = payload;
    safeJsonSet('catalog-drafts', drafts);
  }

  function clearCatalogDraft(id) {
    const drafts = getCatalogDrafts();
    delete drafts[String(id)];
    safeJsonSet('catalog-drafts', drafts);
  }

  function mergeCatalogItems(remoteItems = []) {
    const merged = new Map();

    (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => {
      const normalized = normalizeDrama(item, item?.id);
      merged.set(String(normalized.id), normalized);
    });

    const drafts = getCatalogDrafts();
    Object.entries(drafts).forEach(([id, draft]) => {
      if (!draft) return;
      if (draft.deleted) {
        merged.delete(String(id));
        return;
      }

      const current = merged.get(String(id));
      const normalized = normalizeDrama({
        ...current,
        ...draft,
        id: draft.id ?? id,
        created_at: draft.created_at || current?.created_at
      }, draft.id ?? id);
      merged.set(String(normalized.id), normalized);
    });

    return [...merged.values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function visitorId() {
    let id = localStorage.getItem(storagePrefix + 'visitor-id');
    if (!id) {
      id = window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(storagePrefix + 'visitor-id', id);
    }
    return id;
  }

  function relativeTime(value) {
    const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
    const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'baru saja';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} menit lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} hari lalu`;
    return new Date(timestamp).toLocaleDateString('id-ID');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const colors = {
      success: 'border-emerald-500/25 text-emerald-200',
      error: 'border-red-500/25 text-red-200',
      warning: 'border-amber-500/25 text-amber-200',
      info: 'border-white/10 text-white/90'
    };
    toast.className = `rounded-2xl border bg-[#0d0d16]/95 px-4 py-3 text-sm shadow-2xl backdrop-blur ${colors[type] || colors.info}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function setConnectionBadge(element, state, detail = '') {
    if (!element) return;
    const states = {
      loading: ['Memeriksa cloud', 'text-amber-300 border-amber-500/20 bg-amber-500/10', 'fa-circle-notch fa-spin'],
      online: ['Supabase online', 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10', 'fa-circle'],
      offline: ['Cloud bermasalah', 'text-red-300 border-red-500/20 bg-red-500/10', 'fa-triangle-exclamation'],
      local: ['Mode lokal', 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10', 'fa-hard-drive']
    };
    const [label, classes, icon] = states[state] || states.loading;
    element.className = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${classes}`;
    element.innerHTML = '';
    const iconElement = document.createElement('i');
    iconElement.className = `fa-solid ${icon}`;
    const text = document.createElement('span');
    text.textContent = detail || label;
    element.append(iconElement, text);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', () => {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.register('./sw.js').then(registration => {
        const updateButton = document.getElementById('app-update-button');
        const showUpdate = worker => {
          if (!worker) return;
          if (updateButton) {
            updateButton.classList.remove('hidden');
            updateButton.onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
          } else {
            showToast('Update tersedia. Muat ulang halaman untuk versi terbaru.', 'info', 5000);
          }
        };

        if (registration.waiting) showUpdate(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
          });
        });
      }).catch(error => {
        console.warn('Service worker gagal didaftarkan:', error);
      });
    });
  }

  window.KStream = Object.freeze({
    config,
    getClient,
    testConnection,
    ensureViewerSession,
    isMissingTable,
    parseGenres,
    safeJsonGet,
    safeJsonSet,
    generateLocalId,
    normalizeEpisode,
    normalizeDrama,
    getCatalogDrafts,
    setCatalogDraft,
    clearCatalogDraft,
    mergeCatalogItems,
    visitorId,
    relativeTime,
    showToast,
    setConnectionBadge,
    registerServiceWorker
  });
})();
