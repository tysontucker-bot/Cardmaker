import {
  MARK_NAMES,
  scoreTrials,
  scoreSession,
  emptyTrials,
  mergeTargets,
  hasAnyMarks,
  sameStudent,
  toISODate,
  parseISODate,
  schoolWeek,
  weeklyPercents,
  boxesFilled,
  sessionsToCSV,
  programOf
} from './data-logic.js?v=20261021g';

const STORAGE_KEY = 'cardmaker-live-data-v1';
export const TRIAL_COUNT = 5;

// ── Storage (saved on this device's browser) ────────────────────────────────

export function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed && Array.isArray(parsed.sessions)) return parsed;
  } catch (error) {
    console.warn('Could not read saved data', error);
  }
  return { sessions: [], lastStudent: '' };
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    console.warn('Could not save data', error);
    return false;
  }
}

export function makeId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatShortDate(iso) {
  return parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(percent) {
  return percent === null ? '—' : `${percent}%`;
}

// ── Main view ────────────────────────────────────────────────────────────────

function programFromSession(s) {
  return { programId: programOf(s), relationshipId: s.relationshipId, label: s.relationshipLabel };
}

// program: { programId, relationshipId, label }. A saved card set is its own program,
// so two sets that use the same matching relationship keep separate graphs.
// getPicture(target, relationshipId) resolves to { imageUrl, alt } or null.
export function openLiveDataSheet({ preview, status, targetLabels, program, getPicture, student, date }) {
  if (targetLabels.length === 0) {
    status.textContent = 'Please enter at least one target item.';
    preview.innerHTML = '';
    return;
  }

  const store = loadStore();
  const pictureCache = new Map();

  // The session on screen. It is only written to storage once a box is tapped.
  let session = null;

  preview.innerHTML = '';
  const page = el('section', 'print-page data-sheet-page live-sheet');

  // Top buttons
  const actions = el('div', 'live-actions no-print');
  const printBtn = el('button', 'live-btn', 'Print data sheet');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  const exportBtn = el('button', 'live-btn live-btn--quiet', 'Export CSV');
  exportBtn.type = 'button';
  const undoBtn = el('button', 'live-btn live-btn--quiet live-undo', 'Undo');
  undoBtn.type = 'button';
  undoBtn.disabled = true;
  const clearBtn = el('button', 'live-btn live-btn--quiet', 'Clear this session');
  clearBtn.type = 'button';
  actions.append(undoBtn, printBtn, exportBtn, clearBtn);

  const title = el('h2', 'data-sheet-title', 'Data Collection Sheet');
  const programLine = el('p', 'live-program');

  // Student + date
  const header = el('div', 'live-header');
  const studentLabel = el('label', 'live-field');
  studentLabel.append(el('span', 'data-sheet-label', 'Student'));
  const studentInput = el('input', 'live-input');
  studentInput.type = 'text';
  studentInput.autocomplete = 'off';
  studentInput.placeholder = 'Student name';
  studentInput.setAttribute('list', 'live-student-list');
  const studentList = el('datalist');
  studentList.id = 'live-student-list';
  studentLabel.append(studentInput, studentList);

  const dateLabel = el('label', 'live-field live-field--date');
  dateLabel.append(el('span', 'data-sheet-label', 'Date'));
  const dateInput = el('input', 'live-input');
  dateInput.type = 'date';
  dateLabel.append(dateInput);
  header.append(studentLabel, dateLabel);

  // One-tap student switching for group sessions.
  const chips = el('div', 'live-chips no-print');

  const key = el('p', 'live-key no-print');
  key.innerHTML =
    'One tap per trial: <span class="mark mark--plus">+</span> correct, ' +
    '<span class="mark mark--minus">−</span> incorrect, <span class="mark mark--prompt">P</span> prompted. ' +
    'Tap a scored box to clear it.';

  const tableWrap = el('div', 'live-table-wrap');
  const table = el('table', 'live-table');
  tableWrap.append(table);

  const saveLine = el('p', 'live-save no-print');
  saveLine.setAttribute('aria-live', 'polite');

  const weekly = el('section', 'weekly-progress-section');
  const history = el('section', 'live-history no-print');

  page.append(actions, title, programLine, header, chips, key, tableWrap, saveLine, weekly, history);
  preview.append(page);

  // ── Session lookup ──

  function findSession(student, date, programId) {
    return store.sessions.find(
      (s) => s.date === date && programOf(s) === programId && sameStudent(s.student, student)
    );
  }

  function loadSession({ student, date, program, addTargets }) {
    const existing = findSession(student, date, program.programId);
    if (existing) {
      if (addTargets) existing.rows = mergeTargets(existing.rows, addTargets, TRIAL_COUNT);
      session = existing;
    } else {
      session = {
        id: makeId(),
        student: student.trim(),
        date,
        programId: program.programId,
        relationshipId: program.relationshipId,
        relationshipLabel: program.label,
        rows: (addTargets || []).map((target) => ({ target, trials: emptyTrials(TRIAL_COUNT) })),
        updatedAt: null
      };
    }
    undoStack = [];
    studentInput.value = session.student || student;
    dateInput.value = session.date;
    programLine.textContent = `Program: ${session.relationshipLabel}`;
    renderAll();
  }

  function isStored(s) {
    return store.sessions.includes(s);
  }

  function persist() {
    session.student = studentInput.value.trim();
    session.updatedAt = Date.now();
    if (!isStored(session)) store.sessions.push(session);
    store.lastStudent = session.student;
    const ok = saveStore(store);
    saveLine.textContent = ok
      ? `Saved on this device at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Could not save. This browser may be in private mode, so export a CSV before closing.';
    saveLine.classList.toggle('live-save--error', !ok);
  }

  // ── Rendering ──

  // The target cell shows the picture so you can find the row at a glance.
  // Letters, numbers and anything without a picture stay as large text.
  function renderTargetCell(row) {
    const td = el('td', 'live-target');
    const label = el('span', 'live-target-text', row.target);
    td.append(label);
    const cacheKey = `${session.relationshipId}::${row.target}`;
    const show = (picture) => {
      if (!picture) return;
      const img = el('img', 'live-target-img');
      img.src = picture.imageUrl;
      img.alt = row.target;
      img.addEventListener('error', () => {
        img.remove();
        td.classList.remove('live-target--picture');
      });
      td.classList.add('live-target--picture');
      td.prepend(img);
    };
    if (pictureCache.has(cacheKey)) {
      show(pictureCache.get(cacheKey));
    } else if (getPicture) {
      Promise.resolve(getPicture(row.target, session.relationshipId))
        .catch(() => null)
        .then((picture) => {
          pictureCache.set(cacheKey, picture);
          show(picture);
        });
    }
    return td;
  }

  // One tap per trial: the +, − and P buttons fill the next open trial for that target.
  // Tapping a filled trial box clears it; Undo reverses the last tap of either kind.
  let undoStack = [];

  function needsStudent() {
    if (studentInput.value.trim()) return false;
    saveLine.textContent = 'Type the student’s name first so this session saves to them.';
    saveLine.classList.add('live-save--error');
    studentInput.focus();
    return true;
  }

  function changed() {
    persist();
    renderTable();
    renderWeekly();
    renderHistory();
  }

  function scoreRow(rowIndex, mark) {
    if (needsStudent()) return;
    const row = session.rows[rowIndex];
    const slot = row.trials.indexOf('');
    if (slot === -1) return;
    row.trials[slot] = mark;
    undoStack.push({ rowIndex, slot, previous: '' });
    changed();
  }

  function clearTrial(rowIndex, slot) {
    const row = session.rows[rowIndex];
    if (!row.trials[slot]) return;
    undoStack.push({ rowIndex, slot, previous: row.trials[slot] });
    // The next tap on that target fills this box again.
    row.trials[slot] = '';
    changed();
  }

  function undoLast() {
    const last = undoStack.pop();
    if (!last) return;
    session.rows[last.rowIndex].trials[last.slot] = last.previous;
    changed();
  }

  function renderTable() {
    table.innerHTML = '';
    undoBtn.disabled = undoStack.length === 0;
    const thead = el('thead');
    const headRow = el('tr');
    const headings = [
      ['Target', 'live-col-target'],
      ['Score', 'live-col-score no-print'],
      ...Array.from({ length: TRIAL_COUNT }, (_, i) => [`${i + 1}`, 'live-col-trial']),
      ['%', 'live-col-pct']
    ];
    headings.forEach(([label, cls]) => {
      const th = el('th', cls, label);
      th.scope = 'col';
      if (cls === 'live-col-trial') th.setAttribute('aria-label', `Trial ${label}`);
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = el('tbody');
    session.rows.forEach((row, rowIndex) => {
      const tr = el('tr');
      tr.append(renderTargetCell(row));

      const full = !row.trials.includes('');
      const scoreCell = el('td', 'live-score-cell no-print');
      const marks = el('div', 'live-marks');
      [
        ['+', '+', 'live-mark--plus'],
        ['-', '−', 'live-mark--minus'],
        ['P', 'P', 'live-mark--prompt']
      ].forEach(([mark, label, cls]) => {
        const btn = el('button', `live-mark ${cls}`, label);
        btn.type = 'button';
        btn.disabled = full;
        btn.setAttribute('aria-label', `${row.target}: ${MARK_NAMES[mark]}`);
        btn.addEventListener('click', () => scoreRow(rowIndex, mark));
        marks.append(btn);
      });
      scoreCell.append(marks);
      tr.append(scoreCell);

      row.trials.forEach((value, trialIndex) => {
        const td = el('td', 'live-trial-cell');
        const box = el('button', 'trial-btn', value === '-' ? '−' : value);
        box.type = 'button';
        box.dataset.mark = value || 'empty';
        box.disabled = !value;
        box.setAttribute(
          'aria-label',
          value
            ? `${row.target}, trial ${trialIndex + 1}: ${MARK_NAMES[value]}. Tap to clear.`
            : `${row.target}, trial ${trialIndex + 1}: not scored`
        );
        box.addEventListener('click', () => clearTrial(rowIndex, trialIndex));
        td.append(box);
        tr.append(td);
      });

      tr.append(el('td', 'live-pct', formatPercent(scoreTrials(row.trials).percent)));
      tbody.append(tr);
    });
    table.append(tbody);

    const { correct, scored, percent } = scoreSession(session);
    const tfoot = el('tfoot');
    const totalRow = el('tr', 'live-total-row');
    const totalLabel = el('th', '', 'Session total');
    totalLabel.scope = 'row';
    const scoreSpacer = el('td', 'no-print');
    const totalDetail = el('td', 'live-total-detail', scored ? `${correct} correct out of ${scored} trials` : 'No trials scored yet');
    totalDetail.colSpan = TRIAL_COUNT;
    const totalPct = el('td', 'live-pct live-total-pct', formatPercent(percent));
    totalRow.append(totalLabel, scoreSpacer, totalDetail, totalPct);
    tfoot.append(totalRow);
    table.append(tfoot);
  }

  function renderWeekly() {
    weekly.innerHTML = '';
    const days = weeklyPercents(store.sessions, {
      student: studentInput.value,
      programId: programOf(session),
      date: dateInput.value
    });
    const weekDates = schoolWeek(dateInput.value);

    const heading = el('h3', 'weekly-progress-title', `Weekly Progress, week of ${formatShortDate(weekDates[0])}`);
    weekly.append(heading);

    const table = el('table', 'weekly-progress-table live-weekly');
    const thead = el('thead');
    const headRow = el('tr');
    const corner = el('th', 'weekly-progress-corner');
    corner.scope = 'col';
    headRow.append(corner);
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((day, i) => {
      const th = el('th', weekDates[i] === dateInput.value ? 'live-today' : '');
      th.scope = 'col';
      th.append(el('span', 'day-full', day), el('span', 'day-short', day.slice(0, 3)));
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = el('tbody');
    for (let level = 10; level >= 1; level -= 1) {
      const tr = el('tr');
      const th = el('th', 'weekly-progress-score', String(level * 10));
      th.scope = 'row';
      tr.append(th);
      days.forEach((day) => {
        const td = el('td');
        const box = el('span', 'weekly-progress-box');
        if (boxesFilled(day.percent) >= level) box.classList.add('weekly-progress-box--filled');
        box.setAttribute('aria-hidden', 'true');
        td.append(box);
        tr.append(td);
      });
      tbody.append(tr);
    }
    const pctRow = el('tr', 'live-weekly-pct');
    const pctHead = el('th', 'weekly-progress-score', '%');
    pctHead.scope = 'row';
    pctRow.append(pctHead);
    days.forEach((day) => pctRow.append(el('td', '', formatPercent(day.percent))));
    tbody.append(pctRow);
    table.append(tbody);
    weekly.append(table);
  }

  function renderChips(knownStudents) {
    chips.innerHTML = '';
    if (knownStudents.length === 0) return;
    chips.append(el('span', 'live-chips-label', 'Switch student'));
    knownStudents.forEach((student) => {
      const chip = el('button', 'live-chip', student);
      chip.type = 'button';
      const current = sameStudent(student, studentInput.value);
      if (current) chip.classList.add('live-chip--current');
      chip.setAttribute('aria-pressed', String(current));
      const today = findSession(student, session.date, programOf(session));
      if (today && hasAnyMarks(today)) {
        chip.append(el('span', 'live-chip-pct', formatPercent(scoreSession(today).percent)));
      }
      chip.addEventListener('click', () => {
        if (current) return;
        studentInput.value = student;
        switchSession();
      });
      chips.append(chip);
    });
  }

  function renderHistory() {
    history.innerHTML = '';
    const name = studentInput.value.trim();
    studentList.innerHTML = '';
    const knownStudents = [];
    store.sessions.forEach((s) => {
      if (s.student && !knownStudents.some((k) => sameStudent(k, s.student))) knownStudents.push(s.student);
    });
    knownStudents.sort((a, b) => a.localeCompare(b));
    knownStudents.forEach((student) => {
      const option = el('option');
      option.value = student;
      studentList.append(option);
    });
    renderChips(knownStudents);

    if (!name) return;
    const past = store.sessions
      .filter((s) => sameStudent(s.student, name))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0));

    history.append(el('h3', 'live-history-title', `Sessions for ${name}`));
    if (past.length === 0) {
      history.append(el('p', 'live-empty', 'No saved sessions yet. Tap a trial box to start one.'));
      return;
    }

    const list = el('ul', 'live-history-list');
    past.forEach((s) => {
      const li = el('li', s === session ? 'live-history-item live-history-item--current' : 'live-history-item');
      const info = el('span', 'live-history-info');
      info.append(
        el('strong', '', formatShortDate(s.date)),
        el('span', '', ` ${s.relationshipLabel}`),
        el('span', 'live-history-pct', formatPercent(scoreSession(s).percent))
      );
      const openBtn = el('button', 'live-mini-btn', s === session ? 'Open now' : 'Open');
      openBtn.type = 'button';
      openBtn.disabled = s === session;
      openBtn.addEventListener('click', () => {
        loadSession({
          student: s.student,
          date: s.date,
          program: programFromSession(s)
        });
      });
      const deleteBtn = el('button', 'live-mini-btn live-mini-btn--danger', 'Delete');
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', () => {
        if (!window.confirm(`Delete ${s.student}’s ${formatShortDate(s.date)} session? This can’t be undone.`)) return;
        store.sessions = store.sessions.filter((other) => other !== s);
        saveStore(store);
        if (s === session) {
          loadSession({
            student: s.student,
            date: s.date,
            program: programFromSession(s),
            addTargets: s.rows.map((row) => row.target)
          });
        } else {
          renderWeekly();
          renderHistory();
        }
      });
      li.append(info, openBtn, deleteBtn);
      list.append(li);
    });
    history.append(list);
  }

  function renderAll() {
    saveLine.textContent = hasAnyMarks(session) ? 'Saved on this device' : '';
    saveLine.classList.remove('live-save--error');
    renderTable();
    renderWeekly();
    renderHistory();
  }

  // ── Controls ──

  undoBtn.addEventListener('click', undoLast);

  // Changing the student or date switches to that day's session (or starts a fresh one).
  function switchSession() {
    const name = studentInput.value.trim();
    const date = dateInput.value || toISODate();
    const targets = session.rows.map((row) => row.target);
    // Leave an untouched, unsaved session behind without saving it.
    loadSession({
      student: name,
      date,
      program: programFromSession(session),
      addTargets: findSession(name, date, programOf(session)) ? null : targets
    });
  }

  studentInput.addEventListener('change', switchSession);
  dateInput.addEventListener('change', switchSession);

  clearBtn.addEventListener('click', () => {
    if (!hasAnyMarks(session)) return;
    if (!window.confirm('Clear every mark in this session?')) return;
    session.rows.forEach((row) => {
      row.trials = emptyTrials(TRIAL_COUNT);
    });
    store.sessions = store.sessions.filter((s) => s !== session);
    saveStore(store);
    undoStack = [];
    renderAll();
  });

  exportBtn.addEventListener('click', () => {
    const name = studentInput.value.trim();
    const sessions = name ? store.sessions.filter((s) => sameStudent(s.student, name)) : store.sessions;
    if (sessions.length === 0) {
      saveLine.textContent = 'Nothing to export yet.';
      return;
    }
    const csv = sessionsToCSV(sessions, TRIAL_COUNT);
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const who = name ? name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'all-students';
    link.download = `cardmaker-data-${who}-${toISODate()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  // ── Start ──
  loadSession({
    student: student ?? (store.lastStudent || ''),
    date: date || toISODate(),
    program,
    addTargets: targetLabels
  });
  page.scrollIntoView({ block: 'start' });
  status.textContent = `Taking data on ${targetLabels.length} target(s). Marks save as you tap.`;
}
