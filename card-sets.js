// Saved card sets: the targets, settings, exact cards and picture choices, kept in this
// device's browser so a set can be reopened, reprinted, or used to take data.

const STORAGE_KEY = 'cardmaker-card-sets-v1';
const MAX_UPLOAD_CHARS = 150_000; // uploaded photos bigger than this get shrunk before saving

export function loadSets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Could not read saved card sets', error);
    return [];
  }
}

function writeSets(sets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    return true;
  } catch (error) {
    console.warn('Could not save card sets', error);
    return false;
  }
}

function makeId() {
  return `set${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Shrinks an uploaded photo (data URL) so a set with photos still fits in browser storage.
function shrinkDataUrl(dataUrl, maxSide = 500) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function shrinkOverrides(entries) {
  const out = [];
  for (const [key, value] of entries) {
    if (value?.imageUrl?.startsWith('data:') && value.imageUrl.length > MAX_UPLOAD_CHARS) {
      out.push([key, { ...value, imageUrl: await shrinkDataUrl(value.imageUrl) }]);
    } else {
      out.push([key, value]);
    }
  }
  return out;
}

function formatSavedDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// getSnapshot(): Promise of everything about the current cards (generates them first if needed).
// applySet(set): puts a saved set back on screen.
// takeData(set): opens the set and starts the data sheet.
// onCurrentChange(set|null): called when the set being worked on changes.
export function initCardSets({ getSnapshot, applySet, takeData, onCurrentChange, relationshipLabel }) {
  const nameInput = document.getElementById('setName');
  const saveButton = document.getElementById('saveSet');
  const newButton = document.getElementById('newSet');
  const statusLine = document.getElementById('setStatus');
  const list = document.getElementById('setList');
  const workingOn = document.getElementById('setCurrent');

  let currentId = null;

  function setStatus(text, isError = false) {
    statusLine.textContent = text;
    statusLine.classList.toggle('sets-status--error', isError);
  }

  function setCurrent(set) {
    currentId = set ? set.id : null;
    nameInput.value = set ? set.name : '';
    workingOn.textContent = set ? `Working on: ${set.name}` : '';
    newButton.hidden = !set;
    onCurrentChange(set);
    render();
  }

  function render() {
    const sets = loadSets().sort((a, b) => a.name.localeCompare(b.name));
    list.innerHTML = '';
    if (sets.length === 0) {
      list.append(el('li', 'sets-empty', 'No saved sets yet. Make your cards, name them above, and save.'));
      return;
    }
    sets.forEach((set) => {
      const li = el('li', set.id === currentId ? 'sets-item sets-item--current' : 'sets-item');
      const info = el('div', 'sets-info');
      info.append(
        el('strong', 'sets-name', set.name),
        el(
          'span',
          'sets-meta',
          `${relationshipLabel(set.relationshipId)}, ${set.cards.length} card${set.cards.length === 1 ? '' : 's'}, saved ${formatSavedDate(set.savedAt)}`
        )
      );

      const openBtn = el('button', 'sets-btn', 'Open');
      openBtn.type = 'button';
      openBtn.addEventListener('click', async () => {
        await applySet(set);
        setCurrent(set);
        setStatus(`Opened ${set.name}.`);
      });

      const dataBtn = el('button', 'sets-btn sets-btn--data', 'Take data');
      dataBtn.type = 'button';
      dataBtn.addEventListener('click', async () => {
        setCurrent(set);
        await takeData(set);
        setStatus('');
      });

      const deleteBtn = el('button', 'sets-btn sets-btn--danger', 'Delete');
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', () => {
        if (!window.confirm(`Delete the card set “${set.name}”? Data you already took stays saved.`)) return;
        writeSets(loadSets().filter((s) => s.id !== set.id));
        if (set.id === currentId) setCurrent(null);
        else render();
        setStatus(`Deleted ${set.name}.`);
      });

      li.append(info, openBtn, dataBtn, deleteBtn);
      list.append(li);
    });
  }

  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus('Give the set a name first, like “Ava, CVC words.”', true);
      nameInput.focus();
      return;
    }

    const snapshot = await getSnapshot();
    if (!snapshot) {
      setStatus('Enter at least one target item before saving.', true);
      return;
    }

    const sets = loadSets();
    const sameName = sets.find((s) => s.name.toLowerCase() === name.toLowerCase());
    let id = currentId && sets.some((s) => s.id === currentId) ? currentId : null;

    if (sameName && sameName.id !== id) {
      if (!window.confirm(`You already have a set called “${sameName.name}.” Replace it?`)) return;
      id = sameName.id;
    }
    // Renaming the open set saves it as a new set and leaves the original alone.
    if (id && !sameName) {
      const original = sets.find((s) => s.id === id);
      if (original && original.name.toLowerCase() !== name.toLowerCase()) id = null;
    }

    setStatus('Saving…');
    const set = {
      ...snapshot,
      pictureOverrides: await shrinkOverrides(snapshot.pictureOverrides),
      choicePictureOverrides: await shrinkOverrides(snapshot.choicePictureOverrides),
      id: id || makeId(),
      name,
      savedAt: Date.now()
    };

    const next = sets.filter((s) => s.id !== set.id);
    next.push(set);
    if (!writeSets(next)) {
      setStatus(
        'This set didn’t save. This device’s storage is full, usually from uploaded photos. Try fewer or smaller uploaded pictures.',
        true
      );
      return;
    }
    setCurrent(set);
    setStatus(`Saved ${name}.`);
  });

  newButton.addEventListener('click', () => {
    setCurrent(null);
    setStatus('Starting a new set. Your saved sets are still in the list.');
  });

  newButton.hidden = true;
  render();

  return {
    getCurrentId: () => currentId,
    clearCurrent: () => setCurrent(null)
  };
}
