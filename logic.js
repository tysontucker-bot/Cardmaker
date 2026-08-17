export const RELATIONSHIPS = [
  { id: 'picture-picture', label: 'Picture → picture', stimulus: 'picture', choice: 'picture' },
  { id: 'picture-word', label: 'Picture → printed word', stimulus: 'picture', choice: 'text' },
  { id: 'word-picture', label: 'Printed word → picture', stimulus: 'text', choice: 'picture' },
  { id: 'word-word', label: 'Printed word → printed word', stimulus: 'text', choice: 'text' },
  { id: 'uppercase-lowercase', label: 'Uppercase letter → lowercase letter', stimulus: 'text', choice: 'text', stimulusMap: (v) => v.toUpperCase(), choiceMap: (v) => v.toLowerCase() },
  { id: 'lowercase-uppercase', label: 'Lowercase letter → uppercase letter', stimulus: 'text', choice: 'text', stimulusMap: (v) => v.toLowerCase(), choiceMap: (v) => v.toUpperCase() },
  { id: 'letter-letter', label: 'Letter → letter', stimulus: 'text', choice: 'text' },
  { id: 'number-number', label: 'Number → number', stimulus: 'text', choice: 'text' },
  { id: 'number-quantity', label: 'Number → quantity', stimulus: 'text', choice: 'quantity', stimulusMap: (v) => String(parseInt(v, 10) || 0) },
  { id: 'numeral-number-word', label: 'Numeral → number word', stimulus: 'text', choice: 'text', stimulusMap: (v) => String(parseInt(v, 10) || 0), choiceMap: numeralToWord },
  { id: 'shape-shape', label: 'Shape → shape', stimulus: 'text', choice: 'text' },
  { id: 'color-color', label: 'Color → color', stimulus: 'text', choice: 'text' },
  { id: 'object-picture', label: 'Object → picture', stimulus: 'text', choice: 'picture' },
  { id: 'symbol-symbol', label: 'Symbol → symbol', stimulus: 'picture', choice: 'picture' },
  { id: 'identical', label: 'Identical matching', stimulus: 'text', choice: 'text' },
  { id: 'non-identical', label: 'Non-identical matching', stimulus: 'text', choice: 'text' }
];

export function parseTargetLines(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pair = parsePair(line);
      return pair ? pair : { left: line, right: null };
    });
}

function parsePair(line) {
  const separators = ['->', '=>', '|'];
  for (const sep of separators) {
    if (line.includes(sep)) {
      const [left, right] = line.split(sep).map((part) => part.trim());
      if (left && right) return { left, right };
    }
  }
  return null;
}

export function buildCardSet({ relationshipId, targetLines, arraySize, constraints }) {
  const relationship = RELATIONSHIPS.find((item) => item.id === relationshipId) || RELATIONSHIPS[0];
  const targets = parseTargetLines(targetLines);

  const cards = targets.map((target, index) => {
    const stimulusBase = target.left;
    const correctBase = target.right ?? target.left;
    const mappedStimulus = mapValue(stimulusBase, relationship.stimulusMap);
    const mappedCorrect = mapValue(correctBase, relationship.choiceMap);

    const choicePool = targets
      .filter((_, i) => i !== index)
      .map((item) => mapValue(item.right ?? item.left, relationship.choiceMap));

    const distractors = selectDistractors({
      pool: choicePool,
      target: mappedCorrect,
      needed: Math.max(0, arraySize - 1),
      constraints
    });

    const choices = shuffle([mappedCorrect, ...distractors]);
    while (choices.length < arraySize) choices.push('—');

    return {
      relationship,
      sourceTarget: target,
      stimulus: mappedStimulus,
      correctChoice: mappedCorrect,
      choices
    };
  });

  return cards;
}

function mapValue(value, mapper) {
  return mapper ? mapper(String(value)) : String(value);
}

function numeralToWord(value) {
  const n = parseInt(value, 10);
  const map = {
    0: 'zero',
    1: 'one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'nine',
    10: 'ten',
    11: 'eleven',
    12: 'twelve',
    13: 'thirteen',
    14: 'fourteen',
    15: 'fifteen',
    16: 'sixteen',
    17: 'seventeen',
    18: 'eighteen',
    19: 'nineteen',
    20: 'twenty'
  };
  return map[n] ?? String(value);
}

function scoreDifference(a, b) {
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  const maxLength = Math.max(left.length, right.length);
  let diff = Math.abs(left.length - right.length);
  for (let i = 0; i < maxLength; i += 1) {
    if (left[i] !== right[i]) diff += 1;
  }
  return diff;
}

function startsWithDifferentInitial(value, target) {
  const a = String(value).trim().toLowerCase();
  const b = String(target).trim().toLowerCase();
  return a.charAt(0) && b.charAt(0) ? a.charAt(0) !== b.charAt(0) : true;
}

export function selectDistractors({ pool, target, needed, constraints = {} }) {
  const uniquePool = [...new Set(pool.filter(Boolean).map((item) => String(item).trim()))].filter((item) => item !== target);
  const targetLength = String(target).length;
  let candidates = uniquePool;

  if (constraints.sameLength) candidates = candidates.filter((item) => item.length === targetLength);
  if (constraints.exactLength) {
    const lengthValue = parseInt(constraints.exactLength, 10);
    if (lengthValue > 0) candidates = candidates.filter((item) => item.length === lengthValue);
  }
  if (constraints.differentInitial) candidates = candidates.filter((item) => startsWithDifferentInitial(item, target));

  const sorted = [...candidates].sort((a, b) => scoreDifference(b, target) - scoreDifference(a, target));
  const selected = [];
  const initials = new Set();

  for (const candidate of sorted) {
    if (selected.length >= needed) break;
    const initial = candidate.charAt(0).toLowerCase();
    if (constraints.uniqueInitials && initials.has(initial)) continue;
    selected.push(candidate);
    initials.add(initial);
  }

  if (selected.length < needed) {
    for (const candidate of uniquePool) {
      if (selected.length >= needed) break;
      if (selected.includes(candidate)) continue;
      const initial = candidate.charAt(0).toLowerCase();
      if (constraints.uniqueInitials && initials.has(initial)) continue;
      selected.push(candidate);
      initials.add(initial);
    }
  }

  return selected.slice(0, needed);
}

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
