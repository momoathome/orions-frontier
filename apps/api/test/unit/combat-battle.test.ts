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

test('every group loses the same floored share and damage spills from the weakest fleet', () => {
  // Defense 4 docked Moles + 1 docked Mole (3 each) + 1 Merlin (8) + station 2 = 25 against 40.
  const battle = resolveBattle(
    [
      { key: 'fighter', amount: 3, spacecraft: { attack: 10, defense: 10 } },
      { key: 'bomber', amount: 1, spacecraft: { attack: 0, defense: 10 } },
    ],
    [fleet('a-merlin', 'merlin', 1), fleet('m1', 'mole', 4), fleet('m2', 'mole', 3, 2)],
    2,
    noResearch,
    noResearch
  );
  // Share 25/40: 3 fighters lose floor(1.875) = 1, the single bomber floor(0.625) = 0.
  assert.deepEqual([...battle.attackerLosses], [['fighter', 1]]);
  // 30 damage: Moles first (4 + 1 docked, 15), then the Merlin (8); 7 damage is left over.
  assert.deepEqual(
    [...battle.defenderLosses],
    [
      ['m1', 4],
      ['m2', 1],
      ['a-merlin', 1],
    ]
  );
  assert.equal(battle.attackerPower, 30);
  assert.equal(battle.defenderPower, 25);
  assert.equal(battle.winner, 'attacker');
});

test('the attacker wins only with survivors and strictly more power', () => {
  const single = (attack: number, defense: number) => [
    { key: 'x', amount: 1, spacecraft: { attack, defense } },
  ];
  // The ship survives, but equal power lets the defender hold.
  const even = resolveBattle(single(10, 100), [], 10, noResearch, noResearch);
  assert.equal(even.attackerLosses.size, 0);
  assert.equal(even.winner, 'defender');
  // More power, but the whole fleet is lost.
  const wiped = resolveBattle(single(100, 1), [], 5, noResearch, noResearch);
  assert.deepEqual([...wiped.attackerLosses], [['x', 1]]);
  assert.equal(wiped.winner, 'defender');
});
