(function () {
  const {
    config, getClient, ensureViewerSession, isMissingTable, parseGenres,
    safeJsonGet, safeJsonSet, relativeTime, showToast, setConnectionBadge,
    testConnection, mergeCatalogItems, registerServiceWorker
  } = window.KStream;
  const supabase = getClient();

  const params = new URLSearchParams(location.search);
  const dramaId = params.get('id');
  const requestedEpisode = Math.max(0, Number.parseInt(params.get('eps') || '0', 10) || 0);

  const elements = {
    connectionBadge: document.getElementById('connection-badge'),
    communityBadge: document.getElementById('community-badge'),
    loading: document.getElementById('media-loading'),
    empty: document.getElementById('media-empty'),
    videoWrapper: document.getElementById('video-wrapper'),
    video: document.getElementById('video-player'),
    embedWrapper: document.getElementById('embed-wrapper'),
    embed: document.getElementById('embed-player'),
    title: document.getElementById('title'),
    episodeLabel: document.getElementById('episode-label'),
    meta: document.getElementById('meta'),
    synopsis: document.getElementById('synopsis'),
    ratingSummary: document.getElementById('rating-summary'),
    ratingStars: document.getElementById('rating-stars'),
    episodeCount: document.getElementById('episode-count'),
    episodeList: document.getElementById('episode-list'),
    historyList: document.getElementById('history-list'),
    commentForm: document.getElementById('comment-form'),
    commentName: document.getElementById('comment-name'),
    commentText: document.getElementById('comment-text'),
    commentSubmit: document.getElementById('comment-submit'),
    commentList: document.getElementById('comment-list'),
    nextButton: document.getElementById('next-button'),
    shareButton: document.getElementById('share-button'),
    theaterButton: document.getElementById('theater-button'),
    watchLayout: document.getElementById('watch-layout'),
    clearHistory: document.getElementById('clear-history')
  };

  let drama = null;
  let episodeIndex = requestedEpisode;
  let communityCloudReady = true;
  let lastPositionWrite = 0;
  let ratingsLoaded = false;
  let commentsLoadSeq = 0;
  let embedFallbackTimer = null;

  function setLoading(active) {
    elements.loading.classList.toggle('hidden', !active);
    elements.loading.classList.toggle('flex', active);
    elements.videoWrapper.setAttribute('aria-busy', String(active));
  }

  function setSelectedRating(value) {
    elements.ratingStars.querySelectorAll('[data-rating]').forEach(button => {
      const rating = Number(button.dataset.rating);
      button.classList.toggle('active', rating <= value);
      button.setAttribute('aria-pressed', String(rating === value));
    });
  }

  function setCommunityMode(cloud, detail = '') {
    communityCloudReady = cloud;
    setConnectionBadge(elements.communityBadge, cloud ? 'online' : 'local', detail || (cloud ? 'Komunitas cloud' : 'Komunitas lokal'));
  }

  function runWhenIdle(callback, timeout = 900) {
    if ('requestIdleCallback' in window) requestIdleCallback(callback, { timeout });
    else setTimeout(callback, Math.min(timeout, 900));
  }

  function setMediaMessage(title, detail, type = 'info') {
    elements.videoWrapper.classList.add('hidden');
    elements.embedWrapper.classList.add('hidden');
    elements.empty.classList.remove('hidden');
    elements.empty.classList.add('flex');
    elements.empty.querySelector('h2').textContent = title;
    elements.empty.querySelector('p').textContent = detail;
    setLoading(false);
    if (type !== 'info') showToast(title, type);
  }

  function setMeta(name, content, property = false) {
    if (!content) return;
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let tag = document.head.querySelector(selector);
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute(property ? 'property' : 'name', name);
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', content);
  }

  function updateSeoMetadata() {
    const episode = drama.episodes[episodeIndex];
    const episodeName = episode?.epsName || `Episode ${episodeIndex + 1}`;
    const title = `${drama.title} - ${episodeName} | K STREAM`;
    const description = `${drama.title} ${episodeName}. ${drama.synopsis || 'Tonton episode pilihan di K STREAM.'}`.replace(/\s+/g, ' ').slice(0, 155);
    let image = drama.image || config.defaultPoster;
    try {
      image = new URL(image, location.href).href;
    } catch {
      image = new URL(config.defaultPoster, location.href).href;
    }

    document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:image', image, true);
    setMeta('og:url', location.href, true);
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);
  }

  function episodePositionKey() {
    return `${drama?.id}:${episodeIndex}`;
  }

  function getPositions() {
    return safeJsonGet('playback-positions', {});
  }

  function readLocalJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function savePosition() {
    const video = elements.video;
    if (!drama || !Number.isFinite(video.currentTime) || video.currentTime < 3) return;
    const positions = getPositions();
    const position = {
      time: Math.floor(video.currentTime),
      duration: Math.floor(video.duration || 0),
      updatedAt: Date.now()
    };
    positions[episodePositionKey()] = position;
    safeJsonSet('playback-positions', positions);

    const legacyProgress = readLocalJson('kstream_progress', {});
    legacyProgress[String(drama.id)] = {
      ...(legacyProgress[String(drama.id)] || {}),
      [episodeIndex]: position
    };
    writeLocalJson('kstream_progress', legacyProgress);
  }

  function savePositionThrottled() {
    if (Date.now() - lastPositionWrite < 8000) return;
    lastPositionWrite = Date.now();
    savePosition();
  }

  function restorePosition() {
    const saved = getPositions()[episodePositionKey()];
    const duration = elements.video.duration;
    if (!saved || saved.time < 5 || !duration || saved.time >= duration - 15) return;
    elements.video.currentTime = saved.time;
    showToast(`Melanjutkan dari menit ${Math.floor(saved.time / 60)}.`, 'info');
  }

  async function resetMediaSource() {
    clearTimeout(embedFallbackTimer);
    elements.video.pause();
    elements.video.removeAttribute('src');
    elements.video.removeAttribute('poster');
    elements.video.load();
  }

  function youtubeEmbed(url) {
    const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&#/]+)/);
    return match ? `https://www.youtube.com/embed/${encodeURIComponent(match[1])}?autoplay=1` : url;
  }

  async function loadMedia() {
    const episode = drama.episodes[episodeIndex];
    const url = String(episode?.videoUrl || '').trim();
    setLoading(true);
    await resetMediaSource();
    elements.empty.classList.add('hidden');
    elements.empty.classList.remove('flex');
    elements.embed.src = '';
    elements.embedWrapper.classList.add('hidden');
    elements.videoWrapper.classList.remove('hidden');
    elements.video.poster = drama.image || config.defaultPoster;

    if (!url) {
      setMediaMessage('URL episode kosong', 'Tambahkan URL video melalui panel admin.', 'warning');
      return;
    }

    try {
      if (/abyssplayer/i.test(url)) {
        elements.videoWrapper.classList.add('hidden');
        elements.embedWrapper.classList.remove('hidden');
        elements.embed.onload = () => {
          clearTimeout(embedFallbackTimer);
          setLoading(false);
        };
        elements.embed.onerror = () => setMediaMessage('Embed gagal dimuat', 'Server embed tidak merespons. Coba muat ulang atau periksa URL episode.', 'error');
        elements.embed.src = url;
        embedFallbackTimer = setTimeout(() => {
          setMediaMessage('Embed gagal dimuat', 'Server embed terlalu lama merespons. Coba muat ulang atau periksa URL episode.', 'warning');
        }, 10000);
      } else if (/\/embed\/|kisskh/i.test(url)) {
        setMediaMessage('Format stream tidak didukung', 'Gunakan URL MP4, Abyssplayer, atau YouTube agar pemutar tetap aman dan stabil.', 'warning');
      } else if (/youtu\.be|youtube\.com/i.test(url)) {
        elements.videoWrapper.classList.add('hidden');
        elements.embedWrapper.classList.remove('hidden');
        elements.embed.onload = () => setLoading(false);
        elements.embed.onerror = () => setMediaMessage('Embed gagal dimuat', 'YouTube embed tidak merespons. Periksa URL episode.', 'error');
        elements.embed.src = youtubeEmbed(url);
        embedFallbackTimer = setTimeout(() => setLoading(false), 5000);
      } else if (/\.(?:mpd|m3u8)(?:$|[?#])/i.test(url)) {
        setMediaMessage('Format stream tidak didukung', 'HLS/DASH dinonaktifkan agar player tetap ringan. Pakai MP4, Abyssplayer, atau YouTube.', 'warning');
      } else {
        elements.video.src = url;
        elements.video.load();
        elements.video.play().catch(() => {});
      }
    } catch (error) {
      console.error(error);
      const code = error?.code ? ` (kode ${error.code})` : '';
      setMediaMessage('Sumber video gagal dimuat', `Periksa URL episode${code}.`, 'error');
    }
  }

  function updateMetadata() {
    const episode = drama.episodes[episodeIndex];
    elements.title.textContent = drama.title;
    elements.episodeLabel.textContent = episode?.epsName || `Episode ${episodeIndex + 1}`;
    elements.meta.textContent = `${parseGenres(drama.genre).join(' \u2022 ')} \u2022 ${drama.year || '-'}`;
    elements.synopsis.textContent = drama.synopsis || 'Sinopsis belum tersedia.';
    updateSeoMetadata();
    elements.nextButton.classList.toggle('hidden', !drama.episodes[episodeIndex + 1]);
    elements.nextButton.onclick = () => selectEpisode(episodeIndex + 1);
  }

  function renderEpisodes() {
    elements.episodeList.innerHTML = '';
    elements.episodeCount.textContent = `${drama.episodes.length} episode`;
    drama.episodes.forEach((episode, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = index === episodeIndex
        ? 'min-h-11 rounded-xl border border-pink-500/60 bg-pink-500/15 px-3 py-3 text-xs font-bold text-pink-200'
        : 'min-h-11 rounded-xl border border-white/10 bg-white/[.025] px-3 py-3 text-xs font-semibold text-white/75 hover:border-pink-500/25 hover:text-white';
      button.textContent = episode.epsName || `Episode ${index + 1}`;
      if (index === episodeIndex) button.setAttribute('aria-current', 'true');
      button.onclick = () => selectEpisode(index);
      elements.episodeList.appendChild(button);
    });
  }

  async function selectEpisode(index) {
    if (!drama.episodes[index]) return;
    savePosition();
    episodeIndex = index;
    const url = new URL(location.href);
    url.searchParams.set('eps', String(index));
    history.replaceState(null, '', url);
    updateMetadata();
    renderEpisodes();
    addHistory();
    renderHistory();
    await loadMedia();
    loadCommunityLater({ commentsOnly: true });
  }

  function addHistory() {
    const episode = drama.episodes[episodeIndex];
    const episodeName = episode?.epsName || `Episode ${episodeIndex + 1}`;
    const watchedAt = Date.now();
    const current = safeJsonGet('history', []);
    const next = current.filter(item => !(String(item.dramaId) === String(drama.id) && item.episodeIndex === episodeIndex));
    next.unshift({
      dramaId: drama.id,
      episodeIndex,
      title: drama.title,
      episode: episodeName,
      year: drama.year || '',
      watchedAt
    });
    safeJsonSet('history', next.slice(0, 20));

    const legacyItem = {
      cloudId: drama.id,
      epsIdx: episodeIndex,
      title: drama.title,
      episode: episodeName,
      label: `${drama.title} - ${episodeName}`,
      progress: 0,
      watchedAt
    };
    const legacyHistory = readLocalJson('kstream_watch_history', [])
      .filter(item => !(String(item.cloudId) === String(drama.id) && Number(item.epsIdx || 0) === episodeIndex));
    legacyHistory.unshift(legacyItem);
    writeLocalJson('kstream_watch_history', legacyHistory.slice(0, 30));
    writeLocalJson('lastWatched', legacyItem);
  }

  function renderHistory() {
    const historyItems = safeJsonGet('history', []);
    elements.historyList.innerHTML = '';
    if (!historyItems.length) {
      const empty = document.createElement('p');
      empty.className = 'p-5 text-xs text-white/70';
      empty.textContent = 'Belum ada riwayat tontonan.';
      elements.historyList.appendChild(empty);
      return;
    }

    historyItems.forEach(item => {
      const link = document.createElement('a');
      link.href = `./player.html?id=${encodeURIComponent(item.dramaId)}&eps=${item.episodeIndex}`;
      link.className = 'block border-b border-white/[.07] px-5 py-4 transition hover:bg-pink-500/[.05]';
      const title = document.createElement('p');
      title.className = 'text-xs font-semibold leading-5 text-white/75';
      title.textContent = `${item.title} — ${item.episode}`;
      const time = document.createElement('p');
      time.className = 'mt-1 text-[10px] italic text-white/70';
      time.textContent = relativeTime(item.watchedAt);
      link.append(title, time);
      elements.historyList.appendChild(link);
    });
  }

  async function loadRatings() {
    const localRatings = {
      ...readLocalJson('kstream_user_ratings', {}),
      ...safeJsonGet('ratings', {})
    };
    setSelectedRating(Number(localRatings[drama.id] || 0));

    const { data, error } = await supabase
      .from('drakor_ratings')
      .select('rating,user_id')
      .eq('drakor_id', drama.id);

    if (error) {
      setCommunityMode(false, isMissingTable(error) ? 'SQL komunitas belum dipasang' : 'Rating lokal');
      const local = Number(localRatings[drama.id] || 0);
      elements.ratingSummary.textContent = local ? `Rating Anda: ${local}/5 (tersimpan lokal)` : 'Belum ada rating. Tersimpan lokal hingga SQL komunitas dipasang.';
      return;
    }

    setCommunityMode(true);
    const ratings = data || [];
    const average = ratings.length ? ratings.reduce((sum, item) => sum + Number(item.rating), 0) / ratings.length : 0;
    elements.ratingSummary.textContent = ratings.length ? `Rata-rata ${average.toFixed(1)} dari ${ratings.length} pengguna.` : 'Belum ada rating pengguna.';

    try {
      const session = await ensureViewerSession();
      const own = ratings.find(item => item.user_id === session?.user?.id);
      if (own) setSelectedRating(Number(own.rating));
    } catch {
      // Anonymous sign-in can be disabled before database/setup.sql is completed.
    }
  }

  async function submitRating(value) {
    const localRatings = safeJsonGet('ratings', {});
    localRatings[drama.id] = value;
    safeJsonSet('ratings', localRatings);
    const legacyRatings = readLocalJson('kstream_user_ratings', {});
    legacyRatings[drama.id] = value;
    writeLocalJson('kstream_user_ratings', legacyRatings);
    setSelectedRating(value);

    try {
      const session = await ensureViewerSession();
      const { error } = await supabase.from('drakor_ratings').upsert({
        drakor_id: drama.id,
        user_id: session.user.id,
        rating: value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'drakor_id,user_id' });
      if (error) throw error;
      setCommunityMode(true);
      showToast('Rating tersimpan di Supabase.', 'success');
      await loadRatings();
    } catch (error) {
      console.warn(error);
      setCommunityMode(false, isMissingTable(error) ? 'SQL komunitas belum dipasang' : 'Rating lokal');
      elements.ratingSummary.textContent = `Rating Anda: ${value}/5 (tersimpan lokal).`;
      showToast('Rating disimpan di perangkat ini.', 'warning');
    }
  }

  function localCommentKey() {
    return `comments:${drama.id}`;
  }

  function renderComments(comments) {
    elements.commentList.innerHTML = '';
    if (!comments.length) {
      const empty = document.createElement('p');
      empty.className = 'rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/70';
      empty.textContent = 'Belum ada komentar. Jadilah yang pertama.';
      elements.commentList.appendChild(empty);
      return;
    }

    comments.forEach(comment => {
      const article = document.createElement('article');
      article.className = 'rounded-2xl border border-white/10 bg-black/20 p-4';
      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-center justify-between gap-2';
      const name = document.createElement('strong');
      name.className = 'text-xs text-pink-300';
      name.textContent = comment.name || 'Pengguna';
      const time = document.createElement('span');
      time.className = 'text-[10px] text-white/70';
      time.textContent = relativeTime(comment.created_at);
      const text = document.createElement('p');
      text.className = 'mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-white/65';
      text.textContent = comment.comment;
      header.append(name, time);
      article.append(header, text);
      elements.commentList.appendChild(article);
    });
  }

  async function loadComments() {
    const seq = ++commentsLoadSeq;
    const local = safeJsonGet(localCommentKey(), []);
    const { data, error } = await supabase
      .from('drakor_comments')
      .select('id,name,comment,episode_index,created_at')
      .eq('drakor_id', drama.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (seq !== commentsLoadSeq) return;
      setCommunityMode(false, isMissingTable(error) ? 'SQL komunitas belum dipasang' : 'Komentar lokal');
      renderComments(local);
      return;
    }

    if (seq !== commentsLoadSeq) return;
    setCommunityMode(true);
    renderComments([...(data || []), ...local].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  }

  function loadCommunityLater({ commentsOnly = false } = {}) {
    runWhenIdle(async () => {
      const tasks = [loadComments()];
      if (!commentsOnly && !ratingsLoaded) {
        ratingsLoaded = true;
        tasks.push(loadRatings());
      }
      await Promise.allSettled(tasks);
    }, 1200);
  }

  async function submitComment(event) {
    event.preventDefault();
    const name = elements.commentName.value.trim();
    const comment = elements.commentText.value.trim();
    if (!name || !comment) return;

    elements.commentSubmit.disabled = true;
    elements.commentSubmit.classList.add('opacity-60');
    const payload = {
      drakor_id: drama.id,
      episode_index: episodeIndex,
      name,
      comment,
      status: 'published'
    };

    try {
      const session = await ensureViewerSession();
      const { error } = await supabase.from('drakor_comments').insert({ ...payload, user_id: session.user.id });
      if (error) throw error;
      setCommunityMode(true);
      showToast('Komentar tersimpan di Supabase.', 'success');
      elements.commentText.value = '';
      localStorage.setItem('kstream:comment-name', name);
      await loadComments();
    } catch (error) {
      console.warn(error);
      const comments = safeJsonGet(localCommentKey(), []);
      comments.unshift({ ...payload, created_at: new Date().toISOString(), id: `local-${Date.now()}` });
      safeJsonSet(localCommentKey(), comments.slice(0, 50));
      setCommunityMode(false, isMissingTable(error) ? 'SQL komunitas belum dipasang' : 'Komentar lokal');
      showToast('Komentar disimpan di perangkat ini.', 'warning');
      elements.commentText.value = '';
      localStorage.setItem('kstream:comment-name', name);
      renderComments(comments);
    } finally {
      elements.commentSubmit.disabled = false;
      elements.commentSubmit.classList.remove('opacity-60');
    }
  }

  async function share() {
    const data = {
      title: `${drama.title} — ${drama.episodes[episodeIndex]?.epsName || ''}`,
      text: `Tonton ${drama.title} di K-STREAM`,
      url: location.href
    };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        showToast('Link disalin.', 'success');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Link gagal dibagikan.', 'error');
    }
  }

  async function initialize() {
    if (!dramaId) {
      location.replace('./index.html');
      return;
    }

    setConnectionBadge(elements.connectionBadge, 'loading');
    elements.video.controls = true;

    elements.video.addEventListener('waiting', () => setLoading(true));
    elements.video.addEventListener('playing', () => setLoading(false));
    elements.video.addEventListener('canplay', () => setLoading(false));
    elements.video.addEventListener('error', () => setMediaMessage('Sumber video gagal dimuat', 'Browser tidak dapat memutar URL video ini. Periksa format dan izin akses file.', 'error'));
    elements.video.addEventListener('loadedmetadata', restorePosition);
    elements.video.addEventListener('timeupdate', savePositionThrottled);
    elements.video.addEventListener('ended', () => {
      if (drama.episodes[episodeIndex + 1]) selectEpisode(episodeIndex + 1);
    });

    const connection = await testConnection();
    let remoteData = null;
    let remoteError = connection.error || null;

    if (connection.ok && !String(dramaId).startsWith('local-')) {
      const { data, error } = await supabase.from('drakor').select('*').eq('id', dramaId).maybeSingle();
      remoteData = data;
      remoteError = error;
    }

    drama = mergeCatalogItems(remoteData ? [remoteData] : [])
      .find(item => String(item.id) === String(dramaId));

    if (!drama) {
      setConnectionBadge(elements.connectionBadge, connection.ok ? 'offline' : 'local', connection.ok ? 'Judul tidak ditemukan' : 'Data lokal');
      setLoading(false);
      setMediaMessage(connection.ok ? 'Judul tidak ditemukan' : 'Koneksi Supabase gagal, memakai data lokal', remoteError?.message || 'Data judul tidak ditemukan di katalog lokal maupun cloud.', 'warning');
      showToast(remoteError?.message || 'Judul tidak ditemukan.', 'error');
      return;
    }

    if (!drama.episodes.length) drama.episodes = [{ epsName: 'Episode 01', videoUrl: '', linkStatus: 'Unchecked' }];
    episodeIndex = Math.min(requestedEpisode, drama.episodes.length - 1);
    setConnectionBadge(elements.connectionBadge, remoteData ? 'online' : 'local', remoteData ? '' : 'Data lokal');
    elements.commentName.value = localStorage.getItem('kstream:comment-name') || '';
    updateMetadata();
    renderEpisodes();
    addHistory();
    renderHistory();
    await loadMedia();
    loadCommunityLater();
  }

  elements.ratingStars.addEventListener('click', event => {
    const button = event.target.closest('[data-rating]');
    if (button) submitRating(Number(button.dataset.rating));
  });
  elements.commentForm.addEventListener('submit', submitComment);
  elements.shareButton.addEventListener('click', share);
  elements.clearHistory.addEventListener('click', () => {
    safeJsonSet('history', []);
    writeLocalJson('kstream_watch_history', []);
    localStorage.removeItem('lastWatched');
    renderHistory();
    showToast('Riwayat dihapus.', 'success');
  });
  elements.theaterButton.addEventListener('click', () => {
    elements.watchLayout.classList.toggle('lg:grid-cols-[minmax(0,1fr)_360px]');
    elements.watchLayout.classList.toggle('lg:grid-cols-1');
    const icon = elements.theaterButton.querySelector('i');
    const theaterActive = elements.watchLayout.classList.contains('lg:grid-cols-1');
    icon.className = theaterActive ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    elements.theaterButton.setAttribute(
      'aria-label',
      theaterActive ? 'Keluar dari mode bioskop' : 'Aktifkan mode bioskop'
    );
  });
  window.addEventListener('beforeunload', savePosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition();
  });

  initialize().catch(error => {
    console.error(error);
    setLoading(false);
    showToast('Player gagal diinisialisasi.', 'error');
  });
  registerServiceWorker();
})();
