import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, deviceStatus } from '../src/renderer/audio.ts';

test('encodeWav writes a valid 16 kHz mono PCM16 header and clamps samples', () => {
  const wav = encodeWav([new Float32Array([0, 1, -1, 2])]);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(46, true), 0x7fff);
  assert.equal(v.getInt16(50, true), 0x7fff, 'clamped');
});

test('deviceStatus never silently switches devices', () => {
  const devs = [{ deviceId: 'new-id', label: 'Microphone (USBAudio2.0)' }] as MediaDeviceInfo[];
  assert.equal(deviceStatus({ id: null, label: null }, devs).status, 'unset');
  assert.equal(deviceStatus({ id: 'default', label: null }, devs).status, 'ok');
  assert.equal(deviceStatus({ id: 'new-id', label: 'x' }, devs).status, 'ok');
  assert.equal(deviceStatus({ id: 'old-id', label: 'Microphone (USBAudio2.0)' }, devs).status, 'moved');
  assert.equal(deviceStatus({ id: 'old-id', label: 'Other mic' }, devs).status, 'missing');
});

import { formatHotkey, matchHotkey } from '../src/renderer/hotkeys.ts';
test('hotkeys', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  assert.equal(formatHotkey(k('n', { ctrlKey: true })), 'Ctrl+N');
  assert.equal(formatHotkey(k(' ', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Space');
  assert.equal(formatHotkey(k('Control', { ctrlKey: true })), null);
  assert.ok(matchHotkey(k('F2'), 'F2'));
  assert.ok(!matchHotkey(k('F2', { ctrlKey: true }), 'F2'));
});
