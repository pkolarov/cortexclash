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
      id: 'r1', kind: 'lesson', free: true, name: 'FIRST STEPS', tag: 'MOVE · CAPTURE', goal: 'DRAIN THE ENEMY CASTLE',
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
      you: [[1, 9, 1], [7, 9, 5]], walls: [[3, 6], [4, 6], [5, 6]], foe: [], foeE: 14, noElim: [false, true], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('SMALL = FAST', ['LOW NUMBERS RUN FAR AND FAST.', 'HIGH NUMBERS CRAWL, BUT HIT', 'HARD AND DRAIN FASTER.']),
        C('WALLS', ['WALLS BLOCK PIECES. GO AROUND.', 'A 1 RUNS 6 CELLS, A 5 ONLY 2.']),
      ] }],
    },
    {
      id: 'r3', kind: 'lesson', free: true, name: 'FIRST BLOOD', tag: 'ATTACK', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 4]], foe: [[4, 3, 2]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('ENEMY AHEAD', ['LAND ON AN ENEMY PIECE TO', 'ATTACK IT. YOU DEAL YOUR', 'NUMBER AS DAMAGE.']),
        C('BIGGER WINS', ['YOUR 4 DESTROYS THEIR 2 AND', 'SURVIVES. IF THE DEFENDER', 'LIVES THROUGH IT, YOUR PIECE', 'IS LOST. EQUAL = ATTACKER WINS.']),
      ] }],
    },
    {
      id: 'r4', kind: 'lesson', free: true, name: 'TWO MAKE ONE', tag: 'COMBINE', goal: 'DESTROY THE ENEMY PIECE',
      you: [[2, 9, 3], [6, 9, 3]], foe: [[4, 3, 5]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('TOO STRONG', ['A 3 CANNOT BEAT THE 5 AHEAD.']),
        C('COMBINE', ['TAP ONE OF YOUR PIECES, THEN', 'TAP ANOTHER OF YOURS: THEY', 'MERGE. NUMBERS ADD (MAX 6).', '3 + 3 = 6 BEATS A 5.']),
      ] }],
    },
    {
      id: 'r5', kind: 'lesson', free: true, name: 'DIVIDE', tag: 'SPLIT', goal: 'DESTROY ALL ENEMY PIECES',
      you: [[4, 9, 6]], foe: [[0, 3, 1], [8, 3, 1], [4, 3, 2]], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('A 6 IS SLOW', ['IT MOVES ONE CELL AT A TIME.', 'THREE ENEMIES, FAR APART.']),
        C('SPLIT', ['DOUBLE-TAP A PIECE (OR PRESS', 'SPLIT) AND PICK A FRAGMENT.', 'SMALL PIECES MOVE FAR + FAST.', 'THEN MERGE THEM BACK LATER.']),
      ] }],
    },
    {
      id: 'r6', kind: 'lesson', free: true, name: 'CHARGED UP', tag: 'POWER-UPS', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 3]], foe: [[4, 3, 5]], powerups: [{ type: 'charge', c: 4, r: 6 }], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [C('OUTMATCHED', ['A 3 CANNOT BEAT A 5.', 'MAYBE THERE IS HELP ON THE', 'BOARD...'])] }],
    },
    {
      id: 'r7', kind: 'lesson', free: true, name: 'HOLD THE LINE', tag: 'SHIELD', goal: 'DESTROY THE ENEMY PIECE',
      you: [[4, 9, 2]], foe: [[4, 3, 5]], foeE: 6, powerups: [{ type: 'shield', c: 4, r: 8 }], ai: 'cpu-script',
      // the 5 marches down the middle and finally hits the cell where the shield sits
      script: [{ at: 4, from: [4, 3], to: [4, 5] }, { at: 7, from: [4, 5], to: [4, 7] }, { at: 10, from: [4, 7], to: [4, 8] }],
      coach: [{ on: 'start', cards: [C('INCOMING!', ['A BIG ENEMY 5 IS MARCHING DOWN', 'THE MIDDLE. YOUR 2 CANNOT WIN', 'A FIGHT. GRAB THE SHIELD ONE', 'CELL AHEAD AND HOLD YOUR GROUND.'])] }],
    },
    {
      id: 'r8', kind: 'lesson', free: true, name: 'SPEED RUN', tag: 'BOLT', goal: 'DRAIN THE ENEMY CASTLE FIRST',
      you: [[4, 9, 2]], foe: [[7, 4, 3]], foeE: 4, youE: 4, powerups: [{ type: 'bolt', c: 4, r: 7 }], ai: 'cpu-script',
      script: [{ at: 1, from: [7, 4], to: [7, 8] }, { at: 2.5, from: [7, 8], to: [4, 11] }],
      coach: [{ on: 'start', cards: [C('RACE!', ['THE ENEMY 3 IS HEADING FOR YOUR', 'CASTLE, AND YOUR CASTLE IS LOW.', 'DRAIN THEIRS FIRST!'])] }],
    },
    {
      id: 'r9', kind: 'lesson', free: true, name: 'UNDER SIEGE', tag: 'REPAIR', goal: 'DESTROY ALL ENEMY PIECES',
      you: [[2, 9, 5]], foe: [[4, 11, 3], [4, 3, 4]], youE: 4, powerups: [{ type: 'heart', c: 3, r: 10 }], ai: 'cpu-still',
      coach: [{ on: 'start', cards: [
        C('INTRUDER!', ['AN ENEMY PIECE IS PARKED ON YOUR', 'CASTLE, DRAINING IT, AND YOUR', 'ENERGY IS ALMOST GONE.', 'THROW IT OUT, FAST!']),
      ] }],
    },
    {
      id: 'b1', kind: 'battle', name: 'FIRST BATTLE', tag: 'CPU · EASY', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 0, ai: 'cpu-easy',
      coach: [{ on: 'start', cards: [C('A REAL BATTLE', ['SEVEN PIECES EACH. POWER-UPS APPEAR', 'ON THE BOARD AT RANDOM.', 'USE EVERYTHING YOU LEARNED.'])] }],
    },
    { id: 'b2', kind: 'battle', name: 'THE WALL', tag: 'CPU · NORMAL', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 1, ai: 'cpu-normal' },
    { id: 'b3', kind: 'battle', name: 'BUNKERS', tag: 'CPU · HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 2, ai: 'cpu-hard' },
    { id: 'b4', kind: 'battle', name: 'CROSSFIRE', tag: 'CPU · VERY HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 3, ai: 'cpu-veryhard' },
    { id: 'b5', kind: 'battle', name: 'CHAOS', tag: 'CPU · INHUMAN', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 5, ai: 'cpu-inhuman',
      coach: [{ on: 'start', cards: [C('FINAL BOSS', ['RANDOM WALLS. RANDOM ARMIES.', 'AN OPPONENT THAT NEVER MISSES.'])] }] },
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
    {"id":"p03","kind":"puzzle","free":true,"name":"FIRST BLOOD","tag":"ATTACK","goal":"BREAK THE GUARD, DRAIN THE CASTLE","walls":[[3,0],[5,0],[3,1],[5,1],[3,2],[5,2],[3,3],[5,3],[3,4],[5,4],[4,0]],"you":[[4,9,4],[2,8,2]],"foe":[[4,3,3],[7,1,1]],"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":4,"par":3,"coach":[{"on":"start","cards":[{"title":"HIT THEM","lines":["LAND ON AN ENEMY PIECE TO ATTACK.","YOU DEAL DAMAGE EQUAL TO YOUR","NUMBER. THEIR NUMBER SHRINKS","BY THAT MUCH."]},{"title":"BIGGER WINS","lines":["IF THEY DROP BELOW ZERO THEY DIE","AND YOU KEEP YOUR FULL NUMBER.","IF THEY SURVIVE, YOU DIE.","AN EXACT TIE KILLS BOTH."]},{"title":"CLEAR THE WAY","lines":["PIECES CANNOT JUMP OTHERS.","THE 3 GUARD PLUGS THE GATE.","SEND YOUR 4 TO BREAK IT, THEN","PARK ON THE CASTLE TO DRAIN IT."]}]}]},
    {"id":"p04","kind":"puzzle","free":true,"name":"TWO MAKE ONE","tag":"COOPERATE","goal":"BREAK THE GUARD","walls":[[0,5],[1,5],[2,5],[3,5],[5,5],[6,5],[7,5],[8,5],[3,6],[5,6]],"you":[[0,9,3],[4,8,4]],"foe":[[4,5,6]],"foeE":12,"ai":"cpu-still","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"DAMAGE STAYS","lines":["A HIT THAT DOES NOT KILL STILL","WOUNDS THE TARGET FOR GOOD.","HIT A 6 WITH A 4: IT IS A 2 NOW."]},{"title":"TWO MAKE ONE","lines":["YOUR 3 AND YOUR 4 CAN NOT BEAT","THE 6 GUARD ALONE. TOGETHER","THEY ARE 7. BOTH MUST HIT IT."]},{"title":"LINE UP THE FOLLOW-UP","lines":["THE GATE LANE FITS ONE ATTACKER","AT A TIME. STRIKE WITH ONE AND","SLIDE THE OTHER IN BEHIND IT."]}]}]},
    {"id":"p05","kind":"puzzle","free":true,"name":"DIVIDE","tag":"SPLIT","goal":"DESTROY ALL 3 FOE PIECES","you":[[5,8,6]],"foe":[[1,4,3],[1,6,1],[5,3,2]],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"SPLIT","lines":["A 6 IS STRONG BUT SLOW:","IT MOVES JUST 1 CELL.","A 1 FLIES UP TO 6 CELLS."]},{"title":"DIVIDE","lines":["TAP A PIECE, PICK AN AMOUNT TO","SEND, THEN TAP A TARGET.","THE REST STAYS WHERE IT IS."]},{"title":"CHIP AWAY","lines":["A HIT COSTS THE ATTACKER VALUE.","A SMALL PIECE CAN DIE AND STILL","CHIP A BIG FOE. TWO 2S BEAT A 3."]}]}]},
    {"id":"p06","kind":"puzzle","free":true,"name":"CHARGE UP","tag":"CHARGE","goal":"GRAB THE CHARGE, BREAK THE GUARD","walls":[[3,5],[4,5],[5,5]],"you":[[6,9,3]],"foe":[[4,1,4]],"powerups":[{"type":"charge","c":2,"r":5}],"youE":12,"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"A GUARD YOU CANNOT BEA","lines":["THE FOE 4 SITS ON ITS CASTLE.","YOUR 3 ATTACKS IT AND LOSES:","THE 4 ONLY DROPS TO 1, YOU DIE."]},{"title":"CHARGE POWER-UP","lines":["LAND ON THE GLOWING CHARGE CELL.","IT GIVES +2 VALUE, FOREVER (MAX 6).","FLYING OVER IT DOES NOTHING."]},{"title":"BIGGER HITS HARDER","lines":["A 5 HITS A 4: THE GUARD DIES,","AND YOUR 5 SURVIVES INTACT.","BIG PIECES MOVE LESS: A 5 = 2 CELLS."]}]}]},
    {"id":"p07","kind":"puzzle","free":true,"name":"SHIELD TRAP","tag":"SHIELD","goal":"DESTROY EVERY FOE PIECE","walls":[[3,3],[5,3],[3,4],[5,4],[3,5],[5,5],[3,6],[5,6],[3,7],[5,7],[3,8],[5,8],[3,9],[5,9]],"you":[[8,12,3]],"foe":[[4,2,5],[6,6,2]],"powerups":[{"type":"shield","c":6,"r":6}],"youE":8,"foeE":24,"noElim":[false,false],"script":[[{"from":[4,2],"to":[4,4]}],[{"from":[4,4],"to":[4,6]}],[{"from":[4,6],"to":[4,8]}],[{"from":[4,8],"to":[4,10]}],[{"from":[4,10],"to":[4,11]}]],"ai":"cpu-script","limit":4,"par":4,"coach":[{"on":"start","cards":[{"title":"SHIELD = ONE FREE KILL","lines":["A SHIELD BLOCKS ONE HIT.","THE PIECE THAT HITS IT DIES","AND THE SHIELD POPS.","LAND ON A SHIELD TO TAKE IT."]},{"title":"THE MARCHING 5","lines":["THE BIG FOE WALKS DOWN THE HALL,","2 CELLS A TURN, STRAIGHT ON.","YOU CAN'T BEAT A 5 HEAD-ON.","TRAP IT INSTEAD."]},{"title":"STAND WHERE IT LANDS","lines":["IT LANDS ON ROWS 4, 6, 8, 10.","BLOCK ITS PATH AND IT JUST STOPS.","STAND ON ITS LANDING CELL,","SHIELDED, BEFORE IT MOVES."]}]}]},
    {"id":"p08","kind":"puzzle","free":true,"name":"RESCUE","tag":"HEART","goal":"SAVE YOUR CASTLE, CRUSH THE CAMPER","walls":[[3,10],[5,10]],"you":[[7,6,1],[1,9,3],[6,8,2]],"foe":[[4,11,4]],"powerups":[{"type":"heart","c":7,"r":10}],"youE":4,"ai":"cpu-still","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"UNDER SIEGE","lines":["A FOE PIECE IS PARKED ON YOUR","CASTLE AND DRAINS IT EVERY","SECOND. THE BAR IS ALMOST EMPTY.","ONE RESOLVE AND YOU ARE DEAD."]},{"title":"HEART = +12 ENERGY","lines":["LAND A PIECE ON THE HEART TO","REFUEL YOUR CASTLE (+12).","FLYING OVER IT DOES NOTHING.","SEND THE SMALL FAST PIECE."]},{"title":"THEN STRIKE TOGETHER","lines":["THE CAMPER IS A 4. HIT IT WITH","3 AND 2 IN THE SAME TURN.","LINE YOUR HITTERS UP ON ROW 11","OR COLUMN 4 FIRST, THEN FIRE."]}]}]},
    {"id":"p09","kind":"puzzle","free":true,"name":"PHOTO FINISH","tag":"BOLT \u00b7 TIMING","goal":"WIN THE RACE TO THE SHIELD","walls":[[5,3],[7,3],[5,4],[7,4],[5,5],[7,5],[7,6],[5,7],[7,7],[5,8],[7,8],[5,9],[7,9],[2,5],[3,5],[4,5],[2,7],[3,7],[4,7]],"you":[[3,9,1]],"foe":[[8,1,1]],"powerups":[{"type":"bolt","c":6,"r":12},{"type":"shield","c":6,"r":6},{"type":"charge","c":2,"r":8}],"script":[[{"from":[8,1],"to":[6,1]}],[{"from":[6,1],"to":[6,6]}]],"ai":"cpu-script","limit":2,"par":2,"coach":[{"on":"start","cards":[{"title":"THE FOE RUNNER","lines":["IT RACES YOU TO THE SHIELD AT","THE CROSSING. WHOEVER LANDS ON","IT FIRST TAKES IT, AND A SHIELD","WIPES OUT WHATEVER HITS IT."]},{"title":"WHO ARRIVES FIRST?","lines":["BOTH SIDES MOVE AT ONCE. SMALL","PIECES FLY FASTER, AND A LONGER","TRIP TAKES LONGER. COUNT THE","CELLS BEFORE YOU COMMIT."]},{"title":"BOLT = SPEED","lines":["A BOLT MAKES A PIECE 70% FASTER","FOR ABOUT 5 TURNS. IT ADDS NO","RANGE, IT ONLY DECIDES WHO","LANDS FIRST."]}]}]},
    {"id":"p10","kind":"puzzle","free":true,"name":"DOUBLE STRIKE","tag":"FORK","goal":"BREAK THROUGH, DRAIN THE CASTLE","walls":[[3,0],[5,0],[3,1],[5,1],[3,2],[5,2]],"you":[[3,7,1],[2,4,1],[6,8,2]],"foe":[[4,2,3,"s"],[6,4,2]],"powerups":[{"type":"charge","c":6,"r":4}],"youE":12,"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":3,"par":3,"coach":[{"on":"start","cards":[{"title":"PAWNS OPEN DOORS","lines":["A SMALL PIECE MOVES FIRST AND FAST.","SEND IT INTO A SHIELDED GUARD:","IT DIES, BUT THE SHIELD POPS.","A PAWN HIT ALSO CHIPS A GUARD."]},{"title":"STRIKE IN PAIRS","lines":["SEND PAWN AND BIG PIECE AT THE","SAME CELL IN THE SAME TURN.","THE PAWN LANDS FIRST AND CLEARS","THE WAY FOR THE PIECE BEHIND IT."]},{"title":"CHARGE UNDER THE GUARD","lines":["A CHARGE HIDES UNDER THE FOE GUARD.","KILL THE GUARD AND YOU LAND ON IT:","YOUR PIECE GETS +2 PERMANENTLY.","A V4 BEATS THE V3 DOOR GUARD."]}]}]},
    {"id":"p11","kind":"puzzle","free":true,"name":"FORTRESS","tag":"FORTRESS","goal":"BREAK THE KEEP, DRAIN THE CASTLE","walls":[[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[2,0],[6,0],[2,1],[6,1],[2,2],[6,2],[3,2],[5,2]],"you":[[1,10,2],[7,10,1]],"foe":[[4,4,3,"s"],[4,2,3]],"powerups":[{"type":"charge","c":1,"r":7},{"type":"shield","c":7,"r":8}],"youE":20,"foeE":2,"noElim":[false,true],"ai":"cpu-still","limit":5,"par":5,"coach":[{"on":"start","cards":[{"title":"SHIELDS","lines":["A SHIELDED GUARD BLOCKS ONE HIT.","THE ATTACKER DIES, THE SHIELD POPS.","SEND A SMALL PIECE IN FIRST."]},{"title":"CHARGE","lines":["LANDING ON A CHARGE GIVES +2.","A BIGGER PIECE WINS THE CLASH","AND KEEPS ITS FULL VALUE."]},{"title":"RANGE & GATES","lines":["A STRONG PIECE MOVES FEWER CELLS.","THE KEEP HAS ONE GATE: COLUMN 4.","PLAN EACH HOP. 5 TURNS, NO SPARES."]}]}]},
    {"id":"p12","kind":"puzzle","free":true,"name":"GRANDMASTER","tag":"FINAL EXAM","goal":"OUTPLAY THE FOE, DRAIN THEIR CASTLE","walls":[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,1],[1,1],[2,1],[3,1],[5,1],[6,1],[7,1],[8,1],[0,2],[1,2],[2,2],[3,2],[5,2],[6,2],[7,2],[8,2],[0,3],[1,3],[2,3],[6,3],[7,3],[8,3],[0,4],[1,4],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[0,5],[1,5],[2,5],[3,5],[5,5],[6,5],[7,5],[8,5],[0,6],[1,6],[2,6],[3,6],[5,6],[6,6],[7,6],[8,6],[0,7],[1,7],[2,7],[6,7],[7,7],[8,7],[0,8],[1,8],[2,8],[3,8],[5,8],[6,8],[7,8],[8,8],[0,9],[1,9],[2,9],[6,9],[7,9],[8,9],[0,10],[1,10],[2,10],[3,10],[5,10],[6,10],[7,10],[8,10],[0,11],[1,11],[2,11],[3,11],[5,11],[6,11],[7,11],[8,11],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12]],"you":[[3,9,3]],"foe":[[4,5,6],[4,2,4],[4,10,3]],"powerups":[{"type":"shield","c":5,"r":7},{"type":"heart","c":3,"r":7},{"type":"charge","c":4,"r":3},{"type":"bolt","c":3,"r":3}],"youE":3,"foeE":2.5,"noElim":[false,true],"script":[[{"from":[4,5],"to":[4,6]}],[{"from":[4,6],"to":[4,5]}],[{"from":[4,5],"to":[4,6]},{"from":[4,10],"to":[4,11]}],[{"from":[4,6],"to":[4,5]}],[{"from":[4,5],"to":[4,6]}],[{"from":[4,6],"to":[4,5]}]],"ai":"cpu-script","limit":6,"par":6,"coach":[{"on":"start","cards":[{"title":"READ THE SWEEPER","lines":["THE 6-GUARD SHUFFLES ONE STEP","EACH TURN: ROW 5, ROW 6, ROW 5.","WATCH WHERE IT ENDS EVERY TURN."]},{"title":"SHIELD = BATTERING RAM","lines":["A SHIELDED PIECE WINS EVERY","COLLISION: THE FOE IS WIPED OUT.","GRAB THE SHIELD, THEN MEET IT."]},{"title":"SPEND YOUR TEMPO","lines":["A RAIDER WILL DRAIN YOUR CASTLE.","A HEART BUYS TIME, A CHARGE","BREAKS THE GUARD. PLAN 6 TURNS."]}]}]}
  ];
  // </PUZZLES>
  const TURN_END = [
    { id: 'b6', kind: 'battle', name: 'OPEN FIELD', tag: 'CPU · NORMAL', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 0, ai: 'cpu-normal',
      coach: [{ on: 'start', cards: [C('FULL GAME', ['NO MORE PUZZLES: SEVEN PIECES', 'EACH, 30 SECONDS TO PLAN A TURN.'])] }] },
    { id: 'b7', kind: 'battle', name: 'BUNKERS', tag: 'CPU · HARD', goal: 'DESTROY ALL PIECES OR DRAIN THEIR CASTLE', board: 2, ai: 'cpu-hard' },
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
