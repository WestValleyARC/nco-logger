const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const model = fs.readFileSync(path.join(root, 'server/dist/models/netProfile.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'client/dist/public/js/byView/myNets/main.js'), 'utf8');
const formatter = fs.readFileSync(path.join(root, 'client/dist/public/js/lib/publicSchedule.js'), 'utf8');

test('Fusion and WIRES-X are distinct connection types and YSF remains unchanged', () => {
  assert.match(model, /'Fusion', 'WIRES-X', 'YSF'/);
  assert.match(model, /case 'Fusion':[\s\S]*Fusion connections require frequency/);
  assert.match(model, /case 'WIRES-X':[\s\S]*WIRES-X connections require room name or room ID/);
  assert.match(model, /case 'YSF':[\s\S]*YSF connections require room or reflector/);
});

test('connection editor exposes appropriate Fusion and WIRES-X fields', () => {
  assert.match(editor, /Fusion: \[[\s\S]*Frequency[\s\S]*Operation[\s\S]*Offset/);
  assert.match(editor, /'WIRES-X': \[[\s\S]*Room Name[\s\S]*Room ID/);
  assert.doesNotMatch(editor.match(/'WIRES-X': \[[\s\S]*?\],/)[0], /Access Frequency/);
  assert.match(editor, /YSF: \[\{ key: 'room', label: 'Room \/ Reflector', required: true \}\]/);
});

test('shared formatter keeps Fusion, WIRES-X, and YSF labels distinct', () => {
  assert.match(formatter, /case 'Fusion':[\s\S]*`Fusion:/);
  assert.match(formatter, /case 'WIRES-X':[\s\S]*`WIRES-X:/);
  assert.match(formatter, /case 'YSF':[\s\S]*`YSF:/);
});
