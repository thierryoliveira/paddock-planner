// Planner logic tests. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../planner.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const INITIAL = P.migrateState(JSON.parse(html.match(/id="initial-state">([\s\S]*?)<\/script>/)[1]));

const mount = (overrides) => ({
  id: 'X', name: 'Test', species: 'Dragoturkey', sex: 'F', generation: 1, level: 1,
  endurance: 0, maturity: 0, love: 0, serenity: 0, status: 'fertile', notes: '', ...overrides,
});

test('gauge tiers follow 3.7 thresholds (80k/140k/180k/200k)', () => {
  assert.equal(P.tier(0), 0);
  assert.equal(P.tier(1), 1);
  assert.equal(P.tier(80000), 1);
  assert.equal(P.tier(80001), 2);
  assert.equal(P.tier(140001), 3);
  assert.equal(P.tier(180001), 4);
});

test('serenity zones', () => {
  assert.ok(P.inZone('endurance', -1));
  assert.ok(!P.inZone('endurance', 0));
  assert.ok(P.inZone('maturity', -2000) && P.inZone('maturity', 2000));
  assert.ok(!P.inZone('maturity', 2001));
  assert.ok(P.inZone('love', 0));
  assert.ok(!P.inZone('love', -1));
});

test('fecund means all three stats at 20,000', () => {
  assert.ok(P.isFecund(mount({ endurance: 20000, maturity: 20000, love: 20000 })));
  assert.ok(!P.isFecund(mount({ endurance: 20000, maturity: 19999, love: 20000 })));
});

test('target zone prefers the double zones', () => {
  assert.deepEqual(P.targetZone(mount({ serenity: -3000 })), [-2000, -1]);
  assert.deepEqual(P.targetZone(mount({ serenity: 3000 })), [0, 2000]);
  assert.deepEqual(P.targetZone(mount({ endurance: 20000, serenity: -3000 })), [0, 2000]);
});

test('tier 1 gives 1 point/s to every mount and burns 1 unit/s', () => {
  const mounts = [mount({ id: 'A', serenity: 1000 }), mount({ id: 'B', serenity: 1000 })];
  const run = P.simulate(['maturity'], mounts, { maturity: 3600 }, 3600, 60, false);
  assert.equal(run.mounts[0].maturity, 3600);
  assert.equal(run.mounts[1].maturity, 3600);
  assert.equal(run.fuel.maturity, 0);
});

test('a gauge does not drain when no mount benefits', () => {
  const run = P.simulate(['endurance'], [mount({ serenity: 3000 })], { endurance: 1000 }, 600, 60, false);
  assert.equal(run.fuel.endurance, 1000);
});

test('never activates both serenity gauges together', () => {
  const state = {
    slots: 10,
    fuel: { serenityDown: 5000, serenityUp: 5000, endurance: 0, maturity: 0, love: 0, xp: 0 },
    mounts: [mount({ id: 'A', serenity: 4000 }), mount({ id: 'B', serenity: -4000 })],
  };
  for (const step of P.plan(state, 4)) {
    assert.ok(!(step.combo.includes('serenityDown') && step.combo.includes('serenityUp')));
  }
});

test('schedule respects paddock slots and known mounts', () => {
  for (const step of P.plan(INITIAL, 6)) {
    assert.ok(step.combo.length >= 1 && step.combo.length <= 2);
    assert.ok(step.mountIds.length <= INITIAL.slots);
    assert.ok(step.mountIds.every((id) => INITIAL.mounts.some((m) => m.id === id)));
  }
});

test('target chance: 30% + 0.15%/level + 20% Optimakina, capped at 100%', () => {
  assert.equal(P.targetChance(0, 0, 1, false), 0.3);
  assert.ok(Math.abs(P.targetChance(68, 1, 1, false) - 0.4035) < 1e-9);
  assert.ok(Math.abs(P.targetChance(200, 200, 1, true) - 1) < 1e-9);
});

test('expected value of a breeding', () => {
  const ev = P.breedingExpectedValue({ chance: 0.4, targetPrice: 100000, fallbackPrice: 8000, parentsValue: 16000 });
  assert.equal(Math.round(ev), 28800);
});

test('fuel needed for the initial stable', () => {
  const need = P.fuelNeeded(INITIAL);
  assert.equal(need.endurance, 20000);
  assert.equal(need.serenityUp, 3200);
});

test('migrates state from the earlier Portuguese schema', () => {
  const legacy = {
    slots: 10,
    fuel: { baffeur: 1, caresseur: 2, foudroyeur: 3, abreuvoir: 4, dragofesse: 5, mangeoire: 6 },
    mounts: [{ id: 'F01', nome: 'Ruivo', tipo: 'Dragoperu', sexo: 'M', ger: 2, nivel: 10, res: 1, mat: 2, amor: 3, ser: -4, estado: 'Estéril', obs: 'x' }],
  };
  const s = P.migrateState(legacy);
  assert.deepEqual(s.fuel, { serenityDown: 1, serenityUp: 2, endurance: 3, maturity: 4, love: 5, xp: 6 });
  assert.deepEqual(s.mounts[0], {
    id: 'F01', name: 'Ruivo', species: 'Dragoturkey', sex: 'M', generation: 2, level: 10,
    endurance: 1, maturity: 2, love: 3, serenity: -4, status: 'sterile', notes: 'x',
  });
});
