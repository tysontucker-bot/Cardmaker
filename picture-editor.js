// One picture editor that slides in over the cards, so changing pictures never means
// scrolling through the pages. A change applies to that word on every card.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// getTerms(): the picture words on the current cards, in card order.
// getPicture(term): Promise of { imageUrl, alt, custom } or null.
// search(term): Promise of [{ imageUrl, alt }].
// setPicture(term, picture | null): null goes back to the original symbol.
// prepareUpload(file): Promise of a data URL sized for saving.
export function createPictureEditor({ getTerms, getPicture, search, setPicture, prepareUpload }) {
  const backdrop = el('div', 'pe-backdrop');
  backdrop.hidden = true;
  const drawer = el('aside', 'pe-drawer');
  drawer.hidden = true;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Change pictures');

  const head = el('div', 'pe-head');
  const backBtn = el('button', 'pe-icon-btn pe-back', '‹ All pictures');
  backBtn.type = 'button';
  const title = el('h2', 'pe-title', 'Pictures');
  const closeBtn = el('button', 'pe-icon-btn pe-close', 'Done');
  closeBtn.type = 'button';
  head.append(backBtn, title, closeBtn);

  const body = el('div', 'pe-body');
  drawer.append(head, body);
  document.body.append(backdrop, drawer);

  let terms = [];
  let currentIndex = -1;
  let lastFocus = null;
  let searchToken = 0;

  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove('pe-open');
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  function show() {
    if (drawer.hidden) lastFocus = document.activeElement;
    drawer.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('pe-open');
  }

  // ── All pictures (list) ──

  async function showList() {
    terms = getTerms();
    currentIndex = -1;
    backBtn.hidden = true;
    title.textContent = 'Pictures';
    body.innerHTML = '';
    show();

    if (terms.length === 0) {
      body.append(
        el('p', 'pe-empty', 'These cards don’t use pictures. Pick a picture relationship and make cards first.')
      );
      closeBtn.focus();
      return;
    }

    body.append(el('p', 'pe-hint', 'Tap a picture to change it. A change shows on every card that uses that word.'));
    const grid = el('div', 'pe-list');
    body.append(grid);
    terms.forEach((term, index) => {
      const tile = el('button', 'pe-tile');
      tile.type = 'button';
      const pic = el('span', 'pe-tile-pic');
      const word = el('span', 'pe-tile-word', term);
      tile.append(pic, word);
      tile.addEventListener('click', () => showTerm(index));
      grid.append(tile);
      getPicture(term).then((picture) => {
        if (picture) {
          const img = el('img');
          img.src = picture.imageUrl;
          img.alt = '';
          pic.append(img);
          if (picture.custom) tile.append(el('span', 'pe-badge', 'Changed'));
        } else {
          pic.append(el('span', 'pe-none', 'No picture'));
        }
      });
    });
    grid.querySelector('button')?.focus();
  }

  // ── One word (detail) ──

  async function showTerm(index) {
    terms = terms.length ? terms : getTerms();
    if (index < 0 || index >= terms.length) return;
    currentIndex = index;
    const term = terms[index];
    backBtn.hidden = false;
    title.textContent = term;
    body.innerHTML = '';
    show();

    const current = el('div', 'pe-current');
    const currentPic = el('div', 'pe-current-pic');
    const currentInfo = el('div', 'pe-current-info');
    const currentLabel = el('p', 'pe-current-label', 'On the cards now');
    const resetBtn = el('button', 'pe-text-btn', 'Use the original symbol');
    resetBtn.type = 'button';
    resetBtn.hidden = true;
    currentInfo.append(currentLabel, resetBtn);
    current.append(currentPic, currentInfo);

    const nav = el('div', 'pe-nav');
    const prevBtn = el('button', 'pe-nav-btn', '‹ Previous');
    prevBtn.type = 'button';
    prevBtn.disabled = index === 0;
    const counter = el('span', 'pe-counter', `${index + 1} of ${terms.length}`);
    const nextBtn = el('button', 'pe-nav-btn', 'Next ›');
    nextBtn.type = 'button';
    nextBtn.disabled = index === terms.length - 1;
    prevBtn.addEventListener('click', () => showTerm(index - 1));
    nextBtn.addEventListener('click', () => showTerm(index + 1));
    nav.append(prevBtn, counter, nextBtn);

    const searchRow = el('form', 'pe-search');
    const searchInput = el('input', 'pe-search-input');
    searchInput.type = 'search';
    searchInput.value = term;
    searchInput.setAttribute('aria-label', 'Search ARASAAC symbols');
    searchInput.enterKeyHint = 'search';
    const searchBtn = el('button', 'pe-search-btn', 'Search');
    searchBtn.type = 'submit';
    searchRow.append(searchInput, searchBtn);

    const results = el('div', 'pe-results');
    results.setAttribute('aria-live', 'polite');

    const upload = el('label', 'pe-upload');
    upload.append(el('span', '', 'Upload a photo'));
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    upload.append(fileInput);

    body.append(nav, current, searchRow, results, upload);

    async function paintCurrent() {
      const picture = await getPicture(term);
      if (currentIndex !== index) return;
      currentPic.innerHTML = '';
      if (picture) {
        const img = el('img');
        img.src = picture.imageUrl;
        img.alt = `Current picture for ${term}`;
        currentPic.append(img);
      } else {
        currentPic.append(el('span', 'pe-none', 'No picture'));
      }
      resetBtn.hidden = !picture?.custom;
      results.querySelectorAll('.pe-result').forEach((btn) => {
        btn.classList.toggle('pe-result--chosen', Boolean(picture) && btn.dataset.url === picture.imageUrl);
      });
    }

    async function choose(picture) {
      await setPicture(term, picture);
      await paintCurrent();
    }

    async function runSearch(query) {
      const token = ++searchToken;
      results.innerHTML = '';
      results.append(el('p', 'pe-msg', 'Searching…'));
      let found = [];
      try {
        found = await search(query);
      } catch {
        if (token !== searchToken) return;
        results.innerHTML = '';
        results.append(el('p', 'pe-msg', 'Search didn’t go through. Check the internet connection and try again.'));
        return;
      }
      if (token !== searchToken) return;
      results.innerHTML = '';
      if (found.length === 0) {
        results.append(el('p', 'pe-msg', `No symbols for “${query}.” Try a simpler word, or upload a photo.`));
        return;
      }
      found.forEach((picture) => {
        const btn = el('button', 'pe-result');
        btn.type = 'button';
        btn.dataset.url = picture.imageUrl;
        btn.setAttribute('aria-label', `Use this picture for ${term}`);
        const img = el('img');
        img.src = picture.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        btn.append(img);
        btn.addEventListener('click', () => choose({ imageUrl: picture.imageUrl, alt: term }));
        results.append(btn);
      });
      paintCurrent();
    }

    searchRow.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (query) runSearch(query);
    });

    resetBtn.addEventListener('click', () => choose(null));

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const dataUrl = await prepareUpload(file);
      fileInput.value = '';
      choose({ imageUrl: dataUrl, alt: term });
    });

    paintCurrent();
    runSearch(term);
    (nextBtn.disabled ? prevBtn : nextBtn).focus({ preventScroll: true });
  }

  backBtn.addEventListener('click', showList);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  return {
    openList: showList,
    openTerm(term) {
      terms = getTerms();
      const index = terms.indexOf(term);
      if (index === -1) showList();
      else showTerm(index);
    }
  };
}
