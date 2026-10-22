import { RELATIONSHIPS, buildCardSet, parseTargetLines } from './logic.js';
import { openLiveDataSheet } from './live-data.js';
import { initCardSets, shrinkDataUrl } from './card-sets.js';
import { createPictureEditor } from './picture-editor.js';

const relationshipSelect = document.getElementById('relationship');
const arraySizeSelect = document.getElementById('arraySize');
const cardSizeSelect = document.getElementById('cardSize');
const cardLayoutSelect = document.getElementById('cardLayout');
const targetsInput = document.getElementById('targets');
const generateButton = document.getElementById('generate');
const createDataSheetButton = document.getElementById('createDataSheet');
const takeDataButton = document.getElementById('takeData');
const editPicturesButton = document.getElementById('editPictures');
const printButton = document.getElementById('print');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

const symbolCache = new Map();

// The cards currently on screen, and the settings they were made from.
let currentCards = [];
let currentCardsSignature = '';
// The saved card set being worked on, if one is open.
let currentSet = null;

// Letters and numbers read faster as text than as a picture search would.
const TEXT_ONLY_RELATIONSHIPS = new Set([
  'uppercase-lowercase',
  'lowercase-uppercase',
  'letter-letter',
  'number-number',
  'number-quantity',
  'numeral-number-word'
]);

// Map from card key -> { imageUrl, alt } for teacher-overridden pictures.
// Key is the card's stimulus string (stable across re-renders within a session).
const pictureOverrides = new Map();
const choicePictureOverrides = new Map();
// Word -> { imageUrl, alt }. A picture chosen in the picture editor shows on every card
// that uses that word.
const wordPictures = new Map();

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
  box.dataset.term = label;
  if (!overrideData && wordPictures.has(label)) overrideData = wordPictures.get(label);

  if (overrideData) {
    const img = document.createElement('img');
    img.src = overrideData.imageUrl;
    img.alt = overrideData.alt;
    box.appendChild(img);
  } else {
    const symbol = await fetchArasaacSymbol(label);
    if (symbol) {
      const img = document.createElement('img');
      img.src = symbol.imageUrl;
      img.alt = label;
      box.appendChild(img);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'picture-fallback';
      fallback.setAttribute('aria-label', `No symbol found for ${label}`);
      fallback.textContent = label;
      box.appendChild(fallback);
    }
  }

  return box;
}

function makeEditable(area, term) {
  area.classList.add('click-change-target');
  area.tabIndex = 0;
  area.setAttribute('role', 'button');
  area.setAttribute('aria-label', `Change picture for ${term}`);
  area.addEventListener('click', () => pictureEditor.openTerm(term));
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pictureEditor.openTerm(term);
    }
  });
}

// The picture words on the current cards, targets first, each listed once.
function pictureTerms() {
  const terms = [];
  const add = (term) => {
    if (term && term !== '—' && !terms.includes(term)) terms.push(term);
  };
  currentCards.forEach((card) => {
    if (card.relationship.stimulus === 'picture') add(card.stimulus);
    else if (card.relationship.choice === 'picture') add(card.correctChoice);
  });
  currentCards.forEach((card) => {
    if (card.relationship.choice === 'picture') card.choices.forEach(add);
  });
  return terms;
}

async function currentPictureFor(term) {
  if (wordPictures.has(term)) return { ...wordPictures.get(term), custom: true };
  if (pictureOverrides.has(term)) return { ...pictureOverrides.get(term), custom: true };
  for (const [key, value] of choicePictureOverrides) {
    if (key.split('::')[2] === term) return { ...value, custom: true };
  }
  const symbol = await fetchArasaacSymbol(term);
  return symbol ? { imageUrl: symbol.imageUrl, alt: term, custom: false } : null;
}

const arasaacSearchCache = new Map();
async function searchArasaac(query) {
  const key = query.trim().toLowerCase();
  if (arasaacSearchCache.has(key)) return arasaacSearchCache.get(key);
  const response = await fetch(`https://api.arasaac.org/api/pictograms/en/search/${encodeURIComponent(key)}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`ARASAAC search failed: ${response.status}`);
  const data = await response.json();
  const results = (Array.isArray(data) ? data : []).slice(0, 24).map((item) => ({
    imageUrl: `https://static.arasaac.org/pictograms/${item._id}/${item._id}_500.png`,
    alt: query
  }));
  arasaacSearchCache.set(key, results);
  return results;
}

async function setWordPicture(term, picture) {
  if (picture) wordPictures.set(term, picture);
  else wordPictures.delete(term);
  // Older per-card picks for this word would hide the new one, so clear them.
  pictureOverrides.delete(term);
  for (const key of [...choicePictureOverrides.keys()]) {
    if (key.split('::')[2] === term) choicePictureOverrides.delete(key);
  }
  // Swap the picture on every card in place, so the page doesn't jump.
  const boxes = [...preview.querySelectorAll('.picture-box')].filter((box) => box.dataset.term === term);
  for (const box of boxes) {
    box.replaceWith(await renderPictureBox(term, box.className, null));
  }
  if (currentSet) {
    status.textContent = `Picture changed. Tap Save card set to keep it in “${currentSet.name}.”`;
  }
}

const pictureEditor = createPictureEditor({
  getTerms: pictureTerms,
  getPicture: currentPictureFor,
  search: searchArasaac,
  setPicture: setWordPicture,
  prepareUpload: (file) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => resolve(await shrinkDataUrl(event.target.result));
      reader.readAsDataURL(file);
    })
});

// Returns the override key used to store a picture override for a stimulus.
function overrideKey(stimulus) {
  return stimulus;
}

function choiceOverrideKey(stimulus, choice, choiceIndex) {
  return `${stimulus}::${choiceIndex}::${choice}`;
}

function shouldUseChoicesTopLayout(card, { isDoubleWidth, cardLayout }) {
  return (
    isDoubleWidth &&
    cardLayout === 'choices-top' &&
    card.relationship.stimulus === 'text' &&
    card.relationship.choice === 'picture'
  );
}

async function renderCard(card, index, layoutOptions) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card-wrapper';

  const cardElement = document.createElement('article');
  cardElement.className = 'instruction-card';
  cardElement.setAttribute('aria-label', `Card ${index + 1}`);
  const useChoicesTopLayout = shouldUseChoicesTopLayout(card, layoutOptions);
  if (useChoicesTopLayout) {
    cardElement.classList.add('instruction-card--choices-top');
  }
  if (card.relationship.id === 'letter-letter') {
    cardElement.classList.add('instruction-card--letter-letter');
  }
  if (layoutOptions.isDoubleWidth && card.relationship.id === 'letter-letter') {
    cardElement.classList.add('instruction-card--large-letter-letter');
  }

  const stimulusArea = document.createElement('div');
  stimulusArea.className = 'stimulus-area';

  const hasPictureStimulus = card.relationship.stimulus === 'picture';

  if (hasPictureStimulus) {
    const override = pictureOverrides.get(overrideKey(card.stimulus));
    stimulusArea.appendChild(await renderPictureBox(card.stimulus, 'picture-box', override || null));
    stimulusArea.classList.add('click-change-target');
  } else {
    const stimulusText = document.createElement('div');
    stimulusText.className = 'stimulus-text';
    stimulusText.textContent = card.stimulus;
    stimulusArea.appendChild(stimulusText);
  }
  if (useChoicesTopLayout) {
    stimulusArea.classList.add('stimulus-area--prompt-footer');
  }

  const choicesArea = document.createElement('div');
  choicesArea.className = `choices-area choices-${card.choices.length}`;
  if (useChoicesTopLayout) {
    choicesArea.classList.add('choices-area--answer-bank');
  }

  for (const [choiceIndex, choice] of card.choices.entries()) {
    if (card.relationship.choice === 'picture') {
      const choiceKey = choiceOverrideKey(card.stimulus, choice, choiceIndex);
      const choiceOverride = choicePictureOverrides.get(choiceKey);
      const choiceWrapper = document.createElement('div');
      choiceWrapper.className = 'choice-item picture-choice';
      choiceWrapper.classList.add('click-change-target');
      choiceWrapper.appendChild(
        await renderPictureBox(choice, 'picture-box small', choiceOverride || null)
      );
      choicesArea.appendChild(choiceWrapper);
    } else if (card.relationship.choice === 'quantity') {
      choicesArea.appendChild(renderQuantityChoice(choice));
    } else {
      choicesArea.appendChild(renderTextChoice(choice));
    }
  }

  if (useChoicesTopLayout) {
    cardElement.appendChild(choicesArea);
    cardElement.appendChild(stimulusArea);
  } else {
    cardElement.appendChild(stimulusArea);
    cardElement.appendChild(choicesArea);
  }
  wrapper.appendChild(cardElement);

  // Tapping a picture opens the picture editor on that word.
  if (hasPictureStimulus) makeEditable(stimulusArea, card.stimulus);
  if (card.relationship.choice === 'picture') {
    card.choices.forEach((choice, choiceIndex) => {
      if (choice !== '—') makeEditable(choicesArea.children[choiceIndex], choice);
    });
  }

  return wrapper;
}

function chunkCards(cards, chunkSize) {
  const chunks = [];
  for (let i = 0; i < cards.length; i += chunkSize) {
    chunks.push(cards.slice(i, i + chunkSize));
  }
  return chunks;
}

function getCurrentTargets() {
  return parseTargetLines(targetsInput.value);
}

function cardsSignature() {
  return JSON.stringify({
    relationshipId: relationshipSelect.value,
    arraySize: arraySizeSelect.value,
    targets: targetsInput.value.trim(),
    constraints: getConstraints()
  });
}

async function generateCards() {
  const relationshipId = relationshipSelect.value;
  const arraySize = parseInt(arraySizeSelect.value, 10);
  const targetLines = targetsInput.value;

  if (!targetLines.trim()) {
    status.textContent = 'Please enter at least one target item.';
    preview.innerHTML = '';
    return false;
  }

  status.textContent = 'Generating cards...';

  const cards = buildCardSet({
    relationshipId,
    targetLines,
    arraySize,
    constraints: getConstraints()
  });
  currentCards = cards;
  currentCardsSignature = cardsSignature();

  await renderCardPages(cards);
  return true;
}

async function renderCardPages(cards) {
  preview.innerHTML = '';

  const isDoubleWidth = cardSizeSelect.value === 'double-width';
  const cardLayout = cardLayoutSelect.value;
  const cardsPerPage = isDoubleWidth ? 3 : 6;
  const pages = chunkCards(cards, cardsPerPage);
  for (const pageCards of pages) {
    const page = document.createElement('section');
    page.className = 'print-page';
    const grid = document.createElement('div');
    grid.className = 'cards-grid';
    if (isDoubleWidth) {
      grid.classList.add('cards-grid--double-width');
    }

    for (const [index, card] of pageCards.entries()) {
      grid.appendChild(await renderCard(card, index, { isDoubleWidth, cardLayout }));
    }

    page.appendChild(grid);
    preview.appendChild(page);
  }

  status.textContent = `Generated ${cards.length} cards across ${pages.length} page(s).`;
}

function createEmptyCell() {
  const cell = document.createElement('td');
  return cell;
}

function createWeeklyProgressSection() {
  const section = document.createElement('section');
  section.className = 'weekly-progress-section';

  const title = document.createElement('h3');
  title.className = 'weekly-progress-title';
  title.textContent = 'Weekly Progress';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'weekly-progress-table';

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const cornerHeading = document.createElement('th');
  cornerHeading.scope = 'col';
  cornerHeading.className = 'weekly-progress-corner';
  headerRow.appendChild(cornerHeading);

  days.forEach((day) => {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = day;
    headerRow.appendChild(heading);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (let score = 10; score >= 1; score -= 1) {
    const row = document.createElement('tr');

    const scoreHeading = document.createElement('th');
    scoreHeading.scope = 'row';
    scoreHeading.className = 'weekly-progress-score';
    scoreHeading.textContent = String(score);
    row.appendChild(scoreHeading);

    days.forEach(() => {
      const cell = document.createElement('td');
      const box = document.createElement('span');
      box.className = 'weekly-progress-box';
      box.setAttribute('aria-hidden', 'true');
      cell.appendChild(box);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  section.appendChild(table);

  return section;
}

function createDataSheet() {
  const targets = getCurrentTargets();

  if (targets.length === 0) {
    status.textContent = 'Please enter at least one target item.';
    preview.innerHTML = '';
    return;
  }

  preview.innerHTML = '';

  const page = document.createElement('section');
  page.className = 'print-page data-sheet-page';

  const actions = document.createElement('div');
  actions.className = 'data-sheet-actions no-print';

  const dataSheetPrintButton = document.createElement('button');
  dataSheetPrintButton.type = 'button';
  dataSheetPrintButton.textContent = 'Print Data Sheet';
  dataSheetPrintButton.addEventListener('click', () => window.print());
  actions.appendChild(dataSheetPrintButton);

  const title = document.createElement('h2');
  title.className = 'data-sheet-title';
  title.textContent = 'Data Collection Sheet';

  const header = document.createElement('div');
  header.className = 'data-sheet-header';

  const studentField = document.createElement('p');
  studentField.className = 'data-sheet-field';

  const studentLabel = document.createElement('span');
  studentLabel.className = 'data-sheet-label';
  studentLabel.textContent = 'Student:';
  studentField.appendChild(studentLabel);

  const studentLine = document.createElement('span');
  studentLine.className = 'data-sheet-line data-sheet-line-student';
  studentField.appendChild(studentLine);
  header.appendChild(studentField);

  const dateField = document.createElement('p');
  dateField.className = 'data-sheet-field';

  const dateLabel = document.createElement('span');
  dateLabel.className = 'data-sheet-label';
  dateLabel.textContent = 'Date:';
  dateField.appendChild(dateLabel);

  const dateLine = document.createElement('span');
  dateLine.className = 'data-sheet-line data-sheet-line-date';
  dateField.appendChild(dateLine);
  header.appendChild(dateField);

  const table = document.createElement('table');
  table.className = 'data-sheet-table';

  const headerRow = document.createElement('tr');
  ['Target', 'Trial 1', 'Trial 2', 'Trial 3', 'Trial 4', 'Trial 5', '%'].forEach((label) => {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    headerRow.appendChild(heading);
  });

  const thead = document.createElement('thead');
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  targets.forEach((target) => {
    const row = document.createElement('tr');
    const targetCell = document.createElement('td');
    targetCell.textContent = target.left;
    row.appendChild(targetCell);

    for (let i = 0; i < 6; i += 1) {
      row.appendChild(createEmptyCell());
    }

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  page.appendChild(actions);
  page.appendChild(title);
  page.appendChild(header);
  page.appendChild(table);
  page.appendChild(createWeeklyProgressSection());
  preview.appendChild(page);

  status.textContent = `Generated data sheet for ${targets.length} target(s).`;
}

function relationshipLabel(id) {
  return (RELATIONSHIPS.find((r) => r.id === id) || RELATIONSHIPS[0]).label;
}

// Finds the picture for a target's row on the data sheet: a picture you chose for that
// card first, then the ARASAAC symbol for it.
async function getTargetPicture(target, relationshipId) {
  if (TEXT_ONLY_RELATIONSHIPS.has(relationshipId)) return null;
  if (String(target).trim().length < 2) return null;

  const card = currentCards.find(
    (c) => c.sourceTarget.left === target && c.relationship.id === relationshipId
  );
  let term = target;
  if (card) {
    const pictureWord = card.relationship.stimulus === 'picture' ? card.stimulus : card.correctChoice;
    if (wordPictures.has(pictureWord)) return wordPictures.get(pictureWord);
    const stimulusOverride = pictureOverrides.get(overrideKey(card.stimulus));
    if (stimulusOverride && card.relationship.stimulus === 'picture') return stimulusOverride;
    for (const [key, value] of choicePictureOverrides) {
      const [stimulus, , choice] = key.split('::');
      if (stimulus === card.stimulus && choice === card.correctChoice) return value;
    }
    if (card.relationship.stimulus === 'picture') term = card.stimulus;
    else if (card.relationship.choice === 'picture') term = card.correctChoice;
  }
  const symbol = await fetchArasaacSymbol(term);
  return symbol ? { imageUrl: symbol.imageUrl, alt: term } : null;
}

function openTakeData() {
  const relationshipId = relationshipSelect.value;
  const useSet = currentSet && currentSet.relationshipId === relationshipId;
  openLiveDataSheet({
    preview,
    status,
    targetLabels: parseTargetLines(targetsInput.value).map((t) => t.left),
    program: useSet
      ? {
          programId: `set:${currentSet.id}`,
          relationshipId,
          label: `${currentSet.name} (${relationshipLabel(relationshipId)})`
        }
      : { programId: relationshipId, relationshipId, label: relationshipLabel(relationshipId) },
    getPicture: getTargetPicture
  });
}

// Everything needed to rebuild the exact cards later.
async function getCardSetSnapshot() {
  if (!targetsInput.value.trim()) return null;
  if (currentCards.length === 0 || currentCardsSignature !== cardsSignature()) {
    const made = await generateCards();
    if (!made) return null;
  }
  return {
    relationshipId: relationshipSelect.value,
    arraySize: arraySizeSelect.value,
    cardSize: cardSizeSelect.value,
    cardLayout: cardLayoutSelect.value,
    targetsText: targetsInput.value,
    constraints: getConstraints(),
    cards: currentCards.map((card) => ({
      stimulus: card.stimulus,
      correctChoice: card.correctChoice,
      choices: card.choices,
      sourceTarget: card.sourceTarget
    })),
    pictureOverrides: [...pictureOverrides.entries()],
    wordPictures: [...wordPictures.entries()],
    choicePictureOverrides: [...choicePictureOverrides.entries()]
  };
}

async function applyCardSet(set) {
  relationshipSelect.value = set.relationshipId;
  arraySizeSelect.value = set.arraySize;
  cardSizeSelect.value = set.cardSize;
  cardLayoutSelect.value = set.cardLayout;
  targetsInput.value = set.targetsText;
  document.getElementById('sameLength').checked = Boolean(set.constraints?.sameLength);
  document.getElementById('differentInitial').checked = Boolean(set.constraints?.differentInitial);
  document.getElementById('uniqueInitials').checked = Boolean(set.constraints?.uniqueInitials);
  document.getElementById('exactLength').value = set.constraints?.exactLength || '';

  pictureOverrides.clear();
  (set.pictureOverrides || []).forEach(([key, value]) => pictureOverrides.set(key, value));
  choicePictureOverrides.clear();
  (set.choicePictureOverrides || []).forEach(([key, value]) => choicePictureOverrides.set(key, value));
  wordPictures.clear();
  (set.wordPictures || []).forEach(([key, value]) => wordPictures.set(key, value));

  const relationship = RELATIONSHIPS.find((r) => r.id === set.relationshipId) || RELATIONSHIPS[0];
  currentCards = set.cards.map((card) => ({ ...card, relationship }));
  currentCardsSignature = cardsSignature();
  await renderCardPages(currentCards);
}

initRelationshipOptions();
initCardSets({
  getSnapshot: getCardSetSnapshot,
  applySet: applyCardSet,
  takeData: async (set) => {
    await applyCardSet(set);
    openTakeData();
  },
  onCurrentChange: (set) => {
    currentSet = set;
  },
  relationshipLabel
});
generateButton.addEventListener('click', () => {
  generateCards();
});
createDataSheetButton.addEventListener('click', () => {
  createDataSheet();
});
editPicturesButton.addEventListener('click', async () => {
  if (currentCards.length === 0 || currentCardsSignature !== cardsSignature()) {
    const made = await generateCards();
    if (!made) return;
  }
  pictureEditor.openList();
});
takeDataButton.addEventListener('click', () => {
  openTakeData();
});
printButton.addEventListener('click', () => window.print());
