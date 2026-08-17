import { RELATIONSHIPS, buildCardSet } from '/home/runner/work/Cardmaker/Cardmaker/logic.js';

const relationshipSelect = document.getElementById('relationship');
const arraySizeSelect = document.getElementById('arraySize');
const targetsInput = document.getElementById('targets');
const generateButton = document.getElementById('generate');
const printButton = document.getElementById('print');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

const symbolCache = new Map();

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

async function renderPictureBox(label, cssClass = 'picture-box') {
  const box = document.createElement('div');
  box.className = cssClass;

  const symbol = await fetchArasaacSymbol(label);
  if (symbol) {
    box.innerHTML = `<img src="${symbol.imageUrl}" alt="${label}" /><small><a href="${symbol.sourceUrl}" target="_blank" rel="noopener noreferrer">${symbol.attribution}</a></small>`;
  } else {
    box.innerHTML = `<div class="picture-fallback" aria-label="No symbol found for ${label}">${label}</div><small>No ARASAAC symbol found</small>`;
  }

  return box;
}

async function renderCard(card, index) {
  const cardElement = document.createElement('article');
  cardElement.className = 'instruction-card';
  cardElement.setAttribute('aria-label', `Card ${index + 1}`);

  const stimulusArea = document.createElement('div');
  stimulusArea.className = 'stimulus-area';

  if (card.relationship.stimulus === 'picture') {
    stimulusArea.appendChild(await renderPictureBox(card.stimulus));
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

  return cardElement;
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
