// Re-proves every turn-based campaign puzzle: replays its stored optimal solution against the level data
// that ships in game/campaign.js, at four simulation frame rates, and checks win + par.
//   node tools/puzzles/verify.js
// After editing a puzzle in campaign.js, update its entry in solutions.json (find a new optimal plan with
// S.solve / your own search from turn-sim.js) and run this again.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = require('./turn-sim.js');
const solutions = require('./solutions.json');
const ctx = { console, Math, Set, Map, Object, Array, JSON, Number, Date, localStorage: { getItem: () => null, setItem: () => {} } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'campaign.js'), 'utf8'), ctx);
let bad = 0;
const puzzles = ctx.CAMPAIGN.levels('turn').filter((l) => l.kind === 'puzzle' && solutions[l.id]);
for (const L of puzzles) {
  const spec = Object.assign({}, L); delete spec.coach;
  const sol = solutions[L.id];
  const res = [1 / 30, 1 / 45, 1 / 60, 1 / 90].map((dt) => { const r = S.replay(spec, sol.solution, dt); return r.outcome + '@T' + r.turns; });
  const ok = res.every((x) => x === res[0]) && res[0].startsWith('win') && +res[0].split('T')[1] === L.par && L.par === sol.par && L.limit === sol.limit;
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + L.id.padEnd(4) + L.name.padEnd(16) + 'par ' + L.par + ' limit ' + L.limit + ' | ' + res.join(' '));
}
console.log(bad ? bad + ' FAILED' : 'ALL ' + puzzles.length + ' PUZZLES VERIFIED');
process.exit(bad ? 1 : 0);
