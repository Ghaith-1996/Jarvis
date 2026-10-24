import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessLang, sentences, applyPronunciations, cleanTranscript, toAscii } from '../src/shared/text.ts';
import { validateSettingsPatch, normalizeSettings, defaultSettings, InvalidInput } from '../src/shared/contracts.ts';

test('guessLang', () => {
  assert.equal(guessLang("Bonjour, je peux t'aider avec ce fichier.", 'en'), 'fr');
  assert.equal(guessLang('Hello, I can help you with this file.', 'fr'), 'en');
  assert.equal(guessLang('OK 42', 'fr'), 'fr');
});

test('sentences splits and strips markdown/code', () => {
  assert.deepEqual(sentences('**Hi.** How are you? Fine!'), ['Hi.', 'How are you?', 'Fine!']);
  assert.deepEqual(sentences('Run this:\n```\nrm -rf x\n```\nDone.'), ['Run this: Done.']);
  assert.ok(sentences('x'.repeat(700)).every((s) => s.length <= 300));
});

test('applyPronunciations: whole words, per language', () => {
  const rules = [{ lang: 'fr' as const, from: 'PDF', to: 'pé dé èf' }, { lang: 'en' as const, from: 'npm', to: 'N P M' }];
  assert.equal(applyPronunciations('Ce PDF et PDFs', 'fr', rules), 'Ce pé dé èf et PDFs');
  assert.equal(applyPronunciations('run npm test', 'fr', rules), 'run npm test');
  assert.equal(applyPronunciations('run npm test', 'en', rules), 'run N P M test');
});

test('cleanTranscript removes non-speech tags', () => {
  assert.equal(cleanTranscript(' [MÚSICA] '), '');
  assert.equal(cleanTranscript('Bonjour (rires) à tous'), 'Bonjour à tous');
});

test('settings validation rejects bad input and unknown keys', () => {
  assert.deepEqual(validateSettingsPatch({ speechRate: 1.5, model: 'gpt-6.1-sol' }), { speechRate: 1.5, model: 'gpt-6.1-sol' });
  assert.throws(() => validateSettingsPatch({ speechRate: 9 }), InvalidInput);
  assert.throws(() => validateSettingsPatch({ evil: true }), InvalidInput);
  assert.throws(() => validateSettingsPatch({ model: '../x y' }), InvalidInput);
  assert.throws(() => validateSettingsPatch({ hotkeys: { pushToTalk: '<script>', stop: 'Escape', newConversation: 'Ctrl+N' } }), InvalidInput);
  const n = normalizeSettings({ speechRate: 'fast', effort: 'high', unknown: 1 });
  assert.equal(n.speechRate, defaultSettings.speechRate);
  assert.equal(n.effort, 'high');
});

test('long sentences split at commas; toAscii folds accents and punctuation', () => {
  const long = 'Good evening, sir, your meeting with Sophie has moved to tomorrow morning at nine forty-five, and the briefing notes are ready, along with the updated agenda for the quarterly review.';
  const parts = sentences(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 140), JSON.stringify(parts));
  assert.equal(parts.join(' '), long);
  assert.equal(toAscii('Montréal — “déjà” vu… it’s'), `Montreal - "deja" vu... it's`);
});
