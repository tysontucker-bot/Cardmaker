import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTargetLines, selectDistractors, buildCardSet } from '/home/runner/work/Cardmaker/Cardmaker/logic.js';

test('parseTargetLines supports line and pair formats', () => {
  const parsed = parseTargetLines('sun\npig -> swine\ncat|feline');
  assert.deepEqual(parsed, [
    { left: 'sun', right: null },
    { left: 'pig', right: 'swine' },
    { left: 'cat', right: 'feline' }
  ]);
});

test('selectDistractors enforces initial letter constraints', () => {
  const distractors = selectDistractors({
    pool: ['son', 'sat', 'bed', 'mop'],
    target: 'sun',
    needed: 2,
    constraints: {
      sameLength: true,
      differentInitial: true,
      uniqueInitials: true,
      exactLength: 3
    }
  });

  assert.equal(distractors.length, 2);
  assert.ok(distractors.includes('bed'));
  assert.ok(distractors.includes('mop'));
});

test('buildCardSet creates the requested array size', () => {
  const cards = buildCardSet({
    relationshipId: 'word-word',
    targetLines: 'sun\nbed\nmop\ncat',
    arraySize: 3,
    constraints: { differentInitial: true, uniqueInitials: true }
  });

  assert.equal(cards.length, 4);
  for (const card of cards) {
    assert.equal(card.choices.length, 3);
    assert.ok(card.choices.includes(card.correctChoice));
  }
});
