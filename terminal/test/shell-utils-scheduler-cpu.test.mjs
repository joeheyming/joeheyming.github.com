import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerManager } from '../core/scheduler-manager.js';

function makeFakeKernel(processes) {
  return {
    log: () => {},
    emit: () => {},
    on: () => {},
    processManager: {
      getAllProcesses: () => processes,
      setCurrentProcess: () => {}
    }
  };
}

test('getCpuPercent: returns 0 with no samples', () => {
  const sm = new SchedulerManager(makeFakeKernel([]));
  assert.equal(sm.getCpuPercent(1), 0);
});

test('getCpuPercent: 50% over 1s for a 500ms-busy process', () => {
  const procs = [{ pid: 1, cpuTime: 0 }];
  const sm = new SchedulerManager(makeFakeKernel(procs));
  sm.mainThreadBusyRatio = 1;
  sm._installIdleAttribution = () => {}; // skip rAF wiring in tests
  // First sample.
  procs[0].cpuTime = 0;
  sm.cpuSamples.set(1, [{ ts: 1000, cpuTime: 0 }]);
  // Second sample: 500ms cpu over 1000ms wall.
  sm.cpuSamples.get(1).push({ ts: 2000, cpuTime: 500 });
  const pct = sm.getCpuPercent(1);
  assert.ok(pct >= 49 && pct <= 51, `expected ~50, got ${pct}`);
});

test('getCpuPercent: clamps at 100', () => {
  const procs = [{ pid: 1, cpuTime: 0 }];
  const sm = new SchedulerManager(makeFakeKernel(procs));
  sm.mainThreadBusyRatio = 1;
  sm._installIdleAttribution = () => {};
  sm.cpuSamples.set(1, [
    { ts: 1000, cpuTime: 0 },
    { ts: 1500, cpuTime: 9999 }
  ]);
  const pct = sm.getCpuPercent(1);
  assert.equal(pct, 100);
});

test('getCpuPercent: scales by mainThreadBusyRatio', () => {
  const procs = [{ pid: 1, cpuTime: 0 }];
  const sm = new SchedulerManager(makeFakeKernel(procs));
  sm.mainThreadBusyRatio = 0.5;
  sm._installIdleAttribution = () => {};
  sm.cpuSamples.set(1, [
    { ts: 1000, cpuTime: 0 },
    { ts: 2000, cpuTime: 1000 }
  ]);
  const pct = sm.getCpuPercent(1);
  // Raw is 100, scaled by 0.5 → ~50.
  assert.ok(pct >= 49 && pct <= 51, `expected ~50, got ${pct}`);
});
