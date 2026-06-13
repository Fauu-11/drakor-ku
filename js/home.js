(function () {
  const {
    config,
    getClient,
    parseGenres,
    safeJsonGet,
    testConnection,
    isMissingTable,
    showToast,
    mergeCatalogItems,
    registerServiceWorker
  } = window.KStream;
  const supabase = getClient();

  const elements = {
    brandLink: document.getElementById('brand-link'),
    heroImage: document.getElementById('hero-image'),
    heroTitle: document.getElementById('hero-title'),
    heroMeta: document.getElementById('hero-meta'),
    heroSynopsis: document.getElementById('hero-synopsis'),
    heroPlay: document.getElementById('hero-play'),
    heroDetail: document.getElementById('hero-detail'),
    heroDots: document.getElementById('hero-dots'),
    continueTitle: document.getElementById('continue-title'),
    continueMeta: document.getElementById('continue-meta'),
    continueProgress: document.getElementById('continue-progress'),
    continuePlay: document.getElementById('continue-play'),
    count: document.getElementById('catalog-count'),
    search: document.getElementById('search-input'),
    chips: document.getElementById('genre-chips'),
    grid: document.getElementById('catalog-grid'),
    message: document.getElementById('catalog-message'),
    messageTitle: document.getElementById('catalog-message-title'),
    messageText: document.getElementById('catalog-message-text'),
    retry: document.getElementById('retry-button'),
    modal: document.getElementById('detail-modal'),
    modalClose: document.getElementById('modal-close'),
    modalImage: document.getElementById('modal-image'),
    modalTitle: document.getElementById('modal-title'),
    modalMeta: document.getElementById('modal-meta'),
    modalRating: document.getElementById('modal-rating'),
    modalSynopsis: document.getElementById('modal-synopsis'),
    modalEpisodes: document.getElementById('modal-episodes')
  };

  let dramas = [];
  let ratingSummary = {};
  let activeGenre = 'Semua';
  let heroIndex = 0;
  let heroTimer = null;
  let adminClickCount = 0;
  let adminClickTimer = null;

  function showSkeletons() {
    elements.grid.innerHTML = '';
    for (let index = 0; index < 5; index += 1) {
      const card = document.createElement('article');
      card.className = 'panel overflow-hidden rounded-[22px] p-2';
      card.innerHTML = `
        <div class="skeleton aspect-[3/4] rounded-[18px]"></div>
        <div class="p-2 pb-3 pt-3">
          <div class="skeleton h-4 w-4/5 rounded"></div>
          <div class="skeleton mt-3 h-3 w-3/5 rounded"></div>
          <div class="skeleton mt-4 h-1.5 rounded-full"></div>
        </div>
      `;
      elements.grid.appendChild(card);
    }
  }

  function showMessage(title, text, retryVisible = true) {
    elements.messageTitle.textContent = title;
    elements.messageText.textContent = text;
    elements.retry.classList.toggle('hidden', !retryVisible);
    elements.message.classList.remove('hidden');
  }

  function hideMessage() {
    elements.message.classList.add('hidden');
  }

  function getRating(dramaId) {
    const summary = ratingSummary[String(dramaId)];
    if (!summary?.count) return { label: 'Belum dinilai', short: 'Baru' };
    return {
      label: `${Number(summary.average).toFixed(1)} dari ${summary.count} pengguna`,
      short: Number(summary.average).toFixed(1)
    };
  }

  function getFavorites() {
    return new Set(safeJsonGet('favorites', []));
  }

  function isFavorite(id) {
    return getFavorites().has(String(id));
  }

  function toggleFavorite(id) {
    const favorites = getFavorites();
    const key = String(id);
    if (favorites.has(key)) favorites.delete(key);
    else favorites.add(key);
    localStorage.setItem('kstream:favorites', JSON.stringify([...favorites]));
    renderCatalog();
  }

  function getPlaybackPositions() {
    return safeJsonGet('playback-positions', {});
  }

  function getPlaybackProgress(dramaId, episodeIndex = 0) {
    const saved = getPlaybackPositions()[`${dramaId}:${episodeIndex}`];
    if (!saved?.duration) return 0;
    return Math.max(0, Math.min(100, Math.round((saved.time / saved.duration) * 100)));
  }

  function getHistoryItem() {
    const history = safeJsonGet('history', []);
    return history.length ? history[0] : null;
  }

  function resolveContinueWatching() {
    const recent = getHistoryItem();
    if (recent) {
      const drama = dramas.find(item => String(item.id) === String(recent.dramaId));
      if (drama) {
        return {
          drama,
          episodeIndex: recent.episodeIndex || 0,
          label: recent.episode || drama.episodes[recent.episodeIndex || 0]?.epsName || 'Episode 1',
          progress: getPlaybackProgress(recent.dramaId, recent.episodeIndex || 0)
        };
      }
    }

    const fallback = dramas.find(item => Array.isArray(item.episodes) && item.episodes.length) || dramas[0];
    if (!fallback) return null;
    return {
      drama: fallback,
      episodeIndex: 0,
      label: fallback.episodes[0]?.epsName || 'Episode 1',
      progress: getPlaybackProgress(fallback.id, 0)
    };
  }

  function setAdminGate() {
    clearTimeout(adminClickTimer);
    adminClickCount += 1;
    if (adminClickCount >= 5) {
      localStorage.setItem('kstream:admin-unlocked', '1');
      window.location.href = './admin.html';
      return;
    }

    adminClickTimer = setTimeout(() => {
      adminClickCount = 0;
    }, 1800);
  }

  function renderHeroDots() {
    elements.heroDots.innerHTML = '';
    const items = dramas.slice(0, Math.min(5, dramas.length));
    items.forEach((drama, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'hero-dot';
      dot.setAttribute('aria-label', `Buka hero ${drama.title}`);
      dot.onclick = () => {
        setHero(index);
        restartHero();
      };
      elements.heroDots.appendChild(dot);
    });
    updateHeroDots();
  }

  function updateHeroDots() {
    elements.heroDots.querySelectorAll('.hero-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index === heroIndex);
    });
  }

  function setHero(index) {
    const drama = dramas[index];
    if (!drama) return;
    heroIndex = index;
    const genres = parseGenres(drama.genre);
    elements.heroImage.src = drama.image || config.defaultPoster;
    elements.heroImage.alt = drama.title;
    elements.heroImage.onerror = () => { elements.heroImage.src = config.defaultPoster; };
    elements.heroTitle.textContent = drama.title;
    elements.heroMeta.textContent = `${genres.join(' \u2022 ')} \u2022 ${drama.year || 'Tahun tidak tersedia'} \u2022 ${drama.episodes.length} episode`;
    elements.heroSynopsis.textContent = drama.synopsis || 'Sinopsis belum tersedia.';
    elements.heroPlay.href = `./player.html?id=${encodeURIComponent(drama.id)}&eps=0`;
    elements.heroDetail.onclick = () => openModal(drama.id);
    updateHeroDots();
  }

  function startHeroRotation() {
    clearInterval(heroTimer);
    if (dramas.length < 2) return;
    heroTimer = setInterval(() => {
      setHero((heroIndex + 1) % Math.min(dramas.length, 5));
    }, 6500);
  }

  function restartHero() {
    startHeroRotation();
  }

  function renderGenres() {
    const dynamic = dramas.flatMap(item => parseGenres(item.genre));
    const genres = ['Semua', ...new Set([...config.genres, ...dynamic])];
    elements.chips.innerHTML = '';
    genres.forEach(genre => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip shrink-0 rounded-full border border-white/10 bg-white/[.035] px-4 py-2 text-xs font-semibold text-white/60 transition hover:text-white';
      button.textContent = genre;
      button.classList.toggle('active', genre === activeGenre);
      button.onclick = () => {
        activeGenre = genre;
        renderGenres();
        renderCatalog();
      };
      elements.chips.appendChild(button);
    });
  }

  function createCard(drama) {
    const article = document.createElement('article');
    article.className = 'poster-card panel overflow-hidden rounded-[22px] p-2';

    const thumb = document.createElement('div');
    thumb.className = 'poster-thumb';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'absolute inset-0 z-[1] block h-full w-full';
    openButton.setAttribute('aria-label', `Buka detail ${drama.title}`);
    openButton.onclick = () => openModal(drama.id);

    const image = document.createElement('img');
    image.src = drama.image || config.defaultPoster;
    image.alt = drama.title;
    image.loading = 'lazy';
    image.onerror = () => { image.src = config.defaultPoster; };

    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 bg-gradient-to-t from-black/78 via-transparent to-transparent';

    const badge = document.createElement('span');
    badge.className = 'poster-badge';
    badge.textContent = 'Baru';

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'poster-heart';
    favorite.setAttribute('aria-label', `Simpan ${drama.title} ke favorit`);
    favorite.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(drama.id);
    };
    favorite.innerHTML = `<i class="${isFavorite(drama.id) ? 'fa-solid text-pink-400' : 'fa-regular'} fa-heart"></i>`;

    const episode = document.createElement('span');
    episode.className = 'poster-episode';
    episode.textContent = `${drama.episodes.length || 0} Eps`;

    thumb.append(image, overlay, badge, favorite, episode, openButton);

    const content = document.createElement('div');
    content.className = 'px-1 pb-2 pt-3';

    const title = document.createElement('h3');
    title.className = 'line-clamp-2 min-h-[40px] text-sm font-bold leading-5 text-white';
    title.textContent = drama.title;

    const meta = document.createElement('div');
    meta.className = 'mt-2 flex items-center justify-between gap-3 text-[11px] text-white/45';
    const genre = document.createElement('span');
    genre.className = 'truncate';
    genre.textContent = parseGenres(drama.genre).join(', ') || 'Drama';
    const year = document.createElement('span');
    year.className = 'shrink-0';
    year.textContent = drama.year || '-';
    meta.append(genre, year);

    const progress = document.createElement('div');
    progress.className = 'mt-3 poster-progress-track';
    const fill = document.createElement('div');
    fill.className = 'poster-progress-fill';
    fill.style.width = `${getPlaybackProgress(drama.id, 0)}%`;
    progress.appendChild(fill);

    content.append(title, meta, progress);
    article.append(thumb, content);
    return article;
  }

  function renderCatalog() {
    const query = elements.search.value.trim().toLowerCase();
    const filtered = dramas.filter(drama => {
      const genreMatch = activeGenre === 'Semua' || parseGenres(drama.genre).includes(activeGenre);
      const searchText = [drama.title, drama.genre, drama.year, drama.synopsis].filter(Boolean).join(' ').toLowerCase();
      return genreMatch && searchText.includes(query);
    });

    elements.count.textContent = `${filtered.length} judul`;
    elements.grid.innerHTML = '';
    if (!filtered.length) {
      showMessage('Tidak ada hasil', 'Coba kata kunci atau genre lain.', false);
      return;
    }
    hideMessage();
    filtered.forEach(drama => elements.grid.appendChild(createCard(drama)));
  }

  function renderContinueWatching() {
    const item = resolveContinueWatching();
    if (!item) {
      elements.continueTitle.textContent = 'Belum ada tontonan';
      elements.continueMeta.textContent = 'Buka salah satu episode untuk mengisi riwayat.';
      elements.continueProgress.style.width = '0%';
      elements.continuePlay.href = './index.html';
      return;
    }

    const episodeLabel = item.label || item.drama.episodes[item.episodeIndex]?.epsName || `Episode ${item.episodeIndex + 1}`;
    elements.continueTitle.textContent = `${item.drama.title} — ${episodeLabel}`;
    elements.continueMeta.textContent = `${parseGenres(item.drama.genre).join(' \u2022 ')} \u2022 ${item.drama.year || '-'} \u2022 Lanjutkan dari episode ${item.episodeIndex + 1}`;
    elements.continueProgress.style.width = `${Math.max(6, item.progress || 0)}%`;
    elements.continuePlay.href = `./player.html?id=${encodeURIComponent(item.drama.id)}&eps=${item.episodeIndex}`;
  }

  function openModal(id) {
    const drama = dramas.find(item => String(item.id) === String(id));
    if (!drama) return;
    const rating = getRating(drama.id);
    elements.modalImage.src = drama.image || config.defaultPoster;
    elements.modalImage.alt = drama.title;
    elements.modalImage.onerror = () => { elements.modalImage.src = config.defaultPoster; };
    elements.modalTitle.textContent = drama.title;
    elements.modalMeta.textContent = `${parseGenres(drama.genre).join(' \u2022 ')} \u2022 ${drama.year || '-'}`;
    elements.modalRating.textContent = `\u2605 ${rating.label}`;
    elements.modalSynopsis.textContent = drama.synopsis || 'Sinopsis belum tersedia.';
    elements.modalEpisodes.innerHTML = '';

    if (!drama.episodes.length) {
      const empty = document.createElement('span');
      empty.className = 'text-sm text-white/45';
      empty.textContent = 'Belum ada episode.';
      elements.modalEpisodes.appendChild(empty);
    } else {
      drama.episodes.forEach((episode, index) => {
        const link = document.createElement('a');
        link.href = `./player.html?id=${encodeURIComponent(drama.id)}&eps=${index}`;
        link.className = 'rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-white/70 hover:border-pink-500/30 hover:text-white';
        link.textContent = episode.epsName || `Episode ${index + 1}`;
        elements.modalEpisodes.appendChild(link);
      });
    }

    elements.modal.classList.remove('hidden');
    elements.modal.classList.add('flex');
  }

  function closeModal() {
    elements.modal.classList.add('hidden');
    elements.modal.classList.remove('flex');
  }

  async function loadRatings() {
    const localRatings = safeJsonGet('ratings', {});
    const fallback = Object.fromEntries(Object.entries(localRatings).map(([id, rating]) => [
      id,
      { average: Number(rating), count: 1 }
    ]));

    const { data, error } = await supabase.from('drakor_rating_summary').select('drakor_id,average_rating,rating_count');
    if (error) {
      if (!isMissingTable(error)) console.warn('Rating summary gagal:', error);
      return fallback;
    }

    return Object.fromEntries((data || []).map(item => [
      String(item.drakor_id),
      { average: Number(item.average_rating || 0), count: Number(item.rating_count || 0) }
    ]));
  }

  async function loadCatalog() {
    showSkeletons();
    hideMessage();

    const connection = await testConnection();
    let remoteCatalog = [];

    if (connection.ok) {
      const [{ data, error }, summaries] = await Promise.all([
        supabase.from('drakor').select('id,title,image,genre,year,synopsis,episodes,created_at').order('created_at', { ascending: false }),
        loadRatings()
      ]);

      ratingSummary = summaries;
      if (error) {
        console.warn('Katalog gagal dimuat:', error);
      } else {
        remoteCatalog = data || [];
      }
    } else {
      ratingSummary = await loadRatings();
    }

    dramas = mergeCatalogItems(remoteCatalog);

    if (!dramas.length) {
      elements.grid.innerHTML = '';
      if (!connection.ok) {
        showMessage('Supabase tidak terhubung', connection.error?.message || 'Periksa internet dan konfigurasi proyek.');
      } else {
        showMessage('Katalog masih kosong', 'Tambahkan judul melalui panel admin.', false);
      }
      return;
    }

    activeGenre = 'Semua';
    renderGenres();
    renderHeroDots();
    const featuredIndex = Math.max(0, dramas.findIndex(item => /manipulated/i.test(item.title)) || 0);
    setHero(featuredIndex >= 0 ? featuredIndex : 0);
    renderContinueWatching();
    renderCatalog();
    startHeroRotation();
  }

  elements.brandLink.addEventListener('click', event => {
    event.preventDefault();
    setAdminGate();
  });
  elements.search.addEventListener('input', renderCatalog);
  elements.retry.addEventListener('click', loadCatalog);
  elements.modalClose.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', event => {
    if (event.target === elements.modal) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });

  loadCatalog().catch(error => {
    console.error(error);
    showToast('Terjadi kesalahan saat membuka katalog.', 'error');
  });
  registerServiceWorker();
})();
