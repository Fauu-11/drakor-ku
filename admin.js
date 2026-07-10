(function () {
  const {
    config,
    getClient,
    ensureViewerSession,
    setConnectionBadge,
    showToast,
    generateLocalId,
    setCatalogDraft,
    clearCatalogDraft,
    mergeCatalogItems,
    parseGenres,
    registerServiceWorker
  } = window.KStream;
  const supabase = getClient();

  const ADMIN_USERNAME = 'admin';
  const ADMIN_PASSWORD = '110301';
  const ADMIN_UNLOCK_KEY = 'kstream:admin-unlocked';
  const ADMIN_SESSION_KEY = 'kstream:admin-session';

  const elements = {
    gateScreen: document.getElementById('gate-screen'),
    loginScreen: document.getElementById('login-screen'),
    loginForm: document.getElementById('login-form'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginButton: document.getElementById('login-button'),
    app: document.getElementById('admin-app'),
    badge: document.getElementById('connection-badge'),
    logout: document.getElementById('logout-button'),
    form: document.getElementById('content-form'),
    newContent: document.getElementById('new-content-button'),
    editorDock: document.getElementById('editor-dock'),
    editId: document.getElementById('edit-id'),
    formTitle: document.getElementById('form-title'),
    cancelEdit: document.getElementById('cancel-edit'),
    title: document.getElementById('title'),
    genre: document.getElementById('genre'),
    year: document.getElementById('year'),
    image: document.getElementById('image'),
    synopsis: document.getElementById('synopsis'),
    posterWrap: document.getElementById('poster-preview-wrap'),
    poster: document.getElementById('poster-preview'),
    addEpisode: document.getElementById('add-episode'),
    episodeEditor: document.getElementById('episode-editor'),
    resetForm: document.getElementById('reset-form'),
    saveButton: document.getElementById('save-button'),
    search: document.getElementById('admin-search'),
    statusFilter: document.getElementById('status-filter'),
    sortFilter: document.getElementById('sort-filter'),
    expandAll: document.getElementById('expand-all'),
    collapseAll: document.getElementById('collapse-all'),
    list: document.getElementById('content-list'),
    listCount: document.getElementById('list-count'),
    statTitles: document.getElementById('stat-titles'),
    statEpisodes: document.getElementById('stat-episodes'),
    statActive: document.getElementById('stat-active'),
    statUnchecked: document.getElementById('stat-unchecked')
  };

  let items = [];
  let editingId = null;
  let expandedIds = new Set();

  function isGateUnlocked() {
    return localStorage.getItem(ADMIN_UNLOCK_KEY) === '1';
  }

  function hasAdminSession() {
    try {
      const session = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || 'null');
      return session?.username === ADMIN_USERNAME;
    } catch {
      return false;
    }
  }

  function showGate() {
    elements.gateScreen.classList.remove('hidden');
    elements.gateScreen.classList.add('flex');
    elements.loginScreen.classList.add('hidden');
    elements.loginScreen.classList.remove('flex');
    elements.app.classList.add('hidden');
  }

  function showLogin() {
    elements.gateScreen.classList.add('hidden');
    elements.gateScreen.classList.remove('flex');
    elements.loginScreen.classList.remove('hidden');
    elements.loginScreen.classList.add('flex');
    elements.app.classList.add('hidden');
    setTimeout(() => elements.loginUsername.focus(), 100);
  }

  function showApp() {
    elements.gateScreen.classList.add('hidden');
    elements.gateScreen.classList.remove('flex');
    elements.loginScreen.classList.add('hidden');
    elements.loginScreen.classList.remove('flex');
    elements.app.classList.remove('hidden');
  }

  function createEpisodeRow(episode = {}) {
    const row = document.createElement('div');
    row.className = 'episode-row rounded-2xl border border-white/10 bg-black/20 p-3';

    const grid = document.createElement('div');
    grid.className = 'grid items-center gap-3 sm:grid-cols-[32px_130px_minmax(0,1fr)_120px_auto]';

    const number = document.createElement('span');
    number.className = 'episode-number flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.05] text-[11px] font-black text-white/50';
    number.textContent = String(elements.episodeEditor.children.length + 1);

    const name = document.createElement('input');
    name.className = 'episode-name input rounded-xl px-3 py-2.5 text-xs';
    name.placeholder = 'Episode 01';
    name.value = episode.epsName || '';

    const url = document.createElement('input');
    url.className = 'episode-url input rounded-xl px-3 py-2.5 text-xs';
    url.placeholder = 'URL video';
    url.value = episode.videoUrl || '';

    const status = document.createElement('select');
    status.className = 'episode-status input rounded-xl px-3 py-2.5 text-xs';
    ['Unchecked', 'Active', 'Broken'].forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      status.appendChild(option);
    });
    status.value = episode.linkStatus || 'Unchecked';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'h-10 w-10 rounded-xl border border-red-500/20 text-red-300 hover:bg-red-500/10';
    remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
    remove.title = 'Hapus episode';
    remove.onclick = () => {
      row.remove();
      if (!elements.episodeEditor.children.length) createEpisodeRow();
      renumberEpisodes();
    };

    grid.append(number, name, url, status, remove);
    row.appendChild(grid);
    elements.episodeEditor.appendChild(row);
  }

  function renumberEpisodes() {
    elements.episodeEditor.querySelectorAll('.episode-number').forEach((number, index) => {
      number.textContent = String(index + 1);
    });
  }

  function collectEpisodes() {
    return [...elements.episodeEditor.querySelectorAll('.episode-row')]
      .map(row => ({
        epsName: row.querySelector('.episode-name').value.trim(),
        videoUrl: row.querySelector('.episode-url').value.trim(),
        linkStatus: row.querySelector('.episode-status').value
      }))
      .filter(episode => episode.epsName || episode.videoUrl)
      .map((episode, index) => ({
        ...episode,
        epsName: episode.epsName || `Episode ${index + 1}`
      }));
  }

  function updatePreview() {
    const url = elements.image.value.trim();
    elements.posterWrap.classList.toggle('hidden', !url);
    if (!url) {
      elements.poster.src = '';
      return;
    }
    elements.poster.src = url;
    elements.poster.onerror = () => {
      elements.poster.src = config.defaultPoster;
    };
  }

  function resetForm() {
    elements.form.reset();
    elements.editId.value = '';
    elements.formTitle.textContent = 'Tambah Judul';
    elements.cancelEdit.classList.add('hidden');
    elements.saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Simpan Konten';
    elements.episodeEditor.innerHTML = '';
    createEpisodeRow();
    elements.genre.value = 'Drama';
    updatePreview();
  }

  function showEditor() {
    elements.form.classList.remove('hidden');
    elements.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideEditor() {
    editingId = null;
    if (elements.editorDock && !elements.editorDock.contains(elements.form)) {
      elements.editorDock.appendChild(elements.form);
    }
    resetForm();
    elements.form.classList.add('hidden');
    renderList();
  }

  function editItem(id) {
    const item = items.find(entry => String(entry.id) === String(id));
    if (!item) return;
    editingId = String(item.id);
    elements.editId.value = item.id;
    elements.title.value = item.title || '';
    elements.genre.value = Array.isArray(item.genre) ? item.genre.join(', ') : String(item.genre || 'Drama');
    elements.year.value = item.year || '';
    elements.image.value = item.image || '';
    elements.synopsis.value = item.synopsis || '';
    elements.episodeEditor.innerHTML = '';
    (Array.isArray(item.episodes) && item.episodes.length ? item.episodes : [{}]).forEach(createEpisodeRow);
    elements.formTitle.textContent = `Edit: ${item.title}`;
    elements.cancelEdit.classList.remove('hidden');
    elements.saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Simpan Perubahan';
    updatePreview();
    if (elements.editorDock) elements.editorDock.appendChild(elements.form);
    elements.form.classList.remove('hidden');
    expandedIds.add(String(item.id));
    renderList();
  }

  function renderStats() {
    const episodes = items.flatMap(item => Array.isArray(item.episodes) ? item.episodes : []);
    elements.statTitles.textContent = items.length;
    elements.statEpisodes.textContent = episodes.length;
    elements.statActive.textContent = episodes.filter(item => item.linkStatus === 'Active').length;
    elements.statUnchecked.textContent = episodes.filter(item => !item.linkStatus || item.linkStatus === 'Unchecked').length;
  }

  function getItemStatusSummary(item) {
    const episodes = Array.isArray(item.episodes) ? item.episodes : [];
    const counts = episodes.reduce((acc, episode) => {
      const status = episode.linkStatus || 'Unchecked';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { Active: 0, Broken: 0, Unchecked: 0 });

    if (counts.Broken) return { key: 'Broken', label: `${counts.Broken} Broken`, detail: `${counts.Active} aktif \u2022 ${counts.Unchecked} dicek` };
    if (counts.Unchecked && !counts.Active) return { key: 'Unchecked', label: `${counts.Unchecked} Belum Dicek`, detail: `${counts.Active} aktif \u2022 ${counts.Broken} broken` };
    if (counts.Active) return { key: 'Active', label: `${counts.Active} Aktif`, detail: `${counts.Unchecked} dicek \u2022 ${counts.Broken} broken` };
    return { key: 'Unchecked', label: 'Belum Ada Episode', detail: '0 episode' };
  }

  function createContentCard(item) {
    const card = document.createElement('article');
    const isOpen = expandedIds.has(String(item.id));
    card.className = `admin-content-card rounded-2xl p-4 ${isOpen ? 'open' : ''}`;

    const top = document.createElement('div');
    top.className = 'flex cursor-pointer items-center gap-3';
    top.addEventListener('click', () => {
      const key = String(item.id);
      if (expandedIds.has(key)) expandedIds.delete(key);
      else expandedIds.add(key);
      renderList();
    });

    const content = document.createElement('div');
    content.className = 'min-w-0 flex-1';

    const headingRow = document.createElement('div');
    headingRow.className = 'flex items-start justify-between gap-3';

    const heading = document.createElement('h3');
    heading.className = 'truncate font-bold';
    heading.textContent = item.title;

    const status = getItemStatusSummary(item);
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-pill ${status.key.toLowerCase()}`;
    statusBadge.textContent = status.label;

    const meta = document.createElement('p');
    meta.className = 'mt-1 text-xs text-white/45';
    const source = String(item.id).startsWith('local-') ? ' \u2022 Lokal' : '';
    meta.textContent = `${parseGenres(item.genre).join(', ') || 'Drama'} \u2022 ${item.year || '-'} \u2022 ${(item.episodes || []).length} episode${source}`;

    headingRow.append(heading, statusBadge);
    content.append(headingRow, meta);

    const actions = document.createElement('div');
    actions.className = 'flex shrink-0 items-center gap-2';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'rounded-lg border border-blue-500/20 bg-blue-500/[.07] px-2.5 py-1.5 text-[10px] font-bold text-blue-300 hover:bg-blue-500/10';
    edit.innerHTML = '<i class="fa-solid fa-pen mr-1.5"></i>Edit';
    edit.title = 'Edit';
    edit.onclick = event => {
      event.stopPropagation();
      editItem(item.id);
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'rounded-lg border border-red-500/20 bg-red-500/[.06] px-2.5 py-1.5 text-[10px] font-bold text-red-300 hover:bg-red-500/10';
    remove.innerHTML = '<i class="fa-solid fa-trash mr-1.5"></i>Hapus';
    remove.title = 'Hapus';
    remove.onclick = event => {
      event.stopPropagation();
      deleteItem(item);
    };

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'flex h-8 w-8 items-center justify-center rounded-lg text-xs text-white/35 hover:bg-white/[.04] hover:text-white';
    toggle.innerHTML = `<i class="fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>`;
    toggle.title = isOpen ? 'Tutup detail' : 'Buka detail';
    toggle.onclick = event => {
      event.stopPropagation();
      top.click();
    };

    actions.append(edit, remove, toggle);
    top.append(content, actions);

    const detail = document.createElement('div');
    detail.className = `${isOpen ? 'mt-4' : 'hidden mt-4'} space-y-3 border-t border-white/10 pt-4`;

    if (editingId === String(item.id)) {
      detail.append(elements.form);
    } else {
      const detailMeta = document.createElement('div');
      detailMeta.className = 'flex flex-wrap items-center gap-2 text-[11px] text-white/45';

      const episodeCount = document.createElement('span');
      episodeCount.className = 'rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 font-semibold text-white/60';
      episodeCount.textContent = `${(item.episodes || []).length} episode`;

      const detailText = document.createElement('span');
      detailText.textContent = status.detail;

      detailMeta.append(episodeCount, detailText);

      const episodes = document.createElement('div');
      episodes.className = 'space-y-2';
      if (!Array.isArray(item.episodes) || !item.episodes.length) {
        const empty = document.createElement('div');
        empty.className = 'rounded-2xl border border-dashed border-white/12 px-4 py-5 text-sm text-white/45';
        empty.textContent = 'Belum ada episode yang tersimpan.';
        episodes.appendChild(empty);
      } else {
        item.episodes.forEach((episode, index) => {
          const row = document.createElement('div');
          row.className = 'admin-episode-row rounded-2xl px-4 py-3';

          const title = document.createElement('div');
          title.className = 'flex items-center justify-between gap-3';

          const left = document.createElement('div');
          left.className = 'min-w-0';

          const epsName = document.createElement('p');
          epsName.className = 'text-sm font-bold text-white';
          epsName.textContent = episode.epsName || `Episode ${index + 1}`;

          const url = document.createElement('a');
          url.href = episode.videoUrl || '#';
          url.target = episode.videoUrl ? '_blank' : '_self';
          url.rel = 'noreferrer';
          url.className = 'mt-1 block truncate text-xs text-white/45 hover:text-pink-300';
          url.textContent = episode.videoUrl || 'URL belum diisi';

          left.append(epsName, url);

          const badge = document.createElement('span');
          badge.className = `status-pill ${(episode.linkStatus || 'Unchecked').toLowerCase()}`;
          badge.textContent = episode.linkStatus || 'Unchecked';

          title.append(left, badge);
          row.appendChild(title);
          episodes.appendChild(row);
        });
      }

      detail.append(detailMeta, episodes);
    }
    card.append(top, detail);
    return card;
  }

  function renderList() {
    const query = elements.search.value.trim().toLowerCase();
    const statusFilter = elements.statusFilter.value;
    const sortFilter = elements.sortFilter.value;

    const filtered = items.filter(item => {
      const status = getItemStatusSummary(item).key;
      const searchable = [item.title, item.genre, item.year, item.synopsis, ...(Array.isArray(item.episodes) ? item.episodes.flatMap(episode => [episode.epsName, episode.videoUrl, episode.linkStatus]) : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const statusMatch = statusFilter === 'all' || status === statusFilter;
      return statusMatch && searchable.includes(query);
    }).sort((a, b) => {
      if (sortFilter === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'id', { sensitivity: 'base' });
      }
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return sortFilter === 'oldest' ? timeA - timeB : timeB - timeA;
    });

    elements.listCount.textContent = `${filtered.length} dari ${items.length} item`;
    elements.list.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/45';
      empty.textContent = items.length ? 'Tidak ada hasil pencarian.' : 'Belum ada konten.';
      elements.list.appendChild(empty);
      return;
    }

    filtered.forEach(item => elements.list.appendChild(createContentCard(item)));
  }

  async function loadItems() {
    setConnectionBadge(elements.badge, 'loading');
    let remoteItems = [];
    let remoteError = null;

    try {
      const { data, error } = await supabase
        .from('drakor')
        .select('id,title,image,genre,year,synopsis,episodes,created_at')
        .order('created_at', { ascending: false });
      remoteError = error;
      if (!error) remoteItems = data || [];
    } catch (error) {
      remoteError = error;
    }

    items = mergeCatalogItems(remoteItems);
    if (remoteError) {
      setConnectionBadge(elements.badge, items.length ? 'local' : 'offline', items.length ? 'Data lokal' : 'Cloud bermasalah');
      if (!items.length) showToast(remoteError.message || 'Supabase tidak dapat dibaca.', 'warning');
    } else {
      setConnectionBadge(elements.badge, 'online');
    }
    renderStats();
    renderList();
  }

  async function saveItem(event) {
    event.preventDefault();
    const episodes = collectEpisodes();
    const existingId = elements.editId.value.trim();
    const existingItem = items.find(item => String(item.id) === String(existingId));
    const payload = {
      title: elements.title.value.trim(),
      genre: parseGenres(elements.genre.value).join(', ') || 'Drama',
      year: String(elements.year.value || ''),
      image: elements.image.value.trim() || null,
      synopsis: elements.synopsis.value.trim(),
      episodes,
      created_at: existingItem?.created_at || new Date().toISOString()
    };

    if (!payload.title) {
      showToast('Judul wajib diisi.', 'warning');
      return;
    }
    if (!payload.episodes.length) {
      showToast('Minimal satu episode harus diisi.', 'warning');
      return;
    }

    elements.saveButton.disabled = true;
    elements.saveButton.classList.add('opacity-60');

    let cloudError = null;
    let savedLocally = false;

    try {
      if (existingId && !existingId.startsWith('local-')) {
        const { error } = await supabase.from('drakor').update(payload).eq('id', existingId);
        cloudError = error;
        if (error) {
          setCatalogDraft(existingId, { ...payload, id: existingId });
          savedLocally = true;
        } else {
          clearCatalogDraft(existingId);
        }
      } else if (existingId) {
        setCatalogDraft(existingId, { ...payload, id: existingId });
        savedLocally = true;
      } else {
        const { data, error } = await supabase.from('drakor').insert(payload).select('id,created_at');
        cloudError = error;
        if (error || !data?.[0]?.id) {
          const localId = generateLocalId();
          setCatalogDraft(localId, { ...payload, id: localId });
          savedLocally = true;
        }
      }
    } catch (error) {
      cloudError = error;
      const draftId = existingId || generateLocalId();
      setCatalogDraft(draftId, { ...payload, id: draftId });
      savedLocally = true;
    }

    if (savedLocally) {
      showToast(`Supabase belum bisa menulis. Perubahan disimpan lokal${cloudError?.message ? `: ${cloudError.message}` : '.'}`, 'warning');
    } else {
      showToast(existingId ? 'Konten berhasil diperbarui di Supabase.' : 'Konten berhasil ditambahkan ke Supabase.', 'success');
    }

    hideEditor();
    await loadItems();
    elements.saveButton.disabled = false;
    elements.saveButton.classList.remove('opacity-60');
  }

  async function deleteItem(item) {
    if (!confirm(`Hapus "${item.title}" beserta rating dan komentarnya?`)) return;
    const id = String(item.id);

    if (id.startsWith('local-')) {
      setCatalogDraft(id, { deleted: true });
      showToast('Data lokal berhasil dihapus.', 'success');
      await loadItems();
      return;
    }

    try {
      const { error } = await supabase.from('drakor').delete().eq('id', item.id);
      if (error) {
        setCatalogDraft(id, { deleted: true });
        showToast(`Supabase belum bisa menghapus. Item disembunyikan lokal: ${error.message}`, 'warning');
      } else {
        clearCatalogDraft(id);
        showToast('Konten berhasil dihapus dari Supabase.', 'success');
      }
    } catch (error) {
      setCatalogDraft(id, { deleted: true });
      showToast(`Item disembunyikan lokal: ${error.message || 'Cloud bermasalah.'}`, 'warning');
    }
    await loadItems();
  }

  async function login(event) {
    event.preventDefault();
    const username = elements.loginUsername.value.trim().toLowerCase();
    const password = elements.loginPassword.value;
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      showToast('Username atau password admin salah.', 'error');
      return;
    }

    elements.loginButton.disabled = true;
    elements.loginButton.classList.add('opacity-60');
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
      username: ADMIN_USERNAME,
      loggedInAt: Date.now()
    }));

    try {
      await ensureViewerSession();
    } catch (error) {
      console.warn('Sesi Supabase anonymous belum aktif:', error);
    }

    showApp();
    await loadItems();
    elements.loginPassword.value = '';
    elements.loginButton.disabled = false;
    elements.loginButton.classList.remove('opacity-60');
  }

  async function logout() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem(ADMIN_UNLOCK_KEY);
    try {
      await supabase.auth.signOut();
    } catch {
      // The local admin session is already cleared.
    }
    window.location.replace('./index.html');
  }

  async function initialize() {
    createEpisodeRow();
    elements.genre.value = 'Drama';
    elements.editorDock.appendChild(elements.form);

    if (!isGateUnlocked()) {
      showGate();
      return;
    }

    if (hasAdminSession()) {
      showApp();
      try {
        await ensureViewerSession();
      } catch (error) {
        console.warn('Sesi Supabase anonymous belum aktif:', error);
      }
      await loadItems();
    } else {
      showLogin();
    }
  }

  elements.loginForm.addEventListener('submit', login);
  elements.logout.addEventListener('click', logout);
  elements.form.addEventListener('submit', saveItem);
  elements.newContent.addEventListener('click', () => {
    editingId = null;
    elements.editorDock.appendChild(elements.form);
    resetForm();
    showEditor();
  });
  elements.cancelEdit.addEventListener('click', hideEditor);
  elements.resetForm.addEventListener('click', resetForm);
  elements.addEpisode.addEventListener('click', () => createEpisodeRow());
  elements.image.addEventListener('input', updatePreview);
  elements.search.addEventListener('input', renderList);
  elements.statusFilter.addEventListener('change', renderList);
  elements.sortFilter.addEventListener('change', renderList);
  elements.expandAll.addEventListener('click', () => {
    expandedIds = new Set(items.map(item => String(item.id)));
    renderList();
  });
  elements.collapseAll.addEventListener('click', () => {
    expandedIds = new Set();
    renderList();
  });
  initialize().catch(error => {
    console.error(error);
    showToast('Admin gagal diinisialisasi.', 'error');
  });
  registerServiceWorker();
})();
