// Cortex Clash — campaign: levels (a tutorial that grows into real battles / chess-style puzzles),
// scoring, coach cards, local leaderboard. Pure data + logic (no DOM, no canvas) so it can be tested headlessly.
'use strict';
(() => {
  const LIVES = 3;
  const LB_MAX = 10;

  // ---------------------------------------------------------------------------------------------
  // LEVELS. Coordinates are [col,row]; the board is 9x13. YOU are the bottom player (castle 4,11),
  // the foe is the top player (castle 4,1). A piece is [col,row,value] (+ 's' = starts shielded).
  //   kind  'lesson' (a teaching sandbox) | 'puzzle' (turn-based, win within `limit` turns) | 'battle'
  //   free  true = losing costs no life (retry as often as you like; a retry just costs a few points)
  //   coach [{on:'start'|'camp'|'turn:N', cards:[{title, lines[]}]}]  — teaching cards (lines <= 34 chars).
  //         Power-up explanations are NOT listed here: the first time a pickup shows up on the board in a
  //         run it gets its card automatically (POWER_INFO below).
  // ---------------------------------------------------------------------------------------------
  const C = (title, lines) => ({ title, lines });

  const RTS = [
    {
      id: 'r1', kind: 'lesson', free: true, name: 'FIRST STEPS', tag: 'MOVE · DRAIN', goal: 'DRAIN THE ENEMY CASTLE',
      you: [[4, 9, 3]], foe: [], foeE: 6, noElim: [false, true], ai: 'cpu-still',
      coach: [
        { on: 'start', cards: [
          C('WELCOME, COMMANDER', ['THIS IS YOUR PIECE.', 'THE NUMBER IS ITS STRENGTH.']),
          C('MOVE', ['TAP YOUR PIECE. GLOWING CELLS', 'SHOW WHERE IT CAN GO.', 'TAP ONE (OR DRAG) TO MOVE.']),
          C('YOUR MISSION', ['REACH THE ENEMY CASTLE AT THE', 'TOP AND STAY ON IT.', 'A PARKED PIECE DRAINS IT.']),
        ] },
        { on: 'camp', cards: [C('DRAINING!', ['THE ENEMY CASTLE IS LOSING', 'ENERGY. STAY PUT!'])] },
      ],
    },
    {
      id: 'r2', kind: 'lesson', free: true, name: 'RUN OR HIT', tag: 'SPEED · WALLS', goal: 'DRAIN THE ENEMY CASTLE',
      you: [[1, 9, 1], [4, 9, 5]], walls: [[3, 6], [4, 6], [5, 6]], foe: [], foeE: 14, noElim: [false, true], ai: 'cpu-still',
      coach: [
        { on: 'start', cards: [
          C('SMALL = FAST', ['LOW NUMBERS RUN FAR AND FAST.', 'HIGH NUMBERS CRAWL, BUT HIT', 'HARD AND DRAIN FASTER.']),
          C('WALLS', ['WALLS BLOCK PIECES. GO AROUND.', 'A 1 RUNS 6 CELLS, A 5 ONLY 2.']),
        ] },
        { on: 'camp', cards: [C('BIG = FASTER DRAIN', ['A 5 DRAINS 5X FASTER THAN A 1.', 'STAY PUT AND WATCH THE BAR.'])] },
      ],
    },
    {
      id: 'r3', kind: 'lesson', free: true, name: 'FIRST BLOOD', tag: 'ATTACK', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 4]], foe: [[4, 3, 2]], walls: [[3, 0], [4, 0], [5, 0], [3, 1], [5, 1], [3, 2], [4, 2], [5, 2]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('ENEMY AHEAD', ['LAND ON AN ENEMY PIECE TO', 'ATTACK IT. YOU DEAL YOUR', 'NUMBER AS DAMAGE.']),
        C('BIGGER WINS', ['YOUR 4 DESTROYS THEIR 2 AND', 'SURVIVES. IF THE DEFENDER', 'LIVES THROUGH IT, YOUR PIECE', 'IS LOST. EQUAL = ATTACKER WINS.']),
      ] }],
    },
    {
      id: 'r4', kind: 'lesson', free: true, name: 'TWO MAKE ONE', tag: 'COMBINE', goal: 'DESTROY ALL ENEMY PIECES',
      // two 5s: a pair of 3s can never clear them one at a time, a merged 6 can
      you: [[2, 6, 3], [6, 6, 3]], foe: [[3, 3, 5], [5, 3, 5]], walls: [[3, 0], [4, 0], [5, 0], [3, 1], [5, 1], [3, 2], [4, 2], [5, 2]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('TOO STRONG', ['TWO ENEMY 5S. YOUR 3S CANNOT', 'CLEAR BOTH ONE AT A TIME.']),
        C('COMBINE', ['TAP ONE OF YOUR PIECES, THEN', 'TAP ANOTHER OF YOURS: THEY', 'MERGE. NUMBERS ADD (MAX 6).', 'A 6 BEATS A 5 AND KEEPS ITS 6.']),
      ] }],
    },
    {
      id: 'r5', kind: 'lesson', free: true, name: 'DIVIDE', tag: 'SPLIT', goal: 'DESTROY ALL ENEMY PIECES',
      you: [[4, 9, 6]], foe: [[0, 3, 1], [8, 3, 1], [4, 3, 2]], walls: [[3, 0], [4, 0], [5, 0], [3, 1], [5, 1], [3, 2], [4, 2], [5, 2]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('A 6 IS SLOW', ['IT MOVES ONE CELL AT A TIME.', 'THREE ENEMIES, FAR APART.']),
        C('SPLIT', ['DOUBLE-TAP A PIECE (OR PRESS', 'SPLIT) AND PICK A FRAGMENT.', 'SMALL PIECES MOVE FAR + FAST.', 'THEN MERGE THEM BACK LATER.']),
      ] }],
    },
    {
      id: 'r6', kind: 'lesson', free: true, name: 'CHARGED UP', tag: 'POWER-UPS', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 3]], foe: [[4, 3, 5]], walls: [[3, 0], [4, 0], [5, 0], [3, 1], [5, 1], [3, 2], [4, 2], [5, 2]], powerups: [{ type: 'charge', c: 4, r: 6 }], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [C('OUTMATCHED', ['A 3 CANNOT BEAT A 5.', 'MAYBE THERE IS HELP ON THE', 'BOARD...'])] }],
    },
    {
      id: 'r7', kind: 'lesson', free: true, name: 'HOLD THE LINE', tag: 'SHIELD', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 2]], foe: [[4, 3, 5]], youE: 24, powerups: [{ type: 'shield', c: 4, r: 8 }], ai: 'cpu-script',
      // the 5 marches down the middle and hits the cell where the shield sits at ~9 s. The tail entries only fire
      // if it is still there (it walks around a player who did not take the shield and camps on their castle).
      script: [{ at: 2.5, from: [4, 3], to: [4, 5] }, { at: 5.5, from: [4, 5], to: [4, 7] }, { at: 8.5, from: [4, 7], to: [4, 8] },
        { at: 11.5, from: [4, 8], to: [4, 10] }, { at: 12, from: [4, 8], to: [3, 9] }, { at: 14.5, from: [3, 9], to: [4, 10] }, { at: 15.5, from: [4, 10], to: [4, 11] }],
      coach: [{ on: 'start', cards: [C('INCOMING!', ['A BIG ENEMY 5 MARCHES DOWN THE', 'MIDDLE. TAKE THE SHIELD ONE CELL', 'AHEAD, THEN HOLD STILL: THE 5 WILL', 'HIT IT AND BREAK. DO NOT ATTACK.'])] }],
    },
    {
      id: 'r8', kind: 'lesson', free: true, name: 'SPEED RUN', tag: 'BOLT', goal: 'DRAIN THE ENEMY CASTLE FIRST',
      you: [[4, 9, 3]], foe: [[7, 4, 3]], foeE: 4, youE: 7, powerups: [{ type: 'bolt', c: 4, r: 5 }], ai: 'cpu-script',
      // the enemy 3 sets off after 3 s and reaches your castle ~6 s in; it then needs ~3 s to drain 7 energy.
      // (timings tuned with a human-latency model: ~1.5 s to the first order, ~0.9 s between orders)
      script: [{ at: 3, from: [7, 4], to: [7, 8] }, { at: 5, from: [7, 8], to: [4, 11] }],
      coach: [{ on: 'start', cards: [C('RACE!', ['THE ENEMY 3 IS HEADING FOR YOUR', 'CASTLE. DRAIN THEIRS FIRST!', 'A BOLT SITS ON YOUR ROUTE: LAND', 'ON IT FOR EXTRA SPEED.'])] }],
    },
    {
      id: 'r9', kind: 'lesson', free: true, name: 'UNDER SIEGE', tag: 'REPAIR', goal: 'DESTROY ALL ENEMY PIECES',
      you: [[1, 8, 5]], foe: [[4, 11, 3], [4, 3, 4]], youE: 12, powerups: [{ type: 'heart', c: 3, r: 10 }], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('INTRUDER!', ['AN ENEMY PIECE IS PARKED ON YOUR', 'CASTLE, DRAINING IT, AND YOUR', 'ENERGY IS RUNNING LOW.', 'THROW IT OUT, FAST!']),
        C('THEN STEP OFF', ['A PARKED PIECE DRAINS ITS OWN', 'CASTLE TOO. AFTER THE KILL, MOVE', 'OFF IT AND HUNT THE LAST ENEMY.']),
      ] }],
    },
    {
      id: 'b1', kind: 'battle', name: 'FIRST BATTLE', tag: 'CPU · NORMAL', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 0, ai: 'cpu-normal',
      coach: [{ on: 'start', cards: [C('A REAL BATTLE', ['SEVEN PIECES EACH. POWER-UPS APPEAR', 'ON THE BOARD AT RANDOM.', 'USE EVERYTHING YOU LEARNED.'])] }],
    },
    { id: 'b2', kind: 'battle', name: 'THE WALL', tag: 'CPU · HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 1, ai: 'cpu-hard' },
    { id: 'b3', kind: 'battle', name: 'BUNKERS', tag: 'CPU · VERY HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 2, ai: 'cpu-veryhard' },
    { id: 'b4', kind: 'battle', name: 'CROSSFIRE', tag: 'VERY HARD · +1 FOE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 3, ai: 'cpu-veryhard', mods: { foeExtra: [[4, 3, 3]] },
      coach: [{ on: 'start', cards: [C('REINFORCED', ['THE ENEMY BROUGHT AN EXTRA 3.', 'EIGHT PIECES AGAINST YOUR SEVEN.'])] }] },
    { id: 'b5', kind: 'battle', name: 'CHAOS', tag: 'CPU · INHUMAN', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 5, ai: 'cpu-inhuman', reward: 'life',
      coach: [{ on: 'start', cards: [C('CHECKPOINT BOSS', ['RANDOM WALLS. RANDOM ARMIES.', 'AN OPPONENT THAT NEVER MISSES.', 'WIN IT AND EARN AN EXTRA LIFE.'])] }] },
    // ---- beyond chaos: boss tier ----
    { id: 'b6', kind: 'battle', boss: true, name: 'THE MAZE', tag: 'INHUMAN · MAZE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 4, ai: 'cpu-inhuman',
      coach: [{ on: 'start', cards: [C('LOST IN THE MAZE', ['NARROW CORRIDORS FAVOUR THE', 'PIECE THAT ARRIVES FIRST.'])] }] },
    { id: 'b7', kind: 'battle', boss: true, name: 'IRON GATE', tag: 'INHUMAN · +1 FOE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 2, ai: 'cpu-inhuman', mods: { foeExtra: [[4, 3, 3]] } },
    { id: 'b8', kind: 'battle', boss: true, name: 'SIEGE', tag: 'INHUMAN · LOW CASTLE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 0, ai: 'cpu-inhuman', mods: { youE: 24 },
      coach: [{ on: 'start', cards: [C('WOUNDED', ['YOUR CASTLE STARTS AT 24 ENERGY', 'INSTEAD OF 36. DEFEND IT, AND GRAB', 'ANY HEART THAT APPEARS.'])] }] },
    { id: 'b9', kind: 'battle', boss: true, name: 'NEMESIS', tag: 'CPU · NEMESIS', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 1, ai: 'cpu-nemesis', reward: 'life',
      coach: [{ on: 'start', cards: [C('THE NEMESIS', ['THREE FLAWLESS MOVES A TURN.', 'IT WILL PUNISH EVERY MISTAKE.', 'WIN IT AND EARN AN EXTRA LIFE.'])] }] },
    { id: 'b10', kind: 'battle', boss: true, name: 'CROSSFIRE II', tag: 'NEMESIS · CROSSFIRE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 3, ai: 'cpu-nemesis' },
    { id: 'b11', kind: 'battle', boss: true, name: 'FINAL CHAOS', tag: 'NEMESIS · CHAOS', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 5, ai: 'cpu-nemesis', mods: { youE: 30 },
      coach: [{ on: 'start', cards: [C('THE LAST CPU', ['RANDOM WALLS, RANDOM ARMIES, AND', 'THE STRONGEST OPPONENT YET.', 'GOOD LUCK, COMMANDER.'])] }] },
  ];

  // Turn-based: a ladder of chess-style puzzles (fixed positions, win within N turns), then two real games.
  // Puzzles p02..p12 are generated + verified by search (see PUZZLES below).
  const TURN_INTRO = {
    id: 'p01', kind: 'puzzle', free: true, name: 'FIRST MOVE', tag: 'PLAN · GO', goal: 'DRAIN THE ENEMY CASTLE',
    you: [[4, 6, 3]], foe: [], foeE: 2, noElim: [false, true], ai: 'cpu-still', limit: 3, par: 2,
    coach: [{ on: 'start', cards: [
      C('TURN-BASED', ['PLAN YOUR MOVES, THEN PRESS GO.', 'BOTH SIDES MOVE AT THE SAME TIME.']),
      C('GIVE AN ORDER', ['TAP YOUR PIECE, THEN A GLOWING', 'CELL. AN ARROW SHOWS THE ORDER.', 'TAP THE PIECE AGAIN TO CANCEL.']),
      C('YOUR MISSION', ['PUT A PIECE ON THE ENEMY CASTLE', 'AND LEAVE IT THERE: IT DRAINS', 'WHILE THE TURN PLAYS OUT.', 'EVERY PUZZLE HAS A TURN LIMIT.']),
    ] }],
  };
  // <PUZZLES> (generated from the verified designs; every one has a proven optimal solution)
  const PUZZLES = [
    {"id":"p02","kind":"puzzle","free":true,"name":"LONG WAY ROUND","tag":"ROUTES","goal":"REACH AND DRAIN THE ENEMY CASTLE","walls":[[0,7],[1,7],[2,7],[3,7],[4,7],[5,7],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4]],"you":[[6,10,1],[4,10,4]],"foeE":0.4,"noElim":[false,true],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"SMALL PIECES FLY FAR","lines":["A PIECE MOVES UP TO 7 MINUS ITS","VALUE IN CELLS. VALUE 1 SLIDES 6","CELLS, VALUE 4 ONLY 3.","LOW NUMBERS = LONG REACH."]},{"title":"WALLS BLOCK THE WAY","lines":["YOU CANNOT CROSS WALLS OR PIECES.","LOOK FOR THE GAP AND PLAN A ROUTE","OF STRAIGHT SLIDES, 3 TURNS MAX.","DIAGONALS COUNT AS LONG MOVES TOO."]},{"title":"PICK THE RIGHT PIECE","lines":["THE BIG PIECE IS STRONG BUT SLOW","AND SHORT-RANGED HERE: IT NEEDS 5","TURNS. SEND THE SMALL ONE!","PARK ON THE CASTLE TO DRAIN IT."]}]}]},
    {"id":"p03","kind":"puzzle","free":true,"name":"FIRST BLOOD","tag":"ATTACK","goal":"BREAK THE GUARD, DRAIN THE CASTLE","walls":[[3,0],[5,0],[3,1],[5,1],[3,2],[5,2],[3,3],[5,3],[3,4],[5,4],[4,0]],"you":[[4,9,4],[2,8,2]],"foe":[[4,3,3],[7,1,1]],"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"HIT THEM","lines":["LAND ON AN ENEMY PIECE TO ATTACK.","YOU DEAL DAMAGE EQUAL TO YOUR","NUMBER. THEIR NUMBER SHRINKS","BY THAT MUCH."]},{"title":"BIGGER WINS","lines":["IF THEY DROP BELOW ZERO THEY DIE","AND YOU KEEP YOUR FULL NUMBER.","IF THEY SURVIVE, YOU DIE.","AN EXACT TIE KILLS BOTH."]},{"title":"CLEAR THE WAY","lines":["PIECES CANNOT JUMP OTHERS.","THE 3 GUARD PLUGS THE GATE.","SEND YOUR 4 TO BREAK IT, THEN","PARK ON THE CASTLE TO DRAIN IT."]}]}]},
    {"id":"p04","kind":"puzzle","free":true,"name":"TWO MAKE ONE","tag":"COOPERATE","goal":"BREAK THE GUARD","walls":[[0,5],[1,5],[2,5],[3,5],[5,5],[6,5],[7,5],[8,5],[3,6],[5,6]],"you":[[0,9,3],[4,8,4]],"foe":[[4,5,6]],"foeE":12,"ai":"cpu-still","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"DAMAGE STAYS","lines":["A HIT THAT DOES NOT KILL STILL","WOUNDS THE TARGET FOR GOOD.","HIT A 6 WITH A 4: IT IS A 2 NOW."]},{"title":"TWO MAKE ONE","lines":["YOUR 3 AND YOUR 4 CAN NOT BEAT","THE 6 GUARD ALONE. TOGETHER","THEY ARE 7. BOTH MUST HIT IT."]},{"title":"LINE UP THE FOLLOW-UP","lines":["THE GATE LANE FITS ONE ATTACKER","AT A TIME. STRIKE WITH ONE AND","SLIDE THE OTHER IN BEHIND IT."]}]}]},
    {"id":"p05","kind":"puzzle","free":true,"name":"DIVIDE","tag":"SPLIT","goal":"DESTROY ALL 3 FOE PIECES","you":[[5,8,6]],"foe":[[1,4,3],[1,6,1],[5,3,2]],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"SPLIT","lines":["A 6 IS STRONG BUT SLOW:","IT MOVES JUST 1 CELL.","A 1 FLIES UP TO 6 CELLS."]},{"title":"DIVIDE","lines":["TAP A PIECE, PICK AN AMOUNT TO","SEND, THEN TAP A TARGET.","THE REST STAYS WHERE IT IS."]},{"title":"CHIP AWAY","lines":["A HIT COSTS THE ATTACKER VALUE.","A SMALL PIECE CAN DIE AND STILL","CHIP A BIG FOE. TWO 2S BEAT A 3."]}]}]},
    {"id":"p06","kind":"puzzle","free":true,"name":"CHARGE UP","tag":"CHARGE","goal":"GRAB THE CHARGE, BREAK THE GUARD","walls":[[3,5],[4,5],[5,5]],"you":[[6,9,3]],"foe":[[4,1,4]],"powerups":[{"type":"charge","c":2,"r":5}],"youE":12,"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"A GUARD YOU CAN'T BEAT","lines":["THE FOE 4 SITS ON ITS CASTLE.","YOUR 3 ATTACKS IT AND LOSES:","THE 4 ONLY DROPS TO 1, YOU DIE."]},{"title":"CHARGE POWER-UP","lines":["LAND ON THE GLOWING CHARGE CELL.","IT GIVES +2 VALUE, FOREVER (MAX 6).","FLYING OVER IT DOES NOTHING."]},{"title":"BIGGER HITS HARDER","lines":["A 5 HITS A 4: THE GUARD DIES,","AND YOUR 5 SURVIVES INTACT.","BIG PIECES MOVE LESS: A 5 = 2 CELLS."]}]}]},
    {"id":"p07","kind":"puzzle","free":true,"name":"SHIELD TRAP","tag":"SHIELD","goal":"DESTROY EVERY FOE PIECE","walls":[[3,3],[5,3],[3,4],[5,4],[3,5],[5,5],[3,6],[5,6],[3,7],[5,7],[3,8],[5,8],[3,9],[5,9]],"you":[[8,12,3]],"foe":[[4,2,5],[6,6,2]],"powerups":[{"type":"shield","c":6,"r":6}],"youE":8,"foeE":24,"noElim":[false,false],"script":[[{"from":[4,2],"to":[4,4]}],[{"from":[4,4],"to":[4,6]}],[{"from":[4,6],"to":[4,8]}],[{"from":[4,8],"to":[4,10]}],[{"from":[4,10],"to":[4,11]}]],"ai":"cpu-script","limit":4,"par":4,"coach":[{"on":"start","cards":[{"title":"SHIELD = ONE FREE KILL","lines":["A SHIELD BLOCKS ONE HIT.","THE PIECE THAT HITS IT DIES","AND THE SHIELD POPS.","LAND ON A SHIELD TO TAKE IT."]},{"title":"THE MARCHING 5","lines":["THE BIG FOE WALKS DOWN THE HALL,","2 CELLS A TURN, STRAIGHT ON.","YOU CAN'T BEAT A 5 HEAD-ON.","TRAP IT INSTEAD."]},{"title":"STAND WHERE IT LANDS","lines":["IT LANDS ON ROWS 4, 6, 8, 10.","BLOCK ITS PATH AND IT JUST STOPS.","STAND ON ITS LANDING CELL,","SHIELDED, BEFORE IT MOVES."]}]}]},
    {"id":"p08","kind":"puzzle","free":true,"name":"RESCUE","tag":"HEART","goal":"SAVE YOUR CASTLE, CRUSH THE CAMPER","walls":[[3,10],[5,10]],"you":[[7,6,1],[1,9,3],[6,8,2]],"foe":[[4,11,4]],"powerups":[{"type":"heart","c":7,"r":10}],"youE":4,"ai":"cpu-still","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"UNDER SIEGE","lines":["A FOE PIECE IS PARKED ON YOUR","CASTLE AND DRAINS IT EVERY","SECOND. THE BAR IS ALMOST EMPTY.","ONE RESOLVE AND YOU ARE DEAD."]},{"title":"HEART = +12 ENERGY","lines":["LAND A PIECE ON THE HEART TO","REFUEL YOUR CASTLE (+12).","FLYING OVER IT DOES NOTHING.","SEND THE SMALL FAST PIECE."]},{"title":"THEN STRIKE TOGETHER","lines":["THE CAMPER IS A 4. HIT IT WITH","3 AND 2 IN THE SAME TURN.","LINE YOUR HITTERS UP ON ROW 11","OR COLUMN 4 FIRST, THEN FIRE."]}]}]},
    {"id":"p09","kind":"puzzle","free":true,"name":"PHOTO FINISH","tag":"BOLT \u00b7 TIMING","goal":"WIN THE RACE TO THE SHIELD","walls":[[5,3],[7,3],[5,4],[7,4],[5,5],[7,5],[7,6],[5,7],[7,7],[5,8],[7,8],[5,9],[7,9],[2,5],[3,5],[4,5],[2,7],[3,7],[4,7]],"you":[[3,9,1]],"foe":[[8,1,1]],"powerups":[{"type":"bolt","c":6,"r":12},{"type":"shield","c":6,"r":6},{"type":"charge","c":2,"r":8}],"script":[[{"from":[8,1],"to":[6,1]}],[{"from":[6,1],"to":[6,6]}]],"ai":"cpu-script","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"THE FOE RUNNER","lines":["IT RACES YOU TO THE SHIELD AT","THE CROSSING. WHOEVER LANDS ON","IT FIRST TAKES IT, AND A SHIELD","WIPES OUT WHATEVER HITS IT."]},{"title":"WHO ARRIVES FIRST?","lines":["BOTH SIDES MOVE AT ONCE. SMALL","PIECES FLY FASTER, AND A LONGER","TRIP TAKES LONGER. COUNT THE","CELLS BEFORE YOU COMMIT."]},{"title":"BOLT = SPEED","lines":["A BOLT MAKES A PIECE 70% FASTER","FOR ABOUT 5 TURNS. IT ADDS NO","RANGE, IT ONLY DECIDES WHO","LANDS FIRST."]}]}]},
    {"id":"p10","kind":"puzzle","free":true,"name":"DOUBLE STRIKE","tag":"FORK","goal":"BREAK THROUGH, DRAIN THE CASTLE","walls":[[3,0],[5,0],[3,1],[5,1],[3,2],[5,2]],"you":[[3,7,1],[2,4,1],[6,8,2]],"foe":[[4,2,3,"s"],[6,4,2]],"powerups":[{"type":"charge","c":6,"r":4}],"youE":12,"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"PAWNS OPEN DOORS","lines":["A SMALL PIECE MOVES FIRST AND FAST.","SEND IT INTO A SHIELDED GUARD:","IT DIES, BUT THE SHIELD POPS.","A PAWN HIT ALSO CHIPS A GUARD."]},{"title":"STRIKE IN PAIRS","lines":["SEND PAWN AND BIG PIECE AT THE","SAME CELL IN THE SAME TURN.","THE PAWN LANDS FIRST AND CLEARS","THE WAY FOR THE PIECE BEHIND IT."]},{"title":"CHARGE UNDER THE GUARD","lines":["A CHARGE HIDES UNDER THE FOE GUARD.","KILL THE GUARD AND YOU LAND ON IT:","YOUR PIECE GETS +2 PERMANENTLY.","A V4 BEATS THE V3 DOOR GUARD."]}]}]},
    {"id":"p11","kind":"puzzle","free":true,"name":"FORTRESS","tag":"FORTRESS","goal":"BREAK THE KEEP, DRAIN THE CASTLE","walls":[[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[2,0],[6,0],[2,1],[6,1],[2,2],[6,2],[3,2],[5,2],[3,4],[5,4],[3,5],[5,5]],"you":[[1,10,2],[7,10,1]],"foe":[[4,4,3,"s"],[4,2,3]],"powerups":[{"type":"charge","c":1,"r":7},{"type":"shield","c":7,"r":8}],"youE":20,"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"SHIELDS","lines":["A SHIELDED GUARD BLOCKS ONE HIT.","THE ATTACKER DIES, THE SHIELD POPS.","SEND A SMALL PIECE IN FIRST."]},{"title":"CHARGE","lines":["LANDING ON A CHARGE GIVES +2.","A BIGGER PIECE WINS THE CLASH","AND KEEPS ITS FULL VALUE."]},{"title":"RANGE & GATES","lines":["A STRONG PIECE MOVES FEWER CELLS.","THE KEEP HAS ONE GATE: COLUMN 4.","PLAN EACH HOP. 5 TURNS, NO SPARES."]}]}]},
    {"id":"p12","kind":"puzzle","free":true,"name":"GRANDMASTER","tag":"FINAL EXAM","goal":"OUTPLAY THE FOE, DRAIN THEIR CASTLE","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[6,3],[7,3],[8,3],[0,4],[1,4],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[0,5],[1,5],[2,5],[3,5],[5,5],[6,5],[7,5],[8,5],[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[0,7],[1,7],[2,7],[6,7],[7,7],[8,7],[0,8],[1,8],[2,8],[3,8],[5,8],[6,8],[7,8],[8,8],[0,9],[1,9],[2,9],[6,9],[7,9],[8,9],[0,10],[1,10],[2,10],[3,10],[5,10],[6,10],[7,10],[8,10],[0,11],[1,11],[2,11],[3,11],[5,11],[6,11],[7,11],[8,11],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12]],"you":[[3,9,3]],"foe":[[4,5,6],[4,2,4],[4,10,3]],"powerups":[{"type":"shield","c":5,"r":7},{"type":"heart","c":3,"r":7},{"type":"charge","c":4,"r":3},{"type":"bolt","c":3,"r":3}],"youE":3,"foeE":2.5,"noElim":[false,true],"script":[[{"from":[4,5],"to":[4,6]}],[{"from":[4,6],"to":[4,5]}],[{"from":[4,5],"to":[4,6]},{"from":[4,10],"to":[4,11]}],[{"from":[4,6],"to":[4,5]}],[{"from":[4,5],"to":[4,6]}],[{"from":[4,6],"to":[4,5]}]],"ai":"cpu-script","limit":6,"par":6,"coach":[{"on":"start","cards":[{"title":"READ THE SWEEPER","lines":["THE 6-GUARD SHUFFLES ONE STEP","EACH TURN: ROW 5, ROW 6, ROW 5.","WATCH WHERE IT ENDS EVERY TURN."]},{"title":"SHIELD = BATTERING RAM","lines":["A SHIELDED PIECE WINS EVERY","COLLISION: THE FOE IS WIPED OUT.","GRAB THE SHIELD, THEN MEET IT."]},{"title":"SPEND YOUR TEMPO","lines":["A RAIDER WILL DRAIN YOUR CASTLE.","A HEART BUYS TIME, A CHARGE","BREAKS THE GUARD. PLAN 6 TURNS."]}]}]},
    {"id":"p13","kind":"puzzle","free":true,"name":"SACRIFICE","tag":"ARRIVAL ORDER","goal":"SACRIFICE PAWNS, THEN DRAIN THE CASTLE","walls":[[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[4,10]],"you":[[1,11,3],[8,12,1],[7,12,1]],"foe":[[4,6,3,"s"]],"foeE":2.5,"noElim":[false,true],"ai":"cpu-still","limit":4,"par":4,"coach":[{"on":"start","cards":[{"title":"SHIELD, THEN CHIP","lines":["A SHIELD KILLS THE FIRST ATTACKER","AND POPS. SPEND A PAWN ON IT.","YOUR 3 MEETS THE GUARD'S 3: AN","EXACT TIE KILLS BOTH. CHIP IT."]},{"title":"ORDER OF ARRIVAL","lines":["ALL PIECES HIT THE SAME CELL IN","ONE TURN. SMALL PIECES FLY FAST,","BUT A LONG TRIP TAKES LONGER.","THE 3 MUST LAND LAST."]},{"title":"STAGE, STRIKE, FINISH","lines":["EACH HITTER NEEDS A STRAIGHT LINE","TO THE GATE GUARD. 4 TURNS ONLY.","THE 3 MUST PARK ON THE CASTLE","FROM ONE CELL AWAY TO DRAIN IT."]}]}]},
    {"id":"p14","kind":"puzzle","free":true,"name":"SPLIT & REJOIN","tag":"SPLIT + MERGE","goal":"SPLIT, REJOIN, SMASH BOTH GUARDS","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[3,3],[5,3],[6,3],[7,3],[8,3],[7,4],[8,4],[7,5],[8,5],[3,6],[5,6],[6,6],[7,6],[8,6]],"you":[[0,12,5]],"foe":[[4,2,4],[4,3,4]],"youE":20,"noElim":[false,false],"ai":"cpu-still","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"TOO SLOW ALONE","lines":["YOUR 5 MOVES 2 CELLS A TURN.","IT NEEDS 6 TURNS TO BREAK IN,","AND YOU ONLY HAVE 5."]},{"title":"SPLIT, THEN REJOIN","lines":["SEND A 2 AND A 3 BY DIFFERENT","ROUTES: ONE THROUGH THE GATE,","ONE AROUND THE WALL'S END.","LAND ONE ON THE OTHER TO MERGE."]},{"title":"WINNERS KEEP THEIR VAL","lines":["A 5 BEATS A 4 AND STAYS A 5.","TWO 4 GUARDS ARE 8 POINTS, BUT","SMALL PIECES DIE ONE AT A TIME.","ONLY A FULL 5 CAN CLEAR BOTH."]}]}]},
    {"id":"p15","kind":"puzzle","free":true,"name":"INTERCEPT","tag":"PILE-UP \u00b7 TIMING","goal":"STOP THE RAIDER BEFORE IT HITS YOUR CASTLE","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[3,3],[5,3],[6,3],[7,3],[8,3],[0,4],[1,4],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[3,5],[5,5],[1,6],[3,6],[5,6],[7,6],[1,7],[3,7],[5,7],[6,7],[1,8],[2,8],[3,8],[5,8],[7,8],[8,8],[1,9],[3,9],[5,9],[7,9],[0,11],[1,11],[2,11],[3,11],[5,11],[6,11],[7,11],[8,11],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12]],"you":[[2,5,1],[6,6,1]],"foe":[[4,2,5]],"powerups":[{"type":"charge","c":2,"r":6},{"type":"charge","c":8,"r":10}],"youE":3,"noElim":[false,false],"script":[[],[{"from":[4,2],"to":[4,4]}],[{"from":[4,4],"to":[4,6]}],[{"from":[4,6],"to":[4,8]}],[{"from":[4,8],"to":[4,10]}],[{"from":[4,10],"to":[4,11]}]],"ai":"cpu-script","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"THE RAIDER","lines":["A FOE 5 WALKS DOWN COLUMN 4.","IT HOLDS ON TURN 1, THEN LANDS ON","ROWS 4, 6, 8, 10 (TURNS 2 TO 5).","TURN 6: IT LANDS ON YOUR CASTLE."]},{"title":"ONE GATE, TWO HITS","lines":["THE ROAD IS WALLED IN. ITS ONLY","GATE IS ROW 10, WHERE THE RAIDER","LANDS ON TURN 5. SEND ONE PIECE","FROM EACH SIDE: NUMBERS ADD UP."]},{"title":"CHARGE FIRST","lines":["TWO 1S CANNOT BEAT A 5. EACH ONE","MUST LAND ON A CHARGE (+2) FIRST.","A 3 FLIES ONLY 4 CELLS, SO PLAN","EVERY HOP. 5 TURNS, NO SPARES."]}]}]},
    {"id":"p16","kind":"puzzle","free":true,"name":"RIGHT ORDER","tag":"TEMPO \u00b7 ORDER","goal":"DESTROY BOTH WALKERS BEFORE THEY DRAIN YOU","walls":[[0,0],[0,1],[0,2],[0,3],[0,4],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[1,0],[1,1],[1,2],[1,3],[1,10],[1,11],[1,12],[2,0],[2,1],[2,2],[2,3],[2,5],[2,6],[2,7],[2,8],[2,10],[2,11],[2,12],[3,0],[3,1],[3,2],[3,3],[3,5],[3,6],[3,7],[3,8],[3,10],[3,11],[3,12],[4,0],[4,4],[4,5],[4,6],[4,7],[4,8],[4,12],[5,0],[5,1],[5,2],[5,3],[5,5],[5,6],[5,7],[5,8],[5,10],[5,11],[5,12],[6,0],[6,1],[6,2],[6,3],[6,10],[6,11],[6,12],[7,0],[7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,8],[7,9],[7,10],[7,11],[7,12],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,6],[8,7],[8,8],[8,9],[8,10],[8,11],[8,12],[0,5],[7,7],[4,2],[3,4],[6,4],[6,9]],"you":[[4,10,1]],"foe":[[2,4,2],[4,3,3]],"powerups":[{"type":"shield","c":1,"r":6},{"type":"shield","c":4,"r":9},{"type":"bolt","c":3,"r":9}],"youE":5,"noElim":[false,false],"script":[[{"from":[2,4],"to":[1,4]}],[{"from":[1,4],"to":[1,9]}],[{"from":[1,9],"to":[4,9]},{"from":[4,3],"to":[6,5]}],[{"from":[4,9],"to":[4,11]},{"from":[6,5],"to":[6,8]}],[{"from":[6,8],"to":[4,10]}],[{"from":[4,10],"to":[4,11]}]],"ai":"cpu-script","limit":7,"par":6,"coach":[{"on":"start","cards":[{"title":"TWO WALKERS","lines":["THE FOE CASTLE IS SEALED: KILL","BOTH WALKERS BEFORE THEY DRAIN","YOURS. THEY TAKE THE SAME ROUTE","EVERY ATTEMPT."]},{"title":"SHIELD = RAM","lines":["A SHIELDED PAWN WINS EVERY CLASH:","A WALKER THAT HITS IT DIES, BUT","THE SHIELD POPS. ONE KILL EACH.","STAND IN ITS PATH AND WAIT."]},{"title":"THE TIMETABLE","lines":["LEFT WALKER: BOTTOM-LEFT CORNER","ON TURN 2, YOUR CASTLE ON TURN 4.","RIGHT WALKER: BESIDE YOUR CASTLE","ON TURN 5, ONTO IT ON TURN 6."]}]}]},
    {"id":"p17","kind":"puzzle","free":true,"name":"HEART OR HAMMER","tag":"TRIAGE \u00b7 HEAL FIRST","goal":"SURVIVE THE SIEGE, DESTROY BOTH FOES","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3],[0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[0,5],[2,5],[3,5],[4,5],[5,5],[6,5],[8,5],[0,6],[2,6],[3,6],[4,6],[5,6],[6,6],[8,6],[0,7],[2,7],[3,7],[4,7],[5,7],[6,7],[8,7],[0,8],[2,8],[3,8],[4,8],[5,8],[6,8],[8,8],[0,9],[8,9],[0,10],[8,10],[0,11],[8,11],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12]],"you":[[5,10,2],[1,8,4]],"foe":[[4,11,5],[7,5,4]],"powerups":[{"type":"heart","c":1,"r":9}],"youE":6.5,"script":[[{"from":[7,5],"to":[7,8]}],[{"from":[7,8],"to":[7,11]}],[{"from":[7,11],"to":[4,11]}],[{"from":[7,11],"to":[4,11]}]],"ai":"cpu-script","limit":4,"par":4,"coach":[{"on":"start","cards":[{"title":"UNDER SIEGE","lines":["A FOE 5 IS PARKED ON YOUR CASTLE","AND DRAINS IT. A SECOND FOE WILL","MARCH DOWN THE RIGHT-HAND HALL."]},{"title":"HEAL OR HIT?","lines":["HITTING NOW KILLS THE 5, BUT THE","CASTLE BURNS OUT FIRST. THE HEART","GIVES +12: GRAB IT BEFORE ALL ELSE."]},{"title":"TWO MAKE SIX","lines":["A 4 AND A 2 MERGE INTO A 6, WHICH","BEATS A 5 AND SURVIVES. BUT A PIECE","ON YOUR OWN CASTLE DRAINS IT: MOVE."]}]}]},
    {"id":"p18","kind":"puzzle","free":true,"name":"TIE BREAKER","tag":"TIES \u00b7 CHARGE","goal":"BREAK THE LINE, DRAIN THE CASTLE","walls":[[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,8],[1,9],[1,10],[1,11],[1,12],[2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[2,6],[2,8],[2,9],[2,10],[2,11],[2,12],[3,0],[3,1],[3,2],[3,3],[3,4],[3,5],[3,6],[3,8],[3,9],[3,10],[3,11],[3,12],[4,0],[4,8],[4,9],[4,10],[4,12],[5,0],[5,1],[5,2],[5,3],[5,4],[5,5],[5,6],[5,8],[5,9],[5,10],[5,11],[5,12],[6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[6,6],[6,8],[6,9],[6,10],[6,11],[6,12],[7,0],[7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,8],[7,9],[7,10],[7,11],[7,12],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,6],[8,7],[8,8],[8,9],[8,10],[8,11],[8,12]],"you":[[1,7,2],[4,5,3],[7,7,4]],"foe":[[4,2,3],[4,3,4],[4,4,4]],"powerups":[{"type":"charge","c":4,"r":7}],"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"SINGLE FILE","lines":["THE GUARDS PLUG A ONE-CELL LANE.","ONLY THE FRONT PIECE CAN STRIKE:","NO PIECE CAN PASS ANOTHER ONE.","SO EXPECT ONE HIT PER TURN."]},{"title":"TIES KILL BOTH","lines":["A 4 HITTING A 4 DESTROYS BOTH.","DAMAGE STAYS ON THE GUARD: A","SMALL HIT FIRST LETS THE NEXT","PIECE FINISH IT AND LIVE."]},{"title":"CHARGE JUNCTION","lines":["BOTH FLANKS CAN REACH THE CHARGE.","A 2 BECOMES A 4, A 4 BECOMES A 6,","BUT A 6 CRAWLS ONE CELL A TURN.","5 TURNS: CHOOSE WHO TAKES IT."]}]}]},
    {"id":"p19","kind":"puzzle","free":true,"name":"DEAD HEAT","tag":"ENDGAME \u00b7 RACE","goal":"OUT-DRAIN THE FOE BEFORE YOUR CASTLE FALLS","walls":[[0,0],[1,0],[2,0],[3,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[3,3],[5,3],[6,3],[7,3],[8,3],[0,4],[8,4],[0,5],[1,5],[2,5],[3,5],[5,5],[6,5],[7,5],[8,5],[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[0,7],[1,7],[2,7],[3,7],[5,7],[6,7],[7,7],[8,7],[0,8],[1,8],[2,8],[3,8],[5,8],[6,8],[7,8],[8,8],[0,9],[1,9],[2,9],[3,9],[5,9],[6,9],[7,9],[8,9],[0,10],[1,10],[2,10],[3,10],[5,10],[6,10],[7,10],[8,10],[0,11],[1,11],[2,11],[3,11],[5,11],[6,11],[7,11],[8,11],[0,12],[1,12],[2,12],[3,12],[5,12],[6,12],[7,12],[8,12]],"you":[[3,4,1],[5,4,1]],"foe":[[4,9,4,"s"]],"powerups":[{"type":"charge","c":7,"r":4},{"type":"heart","c":1,"r":4}],"youE":8,"foeE":9.25,"noElim":[false,true],"script":[[{"from":[4,9],"to":[4,11]}]],"ai":"cpu-script","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"THE SIEGE HAS BEGUN","lines":["A SHIELDED FOE 4 RUNS ONTO YOUR","CASTLE AND DRAINS IT EVERY SECOND.","YOUR CASTLE HOLDS ONLY 8 ENERGY.","THEIRS HOLDS 9. WHO DRAINS FIRST?"]},{"title":"REFUEL AND POWER UP","lines":["HEART: +12 ENERGY FOR YOUR CASTLE.","CHARGE: +2 VALUE, A BIGGER DRAIN.","LAND ON THEM. FLYING OVER DOES","NOTHING. BOTH ARE ON THE ARMS."]},{"title":"COUNT EVERY TURN","lines":["A PARKED PIECE DRAINS 0.7 X ITS","VALUE EVERY SECOND. A TURN LASTS","ABOUT 1.6 SECONDS. TWO PIECES ON","ONE CELL ADD UP. ARRIVE ON TIME."]}]}]},
    {"id":"p20","kind":"puzzle","free":true,"name":"GRANDMASTER II","tag":"ALL FOUR POWER-UPS","goal":"WIN THE RACE, BREAK THE GUARD, DRAIN CASTLE","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[7,3],[8,3],[0,4],[1,4],[3,4],[4,4],[5,4],[7,4],[8,4],[0,5],[1,5],[3,5],[4,5],[5,5],[7,5],[8,5],[0,6],[1,6],[7,6],[8,6],[0,7],[1,7],[3,7],[4,7],[5,7],[7,7],[8,7],[0,8],[1,8],[3,8],[4,8],[5,8],[7,8],[8,8],[0,9],[1,9],[3,9],[4,9],[5,9],[7,9],[8,9],[0,10],[1,10],[7,10],[8,10],[0,11],[1,11],[2,11],[3,11],[5,11],[6,11],[7,11],[8,11],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12]],"you":[[4,10,1],[2,4,1]],"foe":[[4,2,2,"s"],[3,3,1],[2,8,5]],"powerups":[{"type":"bolt","c":6,"r":10},{"type":"shield","c":6,"r":7},{"type":"charge","c":6,"r":3},{"type":"heart","c":2,"r":3}],"youE":14,"foeE":2,"noElim":[false,true],"script":[[{"from":[2,8],"to":[2,10]}],[{"from":[2,10],"to":[4,10]}],[{"from":[4,10],"to":[4,11]},{"from":[3,3],"to":[6,3]}]],"ai":"cpu-script","limit":6,"par":6,"coach":[{"on":"start","cards":[{"title":"READ THE SCRIPT","lines":["THE FOE REPEATS THE SAME PLAN.","A 5 MARCHES DOWN THE LEFT SIDE","AND HITS YOUR CASTLE ON TURN 3.","BE READY BEFORE IT ARRIVES."]},{"title":"THE CHARGE RACE","lines":["ALSO ON TURN 3, A FAST 1 FLIES","ALONG THE TOP ROW AT THE CHARGE.","IF IT LANDS FIRST, THE CHARGE IS","GONE. IF IT HITS YOU, YOU LOSE 1."]},{"title":"NOT ONE POINT TO SPARE","lines":["THE GUARD IS A SHIELDED 2.","ONE PAWN POPS THE SHIELD, DIES,","THEN A 3 MUST FINISH THE GUARD.","YOU OWN EXACTLY ENOUGH. NO LOSSES."]}]}]}
  ];
  // </PUZZLES>
  const TURN_END = [
    { id: 'tb1', kind: 'battle', name: 'OPEN FIELD', tag: 'CPU · HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 0, ai: 'cpu-hard',
      coach: [{ on: 'start', cards: [C('FULL GAME', ['NO MORE PUZZLES: SEVEN PIECES', 'EACH, 30 SECONDS TO PLAN A TURN.', 'EVERY BATTLE COSTS A LIFE TO LOSE.'])] }] },
    { id: 'tb2', kind: 'battle', name: 'BUNKERS', tag: 'CPU · VERY HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 2, ai: 'cpu-veryhard' },
    { id: 'tb3', kind: 'battle', name: 'CROSSFIRE', tag: 'INHUMAN · +1 FOE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 3, ai: 'cpu-inhuman', mods: { foeExtra: [[4, 3, 3]] }, reward: 'life',
      coach: [{ on: 'start', cards: [C('REINFORCED', ['THE ENEMY BROUGHT AN EXTRA 3.', 'WIN IT AND EARN AN EXTRA LIFE.'])] }] },
    { id: 'tb4', kind: 'battle', boss: true, name: 'THE MAZE', tag: 'INHUMAN · LOW CASTLE', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 4, ai: 'cpu-inhuman', mods: { youE: 24 },
      coach: [{ on: 'start', cards: [C('WOUNDED', ['YOUR CASTLE STARTS AT 24 ENERGY', 'INSTEAD OF 36. WATCH THE DRAIN.'])] }] },
    { id: 'tb5', kind: 'battle', boss: true, name: 'FINAL CHAOS', tag: 'INHUMAN · +2 FOES', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 5, ai: 'cpu-inhuman', mods: { foeExtra: [[3, 3, 4], [5, 3, 4]], youE: 28 },
      coach: [{ on: 'start', cards: [C('THE LAST CPU', ['RANDOM WALLS, RANDOM ARMIES, TWO', 'EXTRA ENEMY 4S AND A WOUNDED CASTLE.', 'GOOD LUCK, COMMANDER.'])] }] },
  ];
  const TURN = [TURN_INTRO].concat(PUZZLES, TURN_END);

  const levels = (mode) => (mode === 'turn' ? TURN : RTS);

  // ---- what each pickup does: shown the first time one is on the board in a run ----
  const POWER_INFO = {
    charge: { title: 'POWER CHARGE', col: '#ffd23f', lines: ['+2 TO A PIECE, PERMANENTLY.', 'LAND ON IT TO COLLECT IT.', '(FLYING OVER DOES NOTHING)'] },
    bolt: { title: 'SPEED BOLT', col: '#52ff9d', lines: ['70% FASTER FOR 8 SECONDS.', 'LAND ON IT TO COLLECT IT.'] },
    shield: { title: 'SHIELD', col: '#e8f6ff', lines: ['BLOCKS ONE HIT: AN ATTACKER THAT', 'HITS IT IS DESTROYED.', 'FADES AFTER 12 SECONDS, AND IS', 'LOST WHEN LANDING ON A CASTLE.'] },
    heart: { title: 'REPAIR HEART', col: '#ff5577', lines: ['YOUR CASTLE GETS +12 ENERGY.', 'LAND ON IT TO COLLECT IT.'] },
  };

  const intOr0 = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

  // The level as a game spec for engine.makeLevelGame (lessons/puzzles are sandboxes: no random pickups,
  // no stall timer; turn-based puzzles have no planning clock).
  function levelSpec(L, mode) {
    return Object.assign({}, L, { noSpawn: true, noStall: true, noTimer: mode === 'turn' });
  }

  // Points for beating level `idx` (0-based): { rows:[[label,points]...], total }. Only meaningful when the
  // bottom player (0) won. `tries` = failed attempts at this level. Turn-based game time only advances while
  // resolving, so a battle's "speed" there is counted in turns instead of seconds.
  function levelScore(g, L, idx, mode, tries) {
    const rows = [];
    if (L.kind === 'battle') {
      const nb = Math.max(0, (levels(mode).slice(0, idx).filter((x) => x.kind === 'battle')).length);
      const k = g.castles[0];
      let army = 0;
      for (const p of g.pieces) if (p.owner === 0) army += p.value;
      const speed = mode === 'turn'
        ? Math.max(0, 600 - ((g.turnNo || 1) - 1) * 30)
        : Math.max(0, 600 - Math.round(g.time * 3));
      rows.push(['BATTLE', 1000 + 500 * nb]);
      rows.push(['CASTLE HEALTH', intOr0(500 * Math.max(0, Math.min(1, k.energy / k.max)))]);
      rows.push(['ARMY LEFT', intOr0(army * 50)]);
      rows.push(['SPEED', intOr0(speed)]);
    } else if (L.kind === 'puzzle') {
      const turns = g.turnNo || 1, limit = L.limit || turns, par = L.par || limit;
      rows.push(['SOLVED', 800]);
      rows.push(['TURNS SAVED', 300 * Math.max(0, limit - turns)]);
      rows.push(['PAR BONUS', turns <= par ? 1000 : 0]);
    } else {
      rows.push(['LESSON', 400]);
    }
    if (tries > 0) rows.push(['RETRIES', -Math.min(tries * 250, rows.reduce((a, r) => a + r[1], 0) - 200)]);
    return { rows, total: rows.reduce((a, r) => a + r[1], 0) };
  }

  const clearBonus = (lives) => Math.max(0, lives | 0) * 1000;

  // ---- leaderboard (per mode, top LB_MAX, kept in localStorage) ----
  const lbKey = (mode) => 'cc-lb-' + (mode === 'turn' ? 'turn' : 'rts');
  function cleanName(s) {
    const n = String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    return n || 'AAA';
  }
  function sortBoard(list) {
    return list.sort((a, b) => b.s - a.s || (a.t || 0) - (b.t || 0));
  }
  // If storage can't be read or written (private mode, blocked site data) the board
  // lives in memory for this session instead, so a run's score still shows up.
  const mem = { rts: [], turn: [] };
  const memOnly = { rts: false, turn: false };
  const mk = (mode) => (mode === 'turn' ? 'turn' : 'rts');
  function loadBoard(mode) {
    let raw = null;
    if (memOnly[mk(mode)]) raw = mem[mk(mode)];
    else {
      try { raw = JSON.parse(localStorage.getItem(lbKey(mode)) || '[]'); } catch (e) {
        // unreadable storage -> memory; but corrupt JSON in readable storage is just an empty board
        let readable = true;
        try { localStorage.getItem(lbKey(mode)); } catch (e2) { readable = false; }
        if (!readable) { memOnly[mk(mode)] = true; raw = mem[mk(mode)]; } else raw = [];
      }
    }
    if (!Array.isArray(raw)) raw = [];
    const list = raw
      .filter((e) => e && Number.isFinite(e.s) && e.s > 0)
      .map((e) => ({ n: cleanName(e.n), s: Math.round(e.s), st: Math.max(0, Math.min(99, e.st | 0)), cl: !!e.cl, t: Number.isFinite(e.t) ? e.t : 0 }));
    return sortBoard(list).slice(0, LB_MAX);
  }
  // would `score` earn a place on the board right now?
  function qualifies(mode, score) {
    if (!(score > 0)) return false;
    const list = loadBoard(mode);
    return list.length < LB_MAX || score > list[list.length - 1].s;
  }
  // insert and persist; returns the stored entry (or null if it didn't place)
  function addEntry(mode, entry) {
    const e = {
      n: cleanName(entry.n), s: Math.round(entry.s),
      st: Math.max(0, Math.min(99, entry.st | 0)), cl: !!entry.cl,
      t: Number.isFinite(entry.t) ? entry.t : Date.now(),
    };
    if (!(e.s > 0)) return null;
    const list = sortBoard(loadBoard(mode).concat([e]));
    const kept = list.slice(0, LB_MAX);
    mem[mk(mode)] = kept;
    try { localStorage.setItem(lbKey(mode), JSON.stringify(kept)); } catch (err) { memOnly[mk(mode)] = true; }
    return kept.includes(e) ? e : null;
  }
  function best(mode) {
    const l = loadBoard(mode);
    return l.length ? l[0].s : 0;
  }

  window.CAMPAIGN = { LIVES, LB_MAX, levels, levelSpec, levelScore, POWER_INFO, clearBonus, cleanName, loadBoard, qualifies, addEntry, best, _puzzles: PUZZLES };
})();
