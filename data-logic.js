// Logic for the live (digital) data sheet. No DOM in here so it can be tested with `npm test`.

// A trial box cycles through these marks each time it is tapped.
// '' = not run yet, '+' = correct, '-' = incorrect, 'P' = prompted.
export const MARKS = ['', '+', '-', 'P'];

export const MARK_NAMES = {
  '': 'not scored',
  '+': 'correct',
  '-': 'incorrect',
  P: 'prompted'
};

export function nextMark(mark) {
  const index = MARKS.indexOf(mark);
  return MARKS[(index + 1) % MARKS.length];
}

// Percent correct counts only independent correct (+) out of every trial that was scored.
// Prompted trials count as scored but not correct.
export function scoreTrials(trials) {
  let correct = 0;
  let scored = 0;
  for (const mark of trials) {
    if (!mark) continue;
    scored += 1;
    if (mark === '+') correct += 1;
  }
  return {
    correct,
    scored,
    percent: scored ? Math.round((correct / scored) * 100) : null
  };
}

export function scoreSession(session) {
  return scoreTrials(session.rows.flatMap((row) => row.trials));
}

export function emptyTrials(count) {
  return Array.from({ length: count }, () => '');
}

// Keeps every existing row (and its marks), then adds any new targets that aren't there yet.
export function mergeTargets(rows, targetLabels, trialCount) {
  const merged = rows.map((row) => ({ target: row.target, trials: [...row.trials] }));
  const existing = new Set(merged.map((row) => row.target));
  for (const label of targetLabels) {
    if (existing.has(label)) continue;
    merged.push({ target: label, trials: emptyTrials(trialCount) });
    existing.add(label);
  }
  return merged;
}

export function hasAnyMarks(session) {
  return session.rows.some((row) => row.trials.some(Boolean));
}

// Sessions are grouped by program: a saved card set, or the matching relationship
// when no set was open.
export function programOf(session) {
  return session.programId || session.relationshipId;
}

export function sameStudent(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map((part) => parseInt(part, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

// Monday through Friday of the school week that contains `iso`.
// A Saturday or Sunday shows the week that just finished.
export function schoolWeek(iso) {
  const date = parseISODate(iso);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday);
  return Array.from({ length: 5 }, (_, i) =>
    toISODate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  );
}

// One percent per weekday for a student's program, combining every session that day.
export function weeklyPercents(sessions, { student, programId, date }) {
  return schoolWeek(date).map((day) => {
    const daySessions = sessions.filter(
      (s) => s.date === day && programOf(s) === programId && sameStudent(s.student, student)
    );
    const allTrials = daySessions.flatMap((s) => s.rows.flatMap((row) => row.trials));
    return { date: day, ...scoreTrials(allTrials) };
  });
}

// The weekly graph has 10 boxes per day, so each box stands for 10%.
export function boxesFilled(percent) {
  if (percent === null || percent === undefined) return 0;
  return Math.max(0, Math.min(10, Math.round(percent / 10)));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sessionsToCSV(sessions, trialCount) {
  const trialHeadings = Array.from({ length: trialCount }, (_, i) => `Trial ${i + 1}`);
  const lines = [['Date', 'Student', 'Program', 'Target', ...trialHeadings, 'Correct', 'Scored', 'Percent']];
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.student.localeCompare(b.student));
  for (const session of sorted) {
    for (const row of session.rows) {
      const { correct, scored, percent } = scoreTrials(row.trials);
      const trials = Array.from({ length: trialCount }, (_, i) => row.trials[i] || '');
      lines.push([
        session.date,
        session.student,
        session.relationshipLabel,
        row.target,
        ...trials,
        correct,
        scored,
        percent === null ? '' : percent
      ]);
    }
  }
  return lines.map((line) => line.map(csvCell).join(',')).join('\n');
}
