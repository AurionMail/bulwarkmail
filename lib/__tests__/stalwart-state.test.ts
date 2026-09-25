import { describe, expect, it } from 'vitest';
import { stalwartChangeId } from '@/lib/jmap/stalwart-state';
import { stalwartExactState, stalwartIntermediateState } from './helpers/stalwart-state';

const big = (n: number | string) => BigInt(n);
const U64_MAX = big(2) ** big(64) - big(1);

// What the stw10 test servers answered to Mailbox/get, Email/get and
// Thread/get with `ids: []` for usera and the team group (2026-09-25).
const CAPTURED_1_0: Array<[string, number]> = [['sae', 1], ['sai', 2], ['saq', 4], ['sau', 5]];
const CAPTURED_0_16: Array<[string, number]> = [['sae', 1], ['sai', 2], ['say', 6], ['sba', 8]];

// Written by a separate port of Stalwart's writer, one per LEB128 length and
// at each byte boundary.
const WRITTEN: Array<[string, bigint]> = [
  ['saa', big(0)],
  ['sd2', big(31)],
  ['sp2', big(127)],
  ['sqaaq', big(128)],
  ['sqeaq', big(129)],
  ['s32aq', big(255)],
  ['svqba', big(300)],
  ['s303q', big(16383)],
  ['sqcaac', big(16384)],
  ['syccd7', big(1000000)],
  ['sz9bpcbi', big(12345678)],
  ['s333333yp', big(2) ** big(32) - big(1)],
  ['sqgaibaeaqcaba', big(2) ** big(53) + big(1)],
  ['s33333333333333yb', U64_MAX],
];

// A small deterministic generator for ids across the whole u64 range.
function* seededIds(count: number): Generator<bigint> {
  let seed = big(0x2545f491);
  for (let i = 0; i < count; i++) {
    seed = (seed * big('6364136223846793005') + big('1442695040888963407')) & U64_MAX;
    yield seed >> big(i % 64);
  }
}

describe('stalwartChangeId', () => {
  it('reads the change ids of states captured from Stalwart 1.0 and 0.16.23', () => {
    for (const [state, id] of [...CAPTURED_1_0, ...CAPTURED_0_16]) {
      expect(stalwartChangeId(state)).toBe(big(id));
    }
  });

  it('reads ids of every LEB128 length, up to u64::MAX', () => {
    for (const [state, id] of WRITTEN) {
      expect(stalwartExactState(id)).toBe(state);
      expect(stalwartChangeId(state)).toBe(id);
    }
  });

  it('reads back every id written the way Stalwart writes it', () => {
    for (let id = 0; id < 20_000; id++) {
      expect(stalwartChangeId(stalwartExactState(id))).toBe(big(id));
    }
    for (const id of seededIds(5_000)) {
      expect(stalwartChangeId(stalwartExactState(id))).toBe(id);
    }
  });

  it('reads nothing from other state formats', () => {
    for (const state of [
      'n', // Initial
      stalwartIntermediateState(1024, 2048, 100), // an intermediate `r` state
      '', 's',
      's1', // '1' is 30: a LEB128 byte that never ends
      'sZZ', 's!', 'sa e', // not the alphabet
      '12345', 'J1234', '2d7a4b56-6c1e-4f2b-9d57-6a3c9e1f0b42', // other servers
    ]) {
      expect(stalwartChangeId(state)).toBeNull();
    }
  });

  it('reads nothing Stalwart would not have written for that id', () => {
    // Stalwart's reader takes these too, but its writer never produces them.
    expect(stalwartChangeId('sa')).toBeNull(); // 0 is `saa`
    expect(stalwartChangeId('sb')).toBeNull(); // 8 is `sba`
    expect(stalwartChangeId('saaaaaaaa')).toBeNull();
    expect(stalwartChangeId('sbb')).toBeNull(); // nonzero padding bits
    // Past a u64: ten bytes that overflow it, and eleven.
    expect(stalwartChangeId(stalwartExactState(big(2) ** big(64)))).toBeNull();
    expect(stalwartChangeId(stalwartExactState(big(2) ** big(70)))).toBeNull();
  });
});
