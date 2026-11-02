import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBattle } from '../../src/services/combat/battle.js';

const noResearch = { attack: 1, shipDefense: 1, stationDefense: 1 };
const fleet = (id: string, spacecraftKey: string, amount: number, lockedAmount = 0) => ({
  id,
  spacecraftKey,
  amount,
  lockedAmount,
});

test('the attacker wins with more power, keeps most ships and wipes out the docked defenders', () => {
  // Defense: 1 Merlin (8) + 4 docked Moles + 1 docked Mole (3 each) + station 2 = 25 against 30.
  const battle = resolveBattle(
    [
      { key: 'fighter', amount: 3, spacecraft: { attack: 10 } },
      { key: 'bomber', amount: 1, spacecraft: { attack: 0 } },
    ],
    [fleet('a-merlin', 'merlin', 1), fleet('m1', 'mole', 4), fleet('m2', 'mole', 3, 2)],
    2,
    noResearch,
    noResearch
  );
  // Share (25/30)^1.5 = 0.76: 3 fighters lose floor(2.28) = 2, the single bomber floor(0.76) = 0.
  assert.deepEqual([...battle.attackerLosses], [['fighter', 2]]);
  assert.deepEqual(
    [...battle.defenderLosses],
    [
      ['a-merlin', 1],
      ['m1', 4],
      ['m2', 1],
    ]
  );
  assert.equal(battle.attackerPower, 30);
  assert.equal(battle.defenderPower, 25);
  assert.equal(battle.winner, 'attacker');
});

test('the winner loses less the clearer its superiority', () => {
  const ships = (amount: number) => [{ key: 'x', amount, spacecraft: { attack: 10 } }];
  // Four times the power: (1/4)^1.5 = 12.5% of 100 ships.
  assert.deepEqual(
    [...resolveBattle(ships(100), [], 250, noResearch, noResearch).attackerLosses],
    [['x', 12]]
  );
  // An undefended station costs nothing.
  assert.equal(resolveBattle(ships(10), [], 0, noResearch, noResearch).attackerLosses.size, 0);
});

test('a defending win destroys the whole wave and costs the defender by the same rule', () => {
  // 10 attack against 8 Moles (24) + station 16 = 40: the defender loses (1/4)^1.5 of 8 = 1 Mole.
  const lost = resolveBattle(
    [{ key: 'x', amount: 1, spacecraft: { attack: 10 } }],
    [fleet('m', 'mole', 8)],
    16,
    noResearch,
    noResearch
  );
  assert.equal(lost.winner, 'defender');
  assert.deepEqual([...lost.attackerLosses], [['x', 1]]);
  assert.deepEqual([...lost.defenderLosses], [['m', 1]]);
  // Equal power: the defender holds, and both sides fall.
  const even = resolveBattle(
    [{ key: 'x', amount: 2, spacecraft: { attack: 12 } }],
    [fleet('m', 'mole', 8)],
    0,
    noResearch,
    noResearch
  );
  assert.equal(even.winner, 'defender');
  assert.deepEqual([...even.attackerLosses], [['x', 2]]);
  assert.deepEqual([...even.defenderLosses], [['m', 8]]);
});
