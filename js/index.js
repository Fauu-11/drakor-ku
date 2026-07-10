const SUPABASE_URL = window.KSTREAM_CONFIG.supabaseUrl;
const SUPABASE_KEY = window.KSTREAM_CONFIG.supabaseAnonKey;
const PLAYER_URL = "./player.html";
const ADMIN_URL = "./admin.html";
const SUPABASE_REST_URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

function createRestUrl(table, query = {}) {
  const url = new URL(`${SUPABASE_REST_URL}/${table}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function restSelect(table, query = {}) {
  const response = await fetch(createRestUrl(table, query), {
    headers: {
      apikey: SUPABASE_KEY,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const error = new Error(`Supabase REST gagal (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function safeJsonGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function getStoredEpisodeProgress() {
  const merged = safeJsonGet("kstream_progress", {});
  const playerPositions = safeJsonGet("kstream:playback-positions", {});
  Object.entries(playerPositions).forEach(([key, value]) => {
    const [cloudId, epsIdx] = key.split(":");
    if (!cloudId || epsIdx === undefined) return;
    merged[String(cloudId)] = {
      ...(merged[String(cloudId)] || {}),
      [Number(epsIdx) || 0]: value,
    };
  });
  return merged;
}
let drakorDB = [];
let watchlist = safeJsonGet("kstream_watchlist", []);
let episodeProgress = getStoredEpisodeProgress();
let watchHistory = safeJsonGet("kstream_watch_history", []);
let currentGenreFilter = "All";
let heroFeatured = [];
let heroCurrentIdx = 0;
let heroInterval = null;
let currentModalDramaId = null;
let currentDetailDramaId = null;
let logoClicks = 0;
let logoClickTimeout;
let searchTimer = null;
let mobileSearchTimer = null;
let lastFocusedElement = null;
let currentView = "home";
const gridContainer = document.getElementById("drakor-container");
const CATALOG_FIELDS = "id,title,image,genre,year,synopsis,episodes,created_at";
const CATALOG_CACHE_KEY = "kstream_catalog_cache_v1";
const HERO_IMAGE_SIZES = "100vw";
const POSTER_IMAGE_SIZES =
  "(min-width: 1280px) 18vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw";
const DEFAULT_POSTER =
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=480&q=70";
const EMPTY_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const GENRE_OPTIONS = [
  { value: "All", label: "Semua" },
  { value: "Drama", label: "Drama" },
  { value: "Movie", label: "Film" },
  { value: "Series", label: "Serial" },
  { value: "Romance", label: "Romance" },
  { value: "Action", label: "Action" },
  { value: "Thriller", label: "Thriller" },
  { value: "Comedy", label: "Comedy" },
  { value: "Fantasy", label: "Fantasy" },
  { value: "Mystery", label: "Mystery" },
  { value: "Crime", label: "Crime" },
  { value: "Horror", label: "Horror" },
  { value: "Historical", label: "Historical" },
  { value: "Medical", label: "Medical" },
  { value: "School", label: "School" },
  { value: "Family", label: "Family" },
  { value: "Slice of Life", label: "Slice of Life" },
  { value: "Sci-Fi", label: "Sci-Fi" },
  { value: "Supernatural", label: "Supernatural" },
  { value: "Legal", label: "Legal" },
  { value: "Political", label: "Political" },
  { value: "Youth", label: "Youth" },
  { value: "Melodrama", label: "Melodrama" },
];
const DOM = {
  mainContent: document.getElementById("main-content"),
  hero: document.getElementById("hero-banner"),
  mobileSearch: document.getElementById("mobile-search-panel"),
  historySection: document.getElementById("history-section"),
  watchlistSection: document.getElementById("watchlist-section"),
  catalog: document.getElementById("catalog"),
  historyContainer: document.getElementById("history-container"),
  watchlistContainer: document.getElementById("watchlist-container"),
  catalogCount: document.getElementById("catalog-count"),
  historyCountBadge: document.getElementById("history-count-badge"),
  watchlistCount: document.getElementById("watchlist-count"),
};
function shortenSynopsis(text, maxSentences = 3) {
  const cleanText = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText) return "Tidak ada deskripsi.";
  const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentences || sentences.length <= maxSentences) return cleanText;
  return sentences.slice(0, maxSentences).join(" ").trim() + " ........";
}
function escapeHTML(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}
function safeImageUrl(url, width = 640, quality = 72) {
  const value = String(url || "").trim();
  if (!value) return DEFAULT_POSTER;
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return DEFAULT_POSTER;
    if (parsed.hostname === "images.unsplash.com") {
      parsed.searchParams.set("auto", "format");
      if (!parsed.searchParams.has("fit")) parsed.searchParams.set("fit", "crop");
      parsed.searchParams.set("w", String(width));
      parsed.searchParams.set("q", String(quality));
    }
    if (/^i\d+\.wp\.com$/i.test(parsed.hostname)) {
      parsed.searchParams.set("w", String(width));
      parsed.searchParams.set("quality", String(quality));
      parsed.searchParams.set("strip", "all");
    }
    return parsed.href;
  } catch {
    return DEFAULT_POSTER;
  }
}
function lockBodyScroll() {
  document.body.style.overflow = "hidden";
}
function unlockBodyScroll() {
  document.body.style.overflow = "";
}
function runWhenIdle(callback) {
  if ("requestIdleCallback" in window)
    requestIdleCallback(callback, { timeout: 1200 });
  else setTimeout(callback, 200);
}
function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("hiding");
    setTimeout(() => toast.remove(), 260);
  }, duration);
}
function handleAdminEasterEgg(event) {
  event.preventDefault();
  logoClicks++;
  if (logoClicks < 5) switchView("home");
  clearTimeout(logoClickTimeout);
  logoClickTimeout = setTimeout(() => {
    logoClicks = 0;
  }, 2500);
  if (logoClicks === 5) {
    logoClicks = 0;
    showToast("Mengakses Owner Portal...", "info", 1000);
    setTimeout(() => {
      window.location.href = ADMIN_URL;
    }, 1000);
  }
}
function setActiveNav(view) {
  ["home", "search", "history", "watchlist"].forEach((v) => {
    const mobileBtn = document.getElementById("bnav-" + v);
    if (mobileBtn) {
      const active = v === view;
      mobileBtn.classList.toggle("active", active);
      if (active) mobileBtn.setAttribute("aria-current", "page");
      else mobileBtn.removeAttribute("aria-current");
    }
  });
}
function isMobileViewport() {
  return window.matchMedia("(max-width: 767px)").matches;
}
function switchView(view) {
  const mobileViewport = isMobileViewport();
  currentView = view;
  setActiveNav(view);
  DOM.mobileSearch.classList.add("hidden");
  DOM.mainContent.style.display = "";
  DOM.hero.style.display = "";
  DOM.catalog.style.display = "";
  DOM.historySection.style.display = mobileViewport ? "none" : "block";
  DOM.watchlistSection.style.display = mobileViewport ? "none" : "block";
  if (view !== "search") unlockBodyScroll();
  if (!mobileViewport) {
    displayCatalog();
    displayWatchHistory();
    displayWatchlist();
    return;
  }
  if (view === "home") {
    displayCatalog();
    return;
  }
  if (view === "search") {
    lastFocusedElement = document.activeElement;
    DOM.mobileSearch.classList.remove("hidden");
    renderMobileSearchSuggestions();
    lockBodyScroll();
    setTimeout(() => {
      document.getElementById("mobile-search-input").focus();
    }, 100);
    return;
  }
  if (view === "history") {
    DOM.hero.style.display = "none";
    DOM.catalog.style.display = "none";
    DOM.historySection.style.display = "block";
    displayWatchHistory();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (view === "watchlist") {
    DOM.hero.style.display = "none";
    DOM.catalog.style.display = "none";
    DOM.watchlistSection.style.display = "block";
    displayWatchlist();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
function toggleMobileSearch() {
  switchView("search");
}
function triggerPlayer(id, epsIdx) {
  addWatchHistoryFromIndex(id, epsIdx, 0);
  window.location.href = `${PLAYER_URL}?id=${encodeURIComponent(id)}&eps=${epsIdx}`;
}
function showSkeletons(count = 10) {
  gridContainer.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton-card";
    skeleton.innerHTML = ` <div class="skeleton skeleton-poster"></div> <div class="skeleton skeleton-line" style="width:80%"></div> <div class="skeleton skeleton-line skeleton-line-short"></div> `;
    fragment.appendChild(skeleton);
  }
  gridContainer.appendChild(fragment);
}
function renderGenreChips() {
  const row = document.getElementById("genre-chips-row");
  if (!row) return;
  const fragment = document.createDocumentFragment();
  GENRE_OPTIONS.forEach(({ value, label }) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = label;
    chip.setAttribute(
      "aria-pressed",
      value === currentGenreFilter ? "true" : "false",
    );
    chip.className =
      value === currentGenreFilter
        ? "genre-chip min-h-11 px-4 py-2 bg-brand text-white text-xs font-bold rounded-full border border-brand transition-all shrink-0 snap-start"
        : "genre-chip min-h-11 px-4 py-2 bg-dark-surface text-neutral-300 text-xs font-semibold rounded-full border border-dark-border hover:border-brand/40 hover:text-white transition-all shrink-0 snap-start";
    chip.onclick = () => filterGenre(value);
    fragment.appendChild(chip);
  });
  row.replaceChildren(fragment);
}
function setupHero(data) {
  if (!data || data.length === 0) return;
  heroFeatured = data.slice(0, 5);
  heroCurrentIdx = 0;
  const container = document.getElementById("hero-slides-container");
  container.innerHTML = ` <div class="absolute inset-0 bg-gradient-to-r from-dark-bg via-dark-bg/70 to-transparent z-10"></div> <div class="absolute inset-0 bg-gradient-to-t from-dark-bg via-transparent to-transparent z-10"></div> `;
  heroFeatured.forEach((drama, i) => {
    const slide = document.createElement("div");
    slide.className = "hero-slide" + (i === 0 ? " active" : "");
    const title = escapeHTML(drama.title || "Tayangan K-STREAM");
    const mobileHero = isMobileViewport();
    const image = safeImageUrl(
      drama.image,
      i === 0 ? (mobileHero ? 640 : 1280) : mobileHero ? 560 : 960,
      mobileHero ? 58 : 70,
    );
    const imageSource =
      i === 0
        ? `src="${image}"`
        : `src="${EMPTY_IMAGE}" data-src="${image}"`;
    slide.innerHTML = ` <img ${imageSource} alt="Banner ${title}" class="w-full h-full object-cover opacity-30" width="1280" height="720" sizes="${HERO_IMAGE_SIZES}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async" fetchpriority="${i === 0 ? "high" : "low"}" onerror="this.onerror=null;this.src='${DEFAULT_POSTER}'" > `;
    container.appendChild(slide);
  });
  updateHeroContent(0);
  const dotsEl = document.getElementById("hero-dots");
  dotsEl.innerHTML = "";
  heroFeatured.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hero-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `Tampilkan banner ke-${i + 1}`);
    if (i === 0) dot.setAttribute("aria-current", "true");
    dot.onclick = () => goHeroSlide(i);
    dotsEl.appendChild(dot);
  });
  if (heroInterval) clearInterval(heroInterval);
  if (heroFeatured.length > 1) {
    setTimeout(() => ensureHeroSlideImage(1), 2500);
    heroInterval = setInterval(() => {
      goHeroSlide((heroCurrentIdx + 1) % heroFeatured.length);
    }, 5000);
  }
}
function updateHeroContent(idx) {
  const drama = heroFeatured[idx];
  if (!drama) return;
  document.getElementById("hero-title").textContent =
    drama.title || "Tayangan K-STREAM";
  document.getElementById("hero-meta").textContent =
    `${drama.genre || "K-Drama"} • ${drama.year || "2026"} • ⭐ ${getUserRatingLabel(drama)}`;
  document.getElementById("hero-synopsis").textContent = shortenSynopsis(
    drama.synopsis,
    2,
  );
}
function ensureHeroSlideImage(idx) {
  const image = document.querySelectorAll(".hero-slide img")[idx];
  if (!image?.dataset.src) return;
  image.src = image.dataset.src;
  delete image.dataset.src;
}
function goHeroSlide(idx) {
  ensureHeroSlideImage(idx);
  const slides = document.querySelectorAll(".hero-slide");
  const dots = document.querySelectorAll(".hero-dot");
  slides.forEach((slide, i) =>
    slide.classList.toggle("active", i === idx),
  );
  dots.forEach((dot, i) => {
    const active = i === idx;
    dot.classList.toggle("active", active);
    if (active) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
  heroCurrentIdx = idx;
  updateHeroContent(idx);
  if (heroFeatured.length > 1) {
    const nextIdx = (idx + 1) % heroFeatured.length;
    setTimeout(() => ensureHeroSlideImage(nextIdx), 1200);
  }
}
function heroPlay() {
  const drama = heroFeatured[heroCurrentIdx];
  if (drama && drama.episodes && drama.episodes.length > 0) {
    triggerPlayer(drama.id, 0);
  } else {
    showToast("Episode belum tersedia.", "warning");
  }
}
function heroInfo() {
  const drama = heroFeatured[heroCurrentIdx];
  if (drama) openDetailPage(drama.id);
}
function getSearchText(drama) {
  return [drama.title, drama.genre, drama.year, drama.synopsis]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
function getUserRatingLabel(drama) {
  const average = Number(drama._userRatingAverage || 0);
  return average > 0 ? average.toFixed(1) : "Baru";
}
function getNextPlayableIndex(drama) {
  if (!drama || !drama.episodes || drama.episodes.length === 0) return 0;
  const nextIdx = drama.episodes.findIndex(
    (_, idx) =>
      !(episodeProgress[drama.id] && episodeProgress[drama.id][idx]),
  );
  return nextIdx >= 0 ? nextIdx : 0;
}
function buildCardHtml(drama) {
  const titleRaw = String(drama.title || "Tanpa Judul");
  const title = escapeHTML(titleRaw);
  const genre = escapeHTML(drama.genre || "K-Drama");
  const year = escapeHTML(drama.year || "2026");
  const image = safeImageUrl(drama.image, 360, 72);
  const isFav = watchlist.includes(titleRaw);
  const favIcon = isFav
    ? "fa-solid fa-heart text-brand"
    : "fa-regular fa-heart text-neutral-400";
  const epsLength = drama.episodes ? drama.episodes.length : 0;
  const watched = episodeProgress[drama.id]
    ? Object.keys(episodeProgress[drama.id]).length
    : 0;
  const progressPct =
    epsLength > 0 ? Math.round((watched / epsLength) * 100) : 0;
  const playIdx = getNextPlayableIndex(drama);
  const dramaId = JSON.stringify(String(drama.id));
  const dramaTitle = JSON.stringify(titleRaw);
  return ` <div class="poster-shell w-full aspect-[3/4] overflow-hidden bg-neutral-900 rounded-xl group"> <button type="button" class="block w-full h-full" onclick='openPreviewModal(${dramaId})' aria-label="Buka preview ${title}"> <img src="${image}" alt="" class="w-full h-full object-cover" width="300" height="400" sizes="${POSTER_IMAGE_SIZES}" loading="lazy" decoding="async" fetchpriority="low" onerror="this.onerror=null;this.src='${DEFAULT_POSTER}'" > </button> <div class="poster-actions"> <button type="button" onclick='event.stopPropagation(); triggerPlayer(${dramaId}, ${playIdx})' class="poster-action-btn primary" aria-label="Putar ${title}"> <i class="fa-solid fa-play" aria-hidden="true"></i> Putar </button> <button type="button" onclick='event.stopPropagation(); openDetailPage(${dramaId})' class="poster-action-btn" aria-label="Lihat detail ${title}"> <i class="fa-solid fa-circle-info" aria-hidden="true"></i> </button> </div> <button type="button" onclick='toggleWatchlist(event, ${dramaTitle})' class="absolute top-2.5 right-2.5 w-11 h-11 rounded-xl bg-dark-bg/80 border border-dark-border flex items-center justify-center text-xs z-30" aria-label="${isFav ? "Hapus dari watchlist" : "Tambahkan ke watchlist"}: ${title}" > <i class="${favIcon}" aria-hidden="true"></i> </button> <span class="absolute bottom-2.5 left-2.5 bg-dark-bg/80 border text-[10px] font-bold text-brand px-2 py-1 rounded z-10">${epsLength} Eps</span> <span class="absolute top-2.5 left-2.5 bg-dark-bg/80 border text-[10px] font-bold text-yellow-500 px-2 py-1 rounded z-10">⭐${getUserRatingLabel(drama)}</span> </div> <div class="p-2"> <button type="button" class="min-h-11 flex items-center text-left w-full text-xs md:text-sm font-semibold truncate text-white" onclick='openPreviewModal(${dramaId})'> ${title} </button> <div class="flex items-center justify-between mt-0.5 text-[10px] text-dark-muted"> <span class="truncate">${genre}</span> <span>${year}</span> </div> <div class="eps-progress-bar mt-1" role="progressbar" aria-label="Progress tontonan ${title}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}"> <div class="eps-progress-fill" style="width:${progressPct}%"></div> </div> </div> `;
}
function renderCards(target, items, wrapperClass) {
  if (!target) return;
  if (!items || items.length === 0) {
    target.innerHTML = ` <div class="col-span-full text-center text-xs text-dark-muted border border-dark-border rounded-2xl py-8 bg-dark-surface/60"> <i class="fa-solid fa-magnifying-glass mb-2 block text-lg text-brand" aria-hidden="true"></i> Tidak ada tayangan yang cocok. </div> `;
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((drama) => {
    const card = document.createElement("article");
    card.className = wrapperClass;
    card.setAttribute("aria-label", drama.title || "Tayangan K-STREAM");
    card.innerHTML = buildCardHtml(drama);
    fragment.appendChild(card);
  });
  requestAnimationFrame(() => {
    target.replaceChildren(fragment);
  });
}
function displayCatalog() {
  DOM.catalog.style.display = "";
  let filtered = drakorDB;
  if (currentGenreFilter !== "All") {
    filtered = drakorDB.filter(
      (d) => d.genre && d.genre.includes(currentGenreFilter),
    );
  }
  DOM.catalogCount.textContent = filtered.length + " judul";
  renderCards(
    gridContainer,
    filtered,
    "bg-dark-surface p-1.5 md:p-2 rounded-xl transition-all premium-shadow",
  );
}
function filterGenre(genre) {
  currentGenreFilter = genre;
  displayCatalog();
  renderGenreChips();
}
function liveSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = document
      .getElementById("search-input")
      .value.trim()
      .toLowerCase();
    switchView("home");
    const filtered = !q
      ? drakorDB
      : drakorDB.filter((d) => getSearchText(d).includes(q));
    DOM.catalogCount.textContent = filtered.length + " judul";
    renderCards(
      gridContainer,
      filtered,
      "bg-dark-surface p-1.5 md:p-2 rounded-xl transition-all premium-shadow",
    );
  }, 160);
}
function renderMobileSearchSuggestions() {
  document.getElementById("mobile-search-empty").innerHTML =
    ` <div class="p-4 text-center text-xs text-dark-muted"> Ketik kata kunci untuk memulai pencarian. </div> `;
  document.getElementById("mobile-search-results").innerHTML = "";
}
function mobileLiveSearch() {
  clearTimeout(mobileSearchTimer);
  mobileSearchTimer = setTimeout(() => {
    const q = document
      .getElementById("mobile-search-input")
      .value.trim()
      .toLowerCase();
    const resultContainer = document.getElementById(
      "mobile-search-results",
    );
    const emptyBox = document.getElementById("mobile-search-empty");
    if (!q) {
      resultContainer.innerHTML = "";
      renderMobileSearchSuggestions();
      return;
    }
    emptyBox.innerHTML = "";
    const filtered = drakorDB
      .filter((d) => getSearchText(d).includes(q))
      .slice(0, 30);
    renderCards(
      resultContainer,
      filtered,
      "bg-dark-surface p-1.5 rounded-xl premium-shadow",
    );
  }, 180);
}
function displayWatchlist() {
  const filteredWl = drakorDB.filter((d) => watchlist.includes(d.title));
  DOM.watchlistCount.innerText = filteredWl.length;
  renderCards(
    DOM.watchlistContainer,
    filteredWl,
    "bg-dark-surface p-1.5 md:p-2 rounded-xl premium-shadow mini-watchlist-card",
  );
}
function toggleWatchlist(event, title) {
  if (event) event.stopPropagation();
  const idx = watchlist.indexOf(title);
  if (idx > -1) {
    watchlist.splice(idx, 1);
    showToast("Dihapus dari Watchlist", "warning");
  } else {
    watchlist.push(title);
    showToast("Ditambahkan ke Watchlist", "success");
  }
  localStorage.setItem("kstream_watchlist", JSON.stringify(watchlist));
  if (currentView === "home") displayCatalog();
  if (currentView === "watchlist") displayWatchlist();
  if (!isMobileViewport()) displayWatchlist();
  if (currentDetailDramaId) updateDetailWatchlistButton();
}
function updateDetailWatchlistButton() {
  const drama = drakorDB.find((d) => d.id == currentDetailDramaId);
  if (!drama) return;
  const isSaved = watchlist.includes(drama.title);
  const icon = document.getElementById("detail-wl-icon");
  const text = document.getElementById("detail-wl-text");
  const button = document.getElementById("detail-watchlist-btn");
  icon.className = isSaved
    ? "fa-solid fa-bookmark text-brand"
    : "fa-regular fa-bookmark";
  text.textContent = isSaved ? "Tersimpan" : "Simpan";
  button.setAttribute(
    "aria-label",
    isSaved ? "Hapus dari watchlist" : "Tambahkan ke watchlist",
  );
}
function toggleDetailWatchlist() {
  const drama = drakorDB.find((d) => d.id == currentDetailDramaId);
  if (!drama) return;
  toggleWatchlist(null, drama.title);
}
function getMergedWatchHistory() {
  const last = safeJsonGet("lastWatched", null);
  const savedHistory = safeJsonGet("kstream_watch_history", []);
  const playerHistory = safeJsonGet("kstream:history", []).map((item) => ({
    cloudId: item.dramaId,
    epsIdx: Number(item.episodeIndex || 0),
    label: item.episode ? `${item.title || "Tayangan"} - ${item.episode}` : item.title || "Tayangan terakhir",
    progress: Number(item.progress || 0),
    watchedAt: item.watchedAt || new Date().toISOString(),
  }));
  const merged = Array.isArray(savedHistory) ? [...savedHistory] : [];
  playerHistory.forEach((entry) => {
    if (!entry.cloudId) return;
    const alreadyExists = merged.some(
      (item) =>
        String(item.cloudId) === String(entry.cloudId) &&
        Number(item.epsIdx || 0) === Number(entry.epsIdx || 0),
    );
    if (!alreadyExists) merged.push(entry);
  });
  if (last && last.cloudId) {
    const alreadyExists = merged.some(
      (item) =>
        String(item.cloudId) === String(last.cloudId) &&
        Number(item.epsIdx || 0) === Number(last.epsIdx || 0),
    );
    if (!alreadyExists) {
      merged.unshift({
        cloudId: last.cloudId,
        epsIdx: Number(last.epsIdx || 0),
        label: last.label || "Tayangan terakhir",
        progress: Number(last.progress || 0),
        watchedAt: last.watchedAt || new Date().toISOString(),
      });
    }
  }
  return merged
    .sort((a, b) => new Date(b.watchedAt || 0) - new Date(a.watchedAt || 0))
    .slice(0, 30);
}
function saveWatchHistory(history) {
  watchHistory = history.slice(0, 30);
  localStorage.setItem(
    "kstream_watch_history",
    JSON.stringify(watchHistory),
  );
  localStorage.setItem(
    "kstream:history",
    JSON.stringify(
      watchHistory.map((item) => {
        const drama = drakorDB.find((d) => String(d.id) === String(item.cloudId));
        const epsIdx = Number(item.epsIdx || 0);
        const eps = drama?.episodes?.[epsIdx];
        return {
          dramaId: item.cloudId,
          episodeIndex: epsIdx,
          title: drama?.title || item.title || "Tayangan",
          episode: eps?.epsName || item.episode || `Episode ${epsIdx + 1}`,
          watchedAt: item.watchedAt || Date.now(),
        };
      }),
    ),
  );
}
function addWatchHistoryFromIndex(cloudId, epsIdx = 0, progress = 0) {
  const drama = drakorDB.find((d) => String(d.id) === String(cloudId));
  if (!drama) return;
  const eps =
    drama.episodes && drama.episodes[epsIdx]
      ? drama.episodes[epsIdx]
      : null;
  const newItem = {
    cloudId: drama.id,
    epsIdx: Number(epsIdx || 0),
    label: `${drama.title || "Tanpa Judul"} — ${eps ? eps.epsName : `Episode ${Number(epsIdx) + 1}`}`,
    progress: Number(progress || 0),
    watchedAt: new Date().toISOString(),
  };
  const history = getMergedWatchHistory().filter(
    (item) =>
      !(
        String(item.cloudId) === String(newItem.cloudId) &&
        Number(item.epsIdx || 0) === Number(newItem.epsIdx || 0)
      ),
  );
  history.unshift(newItem);
  saveWatchHistory(history);
  localStorage.setItem("lastWatched", JSON.stringify(newItem));
}
function formatHistoryTime(value) {
  if (!value) return "Baru saja";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Baru saja";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function displayWatchHistory() {
  const history = getMergedWatchHistory();
  DOM.historyCountBadge.textContent = history.length + " tontonan";
  DOM.historyContainer.innerHTML = "";
  if (history.length === 0) {
    DOM.historyContainer.innerHTML = ` <div class="col-span-full text-center text-xs text-dark-muted border border-dark-border rounded-2xl py-10 bg-dark-surface/60"> <i class="fa-solid fa-clock-rotate-left mb-2 block text-2xl text-brand" aria-hidden="true"></i> Belum ada history tontonan. </div> `;
    return;
  }
  const fragment = document.createDocumentFragment();
  history.forEach((item, index) => {
    const drama = drakorDB.find(
      (d) => String(d.id) === String(item.cloudId),
    );
    if (!drama) return;
    const epsIdx = Number(item.epsIdx || 0);
    const eps =
      drama.episodes && drama.episodes[epsIdx]
        ? drama.episodes[epsIdx]
        : null;
    const progress = Math.max(
      0,
      Math.min(100, Number(item.progress || 0)),
    );
    const title = escapeHTML(drama.title || "Tanpa Judul");
    const epsName = escapeHTML(
      eps ? eps.epsName : `Episode ${epsIdx + 1}`,
    );
    const row = document.createElement("article");
    row.className = "history-text-card";
    row.innerHTML = ` <div class="flex items-start justify-between gap-3"> <div class="min-w-0"> <h3 class="text-sm font-bold text-white truncate">${title}</h3> <p class="mt-1 text-[11px] text-neutral-400 truncate">${epsName}</p> <p class="mt-1 text-[11px] italic text-dark-muted">${formatHistoryTime(item.watchedAt)}</p> </div> <button type="button" onclick="triggerPlayer('${drama.id}', ${epsIdx})" class="min-h-11 play-mini text-[11px] font-bold bg-brand text-white px-3 py-2 rounded-xl shrink-0" aria-label="Putar lagi ${title}" >Putar</button> </div> `;
    fragment.appendChild(row);
  });
  DOM.historyContainer.appendChild(fragment);
}
function removeWatchHistoryItem(index) {
  const history = getMergedWatchHistory();
  history.splice(index, 1);
  saveWatchHistory(history);
  displayWatchHistory();
  checkHistory();
  showToast("History berhasil dihapus", "warning");
}
function clearWatchHistory() {
  if (!confirm("Hapus semua history tontonan?")) return;
  localStorage.removeItem("kstream_watch_history");
  localStorage.removeItem("kstream:history");
  localStorage.removeItem("lastWatched");
  watchHistory = [];
  displayWatchHistory();
  checkHistory();
  showToast("Semua history berhasil dihapus", "warning");
}
function openPreviewModal(id) {
  const drama = drakorDB.find((d) => d.id == id);
  if (!drama) return;
  currentModalDramaId = id;
  lastFocusedElement = document.activeElement;
  document.getElementById("modal-title").innerText =
    drama.title || "Tanpa Judul";
  const modalBanner = document.getElementById("modal-banner");
  modalBanner.src = safeImageUrl(drama.image, 900, 72);
  modalBanner.alt = `Banner ${drama.title || "tayangan"}`;
  modalBanner.onerror = () => {
    modalBanner.onerror = null;
    modalBanner.src = DEFAULT_POSTER;
  };
  document.getElementById("modal-total-episodes").innerText =
    `${(drama.episodes || []).length} Bagian`;
  document.getElementById("modal-rating").innerText =
    getUserRatingLabel(drama);
  document.getElementById("modal-year").innerText = drama.year || "2026";
  document.getElementById("modal-genre-display").innerText =
    `Genre: ${drama.genre || "K-Drama"}`;
  document.getElementById("modal-synopsis").innerText = shortenSynopsis(
    drama.synopsis,
    3,
  );
  const grid = document.getElementById("modal-episode-grid");
  grid.innerHTML = "";
  (drama.episodes || []).forEach((eps, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "min-h-11 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-xl text-xs text-neutral-300";
    btn.textContent = eps.epsName || `Episode ${idx + 1}`;
    btn.onclick = () => {
      closePreviewModal();
      triggerPlayer(drama.id, idx);
    };
    grid.appendChild(btn);
  });
  const overlay = document.getElementById("preview-modal-overlay");
  const modal = document.getElementById("preview-modal");
  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
  lockBodyScroll();
  setTimeout(() => modal.focus(), 50);
}
function playFromModal() {
  if (currentModalDramaId) triggerPlayer(currentModalDramaId, 0);
}
function openDetailFromModal() {
  if (currentModalDramaId) {
    const id = currentModalDramaId;
    closePreviewModal();
    openDetailPage(id);
  }
}
function closePreviewModal() {
  const overlay = document.getElementById("preview-modal-overlay");
  const modal = document.getElementById("preview-modal");
  overlay.classList.add("hidden");
  modal.classList.add("hidden");
  unlockBodyScroll();
  if (
    lastFocusedElement &&
    typeof lastFocusedElement.focus === "function"
  ) {
    lastFocusedElement.focus();
  }
}
function openDetailPage(id) {
  const drama = drakorDB.find((d) => d.id == id);
  if (!drama) return;
  currentDetailDramaId = id;
  lastFocusedElement = document.activeElement;
  const detailBanner = document.getElementById("detail-banner");
  detailBanner.src = safeImageUrl(drama.image, 1200, 72);
  detailBanner.alt = `Banner ${drama.title || "tayangan"}`;
  detailBanner.onerror = () => {
    detailBanner.onerror = null;
    detailBanner.src = DEFAULT_POSTER;
  };
  document.getElementById("detail-title").textContent =
    drama.title || "Tanpa Judul";
  document.getElementById("detail-rating").textContent =
    getUserRatingLabel(drama);
  document.getElementById("detail-year").textContent =
    drama.year || "2026";
  document.getElementById("detail-genre").textContent =
    `Genre: ${drama.genre || "K-Drama"}`;
  document.getElementById("detail-synopsis").textContent =
    shortenSynopsis(drama.synopsis, 3);
  document.getElementById("detail-total-eps").textContent =
    `${(drama.episodes || []).length} Episode`;
  const playBtn = document.getElementById("detail-play-btn");
  playBtn.onclick = () => triggerPlayer(drama.id, 0);
  const progList = document.getElementById("detail-progress-list");
  progList.innerHTML = "";
  (drama.episodes || []).forEach((eps, idx) => {
    const watched =
      episodeProgress[drama.id] && episodeProgress[drama.id][idx];
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between p-3 bg-dark-surface rounded-xl border border-dark-border gap-3";
    row.innerHTML = ` <div class="min-w-0"> <span class="text-xs text-white block truncate">${escapeHTML(eps.epsName || `Episode ${idx + 1}`)}</span> <span class="text-[10px] ${watched ? "text-brand" : "text-dark-muted"}">${watched ? "Sudah ditonton" : "Belum ditonton"}</span> </div> <button type="button" class="min-h-11 text-xs bg-brand text-white px-4 py-1 rounded-lg shrink-0" onclick="triggerPlayer('${drama.id}', ${idx})">Putar</button> `;
    progList.appendChild(row);
  });
  updateDetailWatchlistButton();
  const detailPage = document.getElementById("detail-page");
  detailPage.style.display = "block";
  lockBodyScroll();
  setTimeout(() => detailPage.focus(), 50);
}
function closeDetailPage() {
  const detailPage = document.getElementById("detail-page");
  detailPage.style.display = "none";
  unlockBodyScroll();
  if (
    lastFocusedElement &&
    typeof lastFocusedElement.focus === "function"
  ) {
    lastFocusedElement.focus();
  }
}
function checkHistory() {
  const last = JSON.parse(localStorage.getItem("lastWatched") || "null");
  const bar = document.getElementById("continue-watching");
  if (
    last &&
    drakorDB.some((d) => String(d.id) === String(last.cloudId))
  ) {
    const progress = Math.max(0, Math.min(100, Number(last.progress || 0)));
    bar.style.display = "flex";
    document.getElementById("continue-text").innerText =
      last.label || "Lanjutkan menonton";
    document.getElementById("continue-progress").value = progress;
    document.getElementById("continue-btn").onclick = () =>
      triggerPlayer(last.cloudId, last.epsIdx || 0);
  } else {
    bar.style.display = "none";
  }
}
async function fetchRatingSummaries() {
  const localRatings = {
    ...safeJsonGet("kstream_user_ratings", {}),
    ...safeJsonGet("kstream:ratings", {}),
  };
  const localSummary = Object.fromEntries(
    Object.entries(localRatings).map(([id, rating]) => [
      String(id),
      { average: Number(rating), count: 1 },
    ]),
  );
  try {
    const viewData = await restSelect("drakor_rating_summary", {
      select: "drakor_id,average_rating,rating_count",
    });
    const cloudSummary = Object.fromEntries(
      (viewData || []).map((item) => [
        String(item.drakor_id),
        {
          average: Number(item.average_rating || 0),
          count: Number(item.rating_count || 0),
        },
      ]),
    );
    Object.entries(localSummary).forEach(([id, summary]) => {
      if (!cloudSummary[id]) cloudSummary[id] = summary;
    });
    return cloudSummary;
  } catch {
    // View komunitas mungkin belum dipasang; coba tabel rating langsung.
  }
  try {
    const ratingData = await restSelect("drakor_ratings", {
      select: "drakor_id,rating",
    });
    return (ratingData || []).reduce((summary, item) => {
      const key = String(item.drakor_id);
      if (!summary[key]) {
        summary[key] = { total: 0, count: 0, average: 0 };
      }
      summary[key].total += Number(item.rating || 0);
      summary[key].count += 1;
      summary[key].average = summary[key].total / summary[key].count;
      return summary;
    }, {});
  } catch {
    return localSummary;
  }
}
function normalizeCatalogDrama(drama, summary = {}) {
  return {
    ...drama,
    episodes: Array.isArray(drama.episodes) ? drama.episodes : [],
    _userRatingAverage: Number(summary.average || 0),
    _userRatingCount: Number(summary.count || 0),
  };
}
function applyRatingSummaries(summaries = {}) {
  let changed = false;
  drakorDB = drakorDB.map((drama) => {
    const summary = summaries[String(drama.id)];
    if (!summary) return drama;
    const average = Number(summary.average || 0);
    const count = Number(summary.count || 0);
    if (
      average === Number(drama._userRatingAverage || 0) &&
      count === Number(drama._userRatingCount || 0)
    ) {
      return drama;
    }
    changed = true;
    return {
      ...drama,
      _userRatingAverage: average,
      _userRatingCount: count,
    };
  });
  if (!changed) return;
  updateHeroContent(heroCurrentIdx);
  if (currentView === "home") displayCatalog();
  if (!isMobileViewport() || currentView === "watchlist") displayWatchlist();
  if (currentModalDramaId) {
    const modalDrama = drakorDB.find((d) => d.id == currentModalDramaId);
    if (modalDrama) {
      document.getElementById("modal-rating").innerText =
        getUserRatingLabel(modalDrama);
    }
  }
  if (currentDetailDramaId) {
    const detailDrama = drakorDB.find((d) => d.id == currentDetailDramaId);
    if (detailDrama) {
      document.getElementById("detail-rating").textContent =
        getUserRatingLabel(detailDrama);
    }
  }
}
async function refreshRatingsLater() {
  try {
    applyRatingSummaries(await fetchRatingSummaries());
  } catch (error) {
    console.warn("Rating gagal dimuat:", error);
  }
}

function renderLoadedCatalog() {
  setupHero(drakorDB);
  renderGenreChips();
  displayCatalog();
  checkHistory();
  if (currentView === "home") setActiveNav("home");
  else switchView(currentView);
}

function saveCatalogCache(data) {
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Cache katalog hanya akselerator; kegagalannya tidak boleh memblokir UI.
  }
}

async function fetchCloudData() {
  const cachedCatalog = safeJsonGet(CATALOG_CACHE_KEY, []);
  const hasCachedCatalog =
    Array.isArray(cachedCatalog) && cachedCatalog.length > 0;

  if (hasCachedCatalog) {
    drakorDB = cachedCatalog.map((drama) => normalizeCatalogDrama(drama));
    renderLoadedCatalog();
  } else {
    showSkeletons(10);
  }

  try {
    const data = await restSelect("drakor", {
      select: CATALOG_FIELDS,
      order: "id.desc",
    });
    const catalogChanged =
      !hasCachedCatalog ||
      JSON.stringify(cachedCatalog) !== JSON.stringify(data || []);
    saveCatalogCache(data || []);
    drakorDB = (data || []).map((drama) => normalizeCatalogDrama(drama));
    if (catalogChanged) renderLoadedCatalog();
    runWhenIdle(() => {
      if (!isMobileViewport()) {
        displayWatchlist();
        displayWatchHistory();
      }
      refreshRatingsLater();
    });
  } catch (err) {
    console.error(err);
    if (!hasCachedCatalog) {
      gridContainer.innerHTML = ` <div class="col-span-full p-4 text-center text-red-500 border border-red-500/20 bg-red-500/10 rounded-2xl"> Koneksi Cloud Gagal. Coba muat ulang halaman. </div> `;
    }
  }
}

function trapDialogFocus(event, dialog) {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = [...dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", function (event) {
  const modal = document.getElementById("preview-modal");
  const detail = document.getElementById("detail-page");
  const search = document.getElementById("mobile-search-panel");
  const activeDialog = !modal.classList.contains("hidden")
    ? modal
    : detail.style.display === "block"
      ? detail
      : !search.classList.contains("hidden")
        ? search
        : null;
  trapDialogFocus(event, activeDialog);
  if (event.key === "Escape") {
    const modalOpen = !modal.classList.contains("hidden");
    const detailOpen = detail.style.display === "block";
    const searchOpen = !search.classList.contains("hidden");
    if (modalOpen) closePreviewModal();
    else if (detailOpen) closeDetailPage();
    else if (searchOpen) switchView("home");
  }
});
fetchCloudData();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) =>
        console.error("Service worker gagal didaftarkan:", error),
      );
  });
}
