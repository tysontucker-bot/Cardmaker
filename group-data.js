// Group sessions: every student in the group gets a panel on one screen with big
// +, − and P buttons. Data lands in the same saved sessions as the one-student sheet,
// so weekly graphs, history and CSV export all include group data.

import { loadStore, saveStore, makeId, TRIAL_COUNT } from './live-data.js?v=20261021f';
import {
  scoreSession,
  scoreTrials,
  emptyTrials,
  mergeTargets,
  sameStudent,
  toISODate,
  parseISODate,
  programOf,
  recordTrial,
  nextTargetIndex,
  nextStudentIndex
} from './data-logic.js?v=20261021f';

const GROUPS_KEY = 'cardmaker-groups-v1';
const CURRENT_CARDS = ''; // a student assigned to whatever cards are open

function loadGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null');
    if (parsed && Array.isArray(parsed.groups)) return parsed;
  } catch (error) {
    console.warn('Could not read saved groups', error);
  }
  return { groups: [], lastGroupId: null };
}

function saveGroups(data) {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn('Could not save groups', error);
    return false;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const btn = el('button', className, text);
  btn.type = 'button';
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

const MARK_LABEL = { '+': 'correct', '-': 'incorrect', P: 'prompted' };

// listSets(): [{ id, name }] of saved card sets.
// currentCardsLabel(): a label for the cards on screen, or null if none.
// resolveAssignment(setId): { program, targets, getPicture, textOnly } or null.
// openStudentSheet(name, setId): opens the one-student sheet for review.
export function openGroupSession(options) {
  const { preview, status } = options;
  const groupsData = loadGroups();
  const lastGroup = groupsData.groups.find((g) => g.id === groupsData.lastGroupId) || null;
  showSetup(options, groupsData, lastGroup ? structuredClone(lastGroup) : null);
  status.textContent = '';
  preview.scrollIntoView?.({ block: 'start' });
}

// ── Setup ────────────────────────────────────────────────────────────────────

function showSetup(options, groupsData, editing) {
  const { preview, listSets, currentCardsLabel } = options;
  const sets = listSets();
  const currentLabel = currentCardsLabel();

  const draft =
    editing ||
    {
      id: null,
      name: '',
      students: [
        { name: '', setId: CURRENT_CARDS },
        { name: '', setId: CURRENT_CARDS }
      ]
    };

  preview.innerHTML = '';
  const page = el('section', 'print-page group-setup no-print');
  page.append(el('h2', 'data-sheet-title', 'Group session'));

  // Saved groups
  const savedRow = el('div', 'group-saved');
  if (groupsData.groups.length) {
    savedRow.append(el('span', 'group-saved-label', 'Your groups'));
    groupsData.groups
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((group) => {
        const chip = button(group.name, 'live-chip', () =>
          showSetup(options, groupsData, structuredClone(group))
        );
        if (group.id === draft.id) chip.classList.add('live-chip--current');
        savedRow.append(chip);
      });
  }
  savedRow.append(
    button('+ New group', 'live-chip group-new-chip', () => showSetup(options, groupsData, null))
  );
  page.append(savedRow);

  // Group editor
  const editor = el('div', 'group-editor');
  const nameLabel = el('label', 'group-name-label');
  nameLabel.append(el('span', '', 'Group name'));
  const nameInput = el('input', 'live-input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Like “Morning reading group”';
  nameInput.value = draft.name;
  nameLabel.append(nameInput);
  editor.append(nameLabel);

  const setOptions = () => {
    const opts = [];
    if (currentLabel) opts.push({ value: CURRENT_CARDS, label: `Cards on screen now (${currentLabel})` });
    sets.forEach((s) => opts.push({ value: s.id, label: s.name }));
    return opts;
  };

  if (!currentLabel && sets.length === 0) {
    editor.append(
      el(
        'p',
        'live-save live-save--error',
        'Make some cards (or open a saved card set) first, so each student has targets to work on.'
      )
    );
  }

  const studentList = el('div', 'group-students');
  editor.append(el('p', 'group-students-head', 'Students and what each one is working on'));
  editor.append(studentList);

  function renderStudents() {
    studentList.innerHTML = '';
    draft.students.forEach((student, index) => {
      const row = el('div', 'group-student-row');
      const input = el('input', 'live-input');
      input.type = 'text';
      input.placeholder = `Student ${index + 1}`;
      input.value = student.name;
      input.setAttribute('aria-label', `Student ${index + 1} name`);
      input.addEventListener('input', () => {
        student.name = input.value;
      });

      const select = el('select', 'group-set-select');
      select.setAttribute('aria-label', `Card set for student ${index + 1}`);
      const opts = setOptions();
      opts.forEach((opt) => {
        const option = el('option', '', opt.label);
        option.value = opt.value;
        select.append(option);
      });
      if (!opts.some((opt) => opt.value === student.setId)) {
        const missing = el('option', '', 'Pick a card set');
        missing.value = '__missing';
        select.prepend(missing);
        select.value = '__missing';
      } else {
        select.value = student.setId;
      }
      select.addEventListener('change', () => {
        student.setId = select.value === '__missing' ? CURRENT_CARDS : select.value;
      });

      const remove = button('Remove', 'live-mini-btn live-mini-btn--danger', () => {
        draft.students.splice(index, 1);
        renderStudents();
      });
      remove.setAttribute('aria-label', `Remove student ${index + 1}`);
      remove.disabled = draft.students.length === 1;

      row.append(input, select, remove);
      studentList.append(row);
    });
  }
  renderStudents();

  const studentActions = el('div', 'group-student-actions');
  studentActions.append(
    button('+ Add student', 'live-btn live-btn--quiet', () => {
      draft.students.push({ name: '', setId: draft.students.at(-1)?.setId ?? CURRENT_CARDS });
      renderStudents();
      studentList.querySelector('.group-student-row:last-child input')?.focus();
    })
  );

  const sameAll = el('label', 'group-same-all');
  sameAll.append(el('span', '', 'Same set for everyone:'));
  const sameSelect = el('select', 'group-set-select');
  const placeholder = el('option', '', 'Choose…');
  placeholder.value = '__none';
  sameSelect.append(placeholder);
  setOptions().forEach((opt) => {
    const option = el('option', '', opt.label);
    option.value = opt.value;
    sameSelect.append(option);
  });
  sameSelect.addEventListener('change', () => {
    if (sameSelect.value === '__none') return;
    draft.students.forEach((s) => {
      s.setId = sameSelect.value;
    });
    sameSelect.value = '__none';
    renderStudents();
  });
  sameAll.append(sameSelect);
  studentActions.append(sameAll);
  editor.append(studentActions);
  page.append(editor);

  // Date + start
  const startRow = el('div', 'group-start-row');
  const dateLabel = el('label', 'live-field live-field--date');
  dateLabel.append(el('span', 'data-sheet-label', 'Date'));
  const dateInput = el('input', 'live-input');
  dateInput.type = 'date';
  dateInput.value = toISODate();
  dateLabel.append(dateInput);

  const message = el('p', 'live-save');
  message.setAttribute('aria-live', 'polite');

  const saveBtn = button('Save group', 'live-btn live-btn--quiet', () => {
    if (persistGroup()) message.textContent = `Saved ${draft.name.trim()}.`;
  });
  const deleteBtn = button('Delete group', 'live-btn live-btn--quiet group-delete', () => {
    if (!draft.id) return;
    if (!window.confirm(`Delete the group “${draft.name}”? Data you already took stays saved.`)) return;
    groupsData.groups = groupsData.groups.filter((g) => g.id !== draft.id);
    saveGroups(groupsData);
    showSetup(options, groupsData, null);
  });
  deleteBtn.hidden = !draft.id;
  const startBtn = button('Start group session', 'live-btn group-start-btn', start);

  startRow.append(dateLabel, saveBtn, deleteBtn, startBtn);
  page.append(startRow, message);
  preview.append(page);

  function persistGroup() {
    const name = nameInput.value.trim();
    if (!name) {
      message.textContent = 'Name the group to save it, like “Morning reading group.”';
      message.classList.add('live-save--error');
      nameInput.focus();
      return false;
    }
    message.classList.remove('live-save--error');
    draft.name = name;
    if (!draft.id) draft.id = makeId();
    const cleaned = {
      ...draft,
      students: draft.students.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), setId: s.setId }))
    };
    groupsData.groups = groupsData.groups.filter((g) => g.id !== cleaned.id);
    groupsData.groups.push(cleaned);
    groupsData.lastGroupId = cleaned.id;
    saveGroups(groupsData);
    deleteBtn.hidden = false;
    return true;
  }

  function start() {
    message.classList.add('live-save--error');
    const students = draft.students.filter((s) => s.name.trim());
    if (students.length === 0) {
      message.textContent = 'Type at least one student’s name.';
      studentList.querySelector('input')?.focus();
      return;
    }
    const names = students.map((s) => s.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      message.textContent = 'Two students have the same name. Add an initial so their data stays separate.';
      return;
    }
    const assignments = [];
    for (const student of students) {
      const assignment = options.resolveAssignment(student.setId);
      if (!assignment || assignment.targets.length === 0) {
        message.textContent = `Pick a card set for ${student.name.trim()}.`;
        return;
      }
      assignments.push({ name: student.name.trim(), setId: student.setId, ...assignment });
    }
    message.classList.remove('live-save--error');
    if (nameInput.value.trim()) persistGroup();
    showSession(options, groupsData, draft, assignments, dateInput.value || toISODate());
  }
}

// ── Session ──────────────────────────────────────────────────────────────────

function showSession(options, groupsData, group, assignments, date) {
  const { preview, status } = options;
  const store = loadStore();
  const pictureCache = new Map();
  const undoStack = [];

  // One entry per student: their saved session (found or new) and which target is up.
  const students = assignments.map((a) => {
    const existing = store.sessions.find(
      (s) => s.date === date && programOf(s) === a.program.programId && sameStudent(s.student, a.name)
    );
    let session;
    if (existing) {
      existing.rows = mergeTargets(existing.rows, a.targets, TRIAL_COUNT);
      session = existing;
    } else {
      session = {
        id: makeId(),
        student: a.name,
        date,
        programId: a.program.programId,
        relationshipId: a.program.relationshipId,
        relationshipLabel: a.program.label,
        rows: a.targets.map((target) => ({ target, trials: emptyTrials(TRIAL_COUNT) })),
        updatedAt: null
      };
    }
    return { ...a, session, selected: nextTargetIndex(session.rows, -1) };
  });

  const isFinished = (i) => nextTargetIndex(students[i].session.rows, -1) === -1;
  let nextUp = nextStudentIndex(isFinished, students.length, -1);

  preview.innerHTML = '';
  const page = el('section', 'print-page group-session no-print');

  const bar = el('div', 'group-bar');
  const titleBox = el('div', 'group-bar-title');
  titleBox.append(
    el('h2', 'data-sheet-title', group.name?.trim() || 'Group session'),
    el(
      'p',
      'live-program',
      parseISODate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    )
  );
  const undoBtn = button('Undo', 'live-btn live-btn--quiet group-undo', undo);
  undoBtn.disabled = true;
  const endBtn = button('End session', 'live-btn', () => showSummary(options, groupsData, group, students, date));
  bar.append(titleBox, undoBtn, endBtn);

  const key = el('p', 'live-key');
  key.innerHTML =
    'One tap per trial, on the row for the card you presented: ' +
    '<span class="mark mark--plus">+</span> correct, <span class="mark mark--minus">−</span> incorrect, ' +
    '<span class="mark mark--prompt">P</span> prompted. The next student lights up after each score.';

  const saveLine = el('p', 'live-save');
  saveLine.setAttribute('aria-live', 'polite');

  const grid = el('div', 'group-grid');
  page.append(bar, key, grid, saveLine);
  preview.append(page);

  const panels = students.map((student, index) => {
    const panel = el('article', 'group-panel');
    panel.setAttribute('aria-label', student.name);
    grid.append(panel);
    return panel;
  });

  // Pictures are looked up once; after that they draw instantly so rows don't flicker.
  const resolvedPictures = new Map();

  function pictureFor(student, target) {
    const cacheKey = `${student.program.programId}::${target}`;
    if (student.textOnly) return Promise.resolve(null);
    if (!pictureCache.has(cacheKey)) {
      pictureCache.set(
        cacheKey,
        Promise.resolve(student.getPicture(target))
          .catch(() => null)
          .then((picture) => {
            resolvedPictures.set(cacheKey, picture);
            return picture;
          })
      );
    }
    return pictureCache.get(cacheKey);
  }

  function fillPicture(holder, student, target, sizeClass) {
    holder.innerHTML = '';
    const text = el('span', `group-pic-text ${sizeClass}-text`, target);
    holder.append(text);
    const show = (picture) => {
      if (!picture) return;
      const img = el('img', sizeClass);
      img.src = picture.imageUrl;
      img.alt = target;
      img.addEventListener('error', () => {
        img.remove();
        text.hidden = false;
      });
      text.hidden = true;
      holder.prepend(img);
    };
    const cacheKey = `${student.program.programId}::${target}`;
    if (resolvedPictures.has(cacheKey)) {
      show(resolvedPictures.get(cacheKey));
      return;
    }
    pictureFor(student, target).then((picture) => {
      if (holder.isConnected) show(picture);
    });
  }

  function renderPanel(index) {
    const student = students[index];
    const panel = panels[index];
    const { correct, scored, percent } = scoreSession(student.session);
    const finished = isFinished(index);

    panel.innerHTML = '';
    panel.classList.toggle('group-panel--next', index === nextUp);
    panel.classList.toggle('group-panel--done', finished);

    const head = el('div', 'group-panel-head');
    const nameBox = el('div', 'group-panel-name');
    nameBox.append(el('strong', '', student.name));
    if (index === nextUp) nameBox.append(el('span', 'group-next-badge', 'Next up'));
    const scoreText = el(
      'span',
      'group-panel-score',
      scored ? `${percent}%, ${correct} of ${scored}` : 'No trials yet'
    );
    head.append(nameBox, scoreText);
    panel.append(head);
    panel.append(el('p', 'group-panel-program', student.program.label));

    if (finished) {
      panel.append(el('p', 'group-done-msg', `All ${TRIAL_COUNT} trials scored on every target.`));
    }

    // One row per target, each with its own +, − and P, so any card is one tap.
    // The ringed row is the card to grab next if you're rotating through them.
    const list = el('div', 'group-rows');
    student.session.rows.forEach((row, rowIndex) => {
      const full = !row.trials.includes('');
      const line = el('div', 'group-row');
      if (rowIndex === student.selected && !finished) line.classList.add('group-row--suggested');
      if (full) line.classList.add('group-row--full');

      const pic = el('div', 'group-row-pic');
      fillPicture(pic, student, row.target, 'group-row-img');

      const dots = el('div', 'group-dots');
      dots.setAttribute('aria-hidden', 'true');
      row.trials.forEach((mark) => {
        const dot = el('span', 'group-dot', mark === '-' ? '−' : mark);
        dot.dataset.mark = mark || 'empty';
        dots.append(dot);
      });

      const marks = el('div', 'group-row-marks');
      [
        ['+', '+', 'group-mark--plus'],
        ['-', '−', 'group-mark--minus'],
        ['P', 'P', 'group-mark--prompt']
      ].forEach(([mark, label, cls]) => {
        const btn = button(label, `group-mark ${cls}`, () => scoreTrial(index, rowIndex, mark));
        btn.disabled = full;
        btn.setAttribute('aria-label', `${student.name}, ${row.target}: ${MARK_LABEL[mark]}`);
        marks.append(btn);
      });

      line.append(pic, dots, marks);
      list.append(line);
    });
    panel.append(list);
  }

  function renderAll() {
    students.forEach((_, i) => renderPanel(i));
    undoBtn.disabled = undoStack.length === 0;
    const last = undoStack.at(-1);
    undoBtn.textContent = last
      ? `Undo ${students[last.studentIndex].name}’s ${last.mark === '-' ? '−' : last.mark}`
      : 'Undo';
  }

  function persist() {
    let ok = true;
    students.forEach((student) => {
      if (student.session.updatedAt && !store.sessions.includes(student.session)) {
        store.sessions.push(student.session);
      }
    });
    ok = saveStore(store);
    saveLine.textContent = ok
      ? `Saved on this device at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Could not save. This browser may be in private mode, so export a CSV before closing.';
    saveLine.classList.toggle('live-save--error', !ok);
  }

  function scoreTrial(index, rowIndex, mark) {
    const student = students[index];
    const slot = recordTrial(student.session.rows[rowIndex], mark);
    if (slot === -1) return;
    student.session.updatedAt = Date.now();
    undoStack.push({ studentIndex: index, rowIndex, slot, mark, prevNext: nextUp });
    student.selected = nextTargetIndex(student.session.rows, rowIndex);
    nextUp = nextStudentIndex(isFinished, students.length, index);
    persist();
    renderAll();
    if (nextUp === -1) {
      saveLine.textContent = 'Every student is finished. Tap End session to see the results.';
    } else if (nextUp !== index) {
      panels[nextUp].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    const student = students[last.studentIndex];
    student.session.rows[last.rowIndex].trials[last.slot] = '';
    student.session.updatedAt = Date.now();
    student.selected = last.rowIndex;
    nextUp = last.studentIndex;
    persist();
    renderAll();
  }

  renderAll();
  page.scrollIntoView({ block: 'start' });
  status.textContent = `Group session with ${students.length} student${students.length === 1 ? '' : 's'}. Marks save as you tap.`;
}

// ── Summary ──────────────────────────────────────────────────────────────────

function showSummary(options, groupsData, group, students, date) {
  const { preview, openStudentSheet } = options;
  preview.innerHTML = '';
  const page = el('section', 'print-page group-summary');
  page.append(el('h2', 'data-sheet-title', `${group.name?.trim() || 'Group session'} results`));
  page.append(
    el(
      'p',
      'live-program',
      parseISODate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    )
  );

  const table = el('table', 'data-sheet-table group-summary-table');
  const head = el('tr');
  ['Student', 'Program', 'Trials', '%', ''].forEach((label) => {
    const th = el('th', '', label);
    th.scope = 'col';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const tbody = el('tbody');
  students.forEach((student) => {
    const { correct, scored, percent } = scoreSession(student.session);
    const tr = el('tr');
    tr.append(
      el('td', 'live-target', student.name),
      el('td', '', student.program.label),
      el('td', '', scored ? `${correct} of ${scored} correct` : 'None'),
      el('td', 'live-pct', percent === null ? '—' : `${percent}%`)
    );
    const action = el('td', 'no-print');
    action.append(
      button('Data sheet', 'live-mini-btn', () => openStudentSheet(student.name, student.setId, date))
    );
    tr.append(action);
    tbody.append(tr);
  });
  table.append(tbody);
  const wrap = el('div', 'live-table-wrap');
  wrap.append(table);
  page.append(wrap);

  const actions = el('div', 'live-actions no-print group-summary-actions');
  actions.append(
    button('Back to the session', 'live-btn live-btn--quiet', () =>
      showSession(
        options,
        groupsData,
        group,
        students.map(({ session, selected, ...assignment }) => assignment),
        date
      )
    ),
    button('Print results', 'live-btn live-btn--quiet', () => window.print()),
    button('New group session', 'live-btn', () => showSetup(options, groupsData, structuredClone(group)))
  );
  page.append(actions);
  preview.append(page);
}
