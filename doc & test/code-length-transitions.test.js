const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { gunzipSync } = require('node:zlib');

const root = join(__dirname, '..');

function section(source, start, end) {
  const startIndex = source.search(start);
  assert.notEqual(startIndex, -1, 'section start exists');
  const rest = source.slice(startIndex);
  const endIndex = rest.search(end);
  assert.notEqual(endIndex, -1, 'section end exists');
  return rest.slice(0, endIndex);
}

function createGame(source) {
  const game = {
    console: { log() {} },
    gamesolver_blob: {},
    scriptsFullyLoaded: true,
    nbColumns: 3,
    nbMaxAttempts: 8,
    currentAttemptNumber: 1,
    gameWon: false,
    nbOfStatsFilled_Perfs: 0,
    relative_performances_of_codes_played: [],
    PerformanceNA: -999,
    CompressedDisplayMode: false,
    newGameButtonIniName: 'New',
    newGameButtonObject: {},
    settingsButtonObject: {},
    allRadioButtons: Array.from({ length: 5 }, () => ({})),
    nbColumnsRadioObjects: Array.from({ length: 5 }, (_, i) => ({ value: i + 3, checked: i === 0 })),
    nbNewGameEventsCancelled: 0,
    nbOnGoingGamesAborted: 0,
    dsCode: false,
    starts: [],
    confirmations: 0,
    confirm() { game.confirmations++; return false; },
    newGameButtonClick_delayed() {
      game.starts.push(game.nbColumnsRadioObjects.find(radio => radio.checked).value);
      game.nbColumns = game.starts.at(-1);
      game.currentAttemptNumber = 1;
      game.gameWon = false;
      game.nbOfStatsFilled_Perfs = 0;
      game.relative_performances_of_codes_played = [];
    }
  };
  vm.createContext(game);
  vm.runInContext(section(source, /newGameButtonClick\s*=\s*function/, /resetCurrentCodeButtonClick\s*=\s*function/), game);
  vm.runInContext(section(source, /gameOnGoing\s*=\s*function/, /function allPossibleCodesFilled/), game);
  const controls = section(source, /if\s*\(gameWon\s*&&\s*!allPerformancesFilled\(\)\)/, /playRandomCodeButtonObject.disabled/);
  vm.runInContext('function refreshControls() { ' + controls + ' }', game);
  game.refreshControls();
  return game;
}

function finishGame(game, won, scoringComplete = true) {
  game.gameWon = won;
  game.currentAttemptNumber = won ? 3 : game.nbMaxAttempts + 1;
  game.nbOfStatsFilled_Perfs = scoringComplete ? game.currentAttemptNumber - 1 : 0;
  game.relative_performances_of_codes_played = Array(game.nbOfStatsFilled_Perfs).fill(0);
  game.refreshControls();
}

function selectLength(game, columns) {
  game.nbColumnsRadioObjects.forEach(radio => { radio.checked = radio.value === columns; });
  game.newGameButtonClick(columns, true);
  game.refreshControls();
}

function assertLengthControls(game, disabled) {
  assert.ok(game.nbColumnsRadioObjects.every(radio => radio.disabled === disabled));
  assert.ok(game.allRadioButtons.every(label => label.className === (disabled ? 'radio disabled' : 'radio')));
}

for (const filename of ['SuperMasterMind_uncompressed.js', 'SuperMasterMind.js', 'SuperMasterMind.js.gz']) {
  const data = readFileSync(join(root, filename));
  const source = (filename.endsWith('.gz') ? gunzipSync(data) : data).toString();

  test(filename + ': a fresh game allows length changes', () => {
    const game = createGame(source);
    assertLengthControls(game, false);
    selectLength(game, 4);
    assert.deepEqual(game.starts, [4]);
  });

  test(filename + ': an active game locks length changes without aborting', () => {
    const game = createGame(source);
    game.currentAttemptNumber = 2;
    game.refreshControls();
    assertLengthControls(game, true);
    game.newGameButtonClick(4, true);
    assert.deepEqual(game.starts, []);
    assert.equal(game.confirmations, 0);
    assert.equal(game.nbOnGoingGamesAborted, 0);
    game.newGameButtonClick(0, true);
    assert.equal(game.confirmations, 1);
    assert.deepEqual(game.starts, []);
  });

  test(filename + ': a win waits for scoring before unlocking lengths', () => {
    const game = createGame(source);
    finishGame(game, true, false);
    assert.equal(game.newGameButtonObject.disabled, true);
    assertLengthControls(game, true);
    game.newGameButtonClick(4, true);
    assert.deepEqual(game.starts, []);
    finishGame(game, true);
    assert.equal(game.newGameButtonObject.disabled, false);
    assertLengthControls(game, false);
    selectLength(game, 4);
    assert.deepEqual(game.starts, [4]);
    assert.equal(game.confirmations, 0);
  });

  test(filename + ': completed wins allow every supported length transition', () => {
    for (let from = 3; from <= 7; from++) {
      for (let to = 3; to <= 7; to++) {
        if (from === to) continue;
        const game = createGame(source);
        game.nbColumns = from;
        finishGame(game, true);
        assertLengthControls(game, false);
        selectLength(game, to);
        assert.deepEqual(game.starts, [to]);
        assert.equal(game.confirmations, 0);
        assert.equal(game.nbOnGoingGamesAborted, 0);
      }
    }
  });

  test(filename + ': repeated wins progress from 3 through 7 without a reload', () => {
    const game = createGame(source);
    for (let to = 4; to <= 7; to++) {
      finishGame(game, true);
      selectLength(game, to);
      assert.equal(game.nbColumns, to);
      assert.equal(game.currentAttemptNumber, 1);
      assert.equal(game.gameWon, false);
      assertLengthControls(game, false);
    }
    assert.deepEqual(game.starts, [4, 5, 6, 7]);
  });

  test(filename + ': exhausted attempts also allow a new length', () => {
    const game = createGame(source);
    finishGame(game, false);
    assertLengthControls(game, false);
    selectLength(game, 5);
    assert.deepEqual(game.starts, [5]);
    assert.equal(game.confirmations, 0);
  });
}
