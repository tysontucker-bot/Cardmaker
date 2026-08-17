import { RELATIONSHIPS, buildCardSet } from './logic.js';

const relationshipSelect = document.getElementById('relationship');
const arraySizeSelect = document.getElementById('arraySize');
const targetsInput = document.getElementById('targets');
const generateButton = document.getElementById('generate');
const printButton = document.getElementById('print');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

const symbolCache = new Map();

// Map from card key -> { imageUrl, alt } for teacher-overridden pictures.
// Key is the card's stimulus string (stable across re-renders within a session).
const pictureOverrides = new Map();

function initRelationshipOptions() {
  relationshipSelect.innerHTML = RELATIONSHIPS.map(
    (relation) => `<option value="${relation.id}">${relation.label}</option>`
  ).join('');
}

function getConstraints() {
  return {
    sameLength: document.getElementById('sameLength').checked,
    differentInitial: document.getElementById('differentInitial').checked,
    uniqueInitials: document.getElementById('uniqueInitials').checked,
    exactLength: document.getElementById('exactLength').value
  };
}

async function fetchArasaacSymbol(term) {
  const key = term.trim().toLowerCase();
  if (!key) return null;
  if (symbolCache.has(key)) return symbolCache.get(key);

  try {
    const response = await fetch(`https://api.arasaac.org/api/pictograms/en/search/${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`ARASAAC search failed: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      symbolCache.set(key, null);
      return null;
    }

    const best = data[0];
    const id = best._id;
    if (!id) {
      symbolCache.set(key, null);
      return null;
    }

    const symbol = {
      imageUrl: `https://static.arasaac.org/pictograms/${id}/${id}_500.png`,
      sourceUrl: `https://arasaac.org/pictograms/${id}`,
      attribution: 'ARASAAC (CC BY-NC-SA)'
    };

    symbolCache.set(key, symbol);
    return symbol;
  } catch {
    symbolCache.set(key, null);
    return null;
  }
}

function renderTextChoice(value) {
  const item = document.createElement('div');
  item.className = 'choice-item';
  item.textContent = value;
  return item;
}

function renderQuantityChoice(value) {
  const count = Math.max(0, Math.min(20, parseInt(value, 10) || 0));
  const item = document.createElement('div');
  item.className = 'choice-item quantity';
  item.setAttribute('aria-label', `${count} objects`);
  item.innerHTML = `<div class="quantity-dots">${'● '.repeat(count).trim() || '0'}</div>`;
  return item;
}

async function renderPictureBox(label, cssClass = 'picture-box', overrideData = null) {
  const box = document.createElement('div');
  box.className = cssClass;

  if (overrideData) {
    box.innerHTML = `<img src="${overrideData.imageUrl}" alt="${overrideData.alt}" />`;
  } else {
    const symbol = await fetchArasaacSymbol(label);
    if (symbol) {
      box.innerHTML = `<img src="${symbol.imageUrl}" alt="${label}" />`;
    } else {
      box.innerHTML = `<div class="picture-fallback" aria-label="No symbol found for ${label}">${label}</div>`;
    }
  }

  return box;
}

// Returns the override key used to store a picture override for a stimulus.
function overrideKey(stimulus) {
  return stimulus;
}

async function renderCard(card, index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card-wrapper';

  const cardElement = document.createElement('article');
  cardElement.className = 'instruction-card';
  cardElement.setAttribute('aria-label', `Card ${index + 1}`);

  const stimulusArea = document.createElement('div');
  stimulusArea.className = 'stimulus-area';

  const hasPictureStimulus = card.relationship.stimulus === 'picture';

  if (hasPictureStimulus) {
    const override = pictureOverrides.get(overrideKey(card.stimulus));
    stimulusArea.appendChild(await renderPictureBox(card.stimulus, 'picture-box', override || null));
  } else {
    const stimulusText = document.createElement('div');
    stimulusText.className = 'stimulus-text';
    stimulusText.textContent = card.stimulus;
    stimulusArea.appendChild(stimulusText);
  }

  const choicesArea = document.createElement('div');
  choicesArea.className = `choices-area choices-${card.choices.length}`;

  for (const choice of card.choices) {
    if (card.relationship.choice === 'picture') {
      const choiceWrapper = document.createElement('div');
      choiceWrapper.className = 'choice-item picture-choice';
      choiceWrapper.appendChild(await renderPictureBox(choice, 'picture-box small'));
      choicesArea.appendChild(choiceWrapper);
    } else if (card.relationship.choice === 'quantity') {
      choicesArea.appendChild(renderQuantityChoice(choice));
    } else {
      choicesArea.appendChild(renderTextChoice(choice));
    }
  }

  cardElement.appendChild(stimulusArea);
  cardElement.appendChild(choicesArea);
  wrapper.appendChild(cardElement);

  // Only show the Change Picture control for cards that have a picture stimulus.
  if (hasPictureStimulus) {
    const controls = buildChangePictureControls(card, stimulusArea);
    wrapper.appendChild(controls);
  }

  return wrapper;
}

// Build the "Change Picture" toolbar and inline panel for a card.
function buildChangePictureControls(card, stimulusArea) {
  const key = overrideKey(card.stimulus);

  const controls = document.createElement('div');
  controls.className = 'card-controls no-print';

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'change-pic-btn';
  changeBtn.textContent = '🖼 Change Picture';
  controls.appendChild(changeBtn);

  // Inline panel (hidden until button clicked)
  const panel = document.createElement('div');
  panel.className = 'change-pic-panel';
  panel.hidden = true;

  // ── Section 1: Search ARASAAC ──────────────────────────────────────────────
  const searchSection = document.createElement('div');
  searchSection.className = 'cpc-section';

  const searchLabel = document.createElement('strong');
  searchLabel.textContent = 'Search ARASAAC';
  searchSection.appendChild(searchLabel);

  const searchRow = document.createElement('div');
  searchRow.className = 'cpc-row';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = `e.g. ${card.stimulus}`;
  searchInput.className = 'cpc-search-input';
  searchInput.value = card.stimulus;

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.textContent = 'Search';
  searchBtn.className = 'cpc-action-btn';

  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  searchSection.appendChild(searchRow);

  const thumbGrid = document.createElement('div');
  thumbGrid.className = 'cpc-thumb-grid';
  searchSection.appendChild(thumbGrid);

  searchBtn.addEventListener('click', async () => {
    const term = searchInput.value.trim();
    if (!term) return;
    thumbGrid.innerHTML = '<span class="cpc-loading">Searching…</span>';
    try {
      const response = await fetch(
        `https://api.arasaac.org/api/pictograms/en/search/${encodeURIComponent(term)}`
      );
      if (!response.ok) throw new Error(`ARASAAC search failed: ${response.status}`);
      const data = await response.json();
      thumbGrid.innerHTML = '';
      if (!Array.isArray(data) || data.length === 0) {
        thumbGrid.innerHTML = '<span class="cpc-msg">No results found.</span>';
        return;
      }
      data.slice(0, 20).forEach((item) => {
        const id = item._id;
        const imgUrl = `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'cpc-thumb';
        thumb.setAttribute('aria-label', `Select pictogram ${id}`);
        thumb.innerHTML = `<img src="${imgUrl}" alt="${item.keywords?.[0]?.keyword ?? term}" />`;
        thumb.addEventListener('click', () => {
          applyPictureOverride(key, { imageUrl: imgUrl, alt: term }, stimulusArea);
          panel.hidden = true;
        });
        thumbGrid.appendChild(thumb);
      });
    } catch {
      thumbGrid.innerHTML = '<span class="cpc-msg">Search failed. Please try again.</span>';
    }
  });

  // ── Section 2: Upload My Own Picture ─────────────────────────────────────
  const uploadSection = document.createElement('div');
  uploadSection.className = 'cpc-section';

  const uploadLabel = document.createElement('strong');
  uploadLabel.textContent = 'Upload My Own Picture';
  uploadSection.appendChild(uploadLabel);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/jpg';
  fileInput.className = 'cpc-file-input';

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      applyPictureOverride(key, { imageUrl: dataUrl, alt: file.name }, stimulusArea);
      panel.hidden = true;
    };
    reader.readAsDataURL(file);
  });

  uploadSection.appendChild(fileInput);

  // ── Section 3: Keep Current ───────────────────────────────────────────────
  const keepSection = document.createElement('div');
  keepSection.className = 'cpc-section';

  const keepBtn = document.createElement('button');
  keepBtn.type = 'button';
  keepBtn.textContent = 'Keep Current Picture';
  keepBtn.className = 'cpc-action-btn cpc-keep-btn';
  keepBtn.addEventListener('click', () => {
    panel.hidden = true;
  });
  keepSection.appendChild(keepBtn);

  panel.appendChild(searchSection);
  panel.appendChild(uploadSection);
  panel.appendChild(keepSection);
  controls.appendChild(panel);

  changeBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      searchInput.focus();
    }
  });

  return controls;
}

// Apply (or store) a picture override and update the live stimulus area.
function applyPictureOverride(key, overrideData, stimulusArea) {
  pictureOverrides.set(key, overrideData);
  // Update the existing stimulus area in-place without touching choices.
  stimulusArea.innerHTML = '';
  const img = document.createElement('img');
  img.src = overrideData.imageUrl;
  img.alt = overrideData.alt;
  const box = document.createElement('div');
  box.className = 'picture-box';
  box.appendChild(img);
  stimulusArea.appendChild(box);
}

function chunkCards(cards, chunkSize) {
  const chunks = [];
  for (let i = 0; i < cards.length; i += chunkSize) {
    chunks.push(cards.slice(i, i + chunkSize));
  }
  return chunks;
}

async function generateCards() {
  const relationshipId = relationshipSelect.value;
  const arraySize = parseInt(arraySizeSelect.value, 10);
  const targetLines = targetsInput.value;

  if (!targetLines.trim()) {
    status.textContent = 'Please enter at least one target item.';
    preview.innerHTML = '';
    return;
  }

  status.textContent = 'Generating cards...';

  const cards = buildCardSet({
    relationshipId,
    targetLines,
    arraySize,
    constraints: getConstraints()
  });

  preview.innerHTML = '';

  const pages = chunkCards(cards, 9);
  for (const pageCards of pages) {
    const page = document.createElement('section');
    page.className = 'print-page';
    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    for (const [index, card] of pageCards.entries()) {
      grid.appendChild(await renderCard(card, index));
    }

    page.appendChild(grid);
    preview.appendChild(page);
  }

  status.textContent = `Generated ${cards.length} cards across ${pages.length} page(s).`;
}

initRelationshipOptions();
generateButton.addEventListener('click', () => {
  generateCards();
});
printButton.addEventListener('click', () => window.print());
