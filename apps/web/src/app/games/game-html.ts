import { parseGamePackage, type GamePackage } from "@cosmora/contracts/game-package";

// Trusted, fixed runtime. Model output is JSON data and is never executable source.
const runtime = String.raw`(() => {
  'use strict';
  const game = JSON.parse(document.getElementById('game-data').textContent);
  const autoStart = document.getElementById('game-data').dataset.autostart === 'true';
  const byId = id => document.getElementById(id);
  const status = byId('status'), scoreText = byId('score'), timeText = byId('time');
  const startButton = byId('start'), pauseButton = byId('pause'), restartButton = byId('restart');
  const canvas = byId('stage'), cards = byId('cards'), quiz = byId('quiz'), choices = byId('choices');
  const ctx = canvas.getContext('2d');
  let started = false, playing = false, ended = false, elapsed = 0, last = 0, raf = 0, round = 0;
  let score = 0, mistakes = 0, entities = [], spawn = 0, playerX = 320, board = [], opened = [], locked = false, question = 0, answered = false;
  const pressed = new Set();
  byId('title').textContent = game.title; document.title = game.title;
  byId('description').textContent = game.description;
  byId('rules').textContent = game.genre === 'arcade' ? 'Собирайте круги, избегайте крестов. Управление: ← / →, A / D или касание игрового поля. Три столкновения завершают игру.' : game.genre === 'memory' ? 'Открывайте по две карточки. Найдите все одинаковые пары.' : 'Выберите ответ и перейдите к следующему вопросу.';
  canvas.hidden = game.genre !== 'arcade'; cards.hidden = game.genre !== 'memory'; quiz.hidden = game.genre !== 'quiz';
  function controls() { startButton.disabled = playing; startButton.textContent = ended ? 'Начать заново' : started ? 'Продолжить' : 'Начать'; pauseButton.disabled = !playing; }
  function write(node, value) { if (node.textContent !== value) node.textContent = value; }
  function stats() {
    write(scoreText, game.genre === 'arcade' ? 'Счёт: ' + score + ' / ' + game.target_score + ' · Ошибки: ' + mistakes + ' / 3' : game.genre === 'memory' ? 'Найдено пар: ' + score + ' / ' + game.pairs.length : 'Верных ответов: ' + score + ' / ' + game.questions.length);
    write(timeText, game.genre === 'arcade' ? 'Осталось: ' + Math.max(0, Math.ceil(game.duration_seconds - elapsed)) + ' с' : 'Время: ' + Math.floor(elapsed) + ' с');
  }
  function finish(message) { playing = false; ended = true; pressed.clear(); cancelAnimationFrame(raf); status.textContent = message; stats(); controls(); }
  function pause() { if (!playing) return; elapsed += Math.max(0, performance.now() - last) / 1000; playing = false; pressed.clear(); cancelAnimationFrame(raf); status.textContent = 'Пауза'; stats(); controls(); }
  function shuffle(items) { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; }
  function renderCards() {
    cards.replaceChildren();
    board.forEach((card, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '?'; button.setAttribute('aria-label', 'Карточка ' + (index + 1));
      button.onclick = () => {
        if (!playing || locked || card.matched || opened.includes(index)) return;
        opened.push(index); button.textContent = card.label; button.setAttribute('aria-label', card.label + ' · карточка ' + (index + 1)); button.setAttribute('aria-pressed', 'true');
        if (opened.length !== 2) return;
        const [first, second] = opened;
        if (board[first].pair === board[second].pair) {
          board[first].matched = board[second].matched = true; cards.children[first].disabled = cards.children[second].disabled = true; opened = []; score++; stats();
          if (score === game.pairs.length) finish('Все пары найдены!');
        } else {
          locked = true; const currentRound = round;
          setTimeout(() => { if (round !== currentRound) return; for (const position of [first, second]) { cards.children[position].textContent = '?'; cards.children[position].setAttribute('aria-label', 'Карточка ' + (position + 1)); cards.children[position].setAttribute('aria-pressed', 'false'); } opened = []; locked = false; }, 650);
        }
      };
      cards.append(button);
    });
  }
  function renderQuestion() {
    const current = game.questions[question]; byId('question').textContent = (question + 1) + '. ' + current.prompt;
    choices.replaceChildren(); byId('feedback').textContent = ''; byId('next').disabled = true; answered = false;
    current.choices.forEach((label, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = () => {
        if (!playing || answered) return; answered = true;
        for (const choice of choices.children) choice.disabled = true;
        if (index === current.answer_index) { score++; byId('feedback').textContent = 'Верно!'; }
        else byId('feedback').textContent = 'Правильный ответ: ' + current.choices[current.answer_index];
        byId('next').disabled = false; stats();
      };
      choices.append(button);
    });
  }
  byId('next').onclick = () => { if (!playing || !answered) return; question++; if (question === game.questions.length) finish('Викторина завершена: ' + score + ' / ' + game.questions.length); else renderQuestion(); };
  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, 640, 360);
    ctx.strokeStyle = '#dedede'; ctx.beginPath(); ctx.moveTo(0, 310); ctx.lineTo(640, 310); ctx.stroke();
    ctx.fillStyle = '#202020'; ctx.fillRect(playerX - 16, 320, 32, 22);
    for (const entity of entities) {
      ctx.strokeStyle = '#202020'; ctx.fillStyle = '#202020'; ctx.lineWidth = 3;
      if (entity.good) { ctx.beginPath(); ctx.arc(entity.x, entity.y, 9, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(entity.x - 9, entity.y - 9); ctx.lineTo(entity.x + 9, entity.y + 9); ctx.moveTo(entity.x + 9, entity.y - 9); ctx.lineTo(entity.x - 9, entity.y + 9); ctx.stroke(); }
    }
  }
  function tick(now) {
    if (!playing) return;
    const duration = Math.max(0, now - last) / 1000, dt = Math.min(duration, 0.05); elapsed += duration; last = now;
    if (game.genre === 'arcade') {
      playerX += ((pressed.has('ArrowRight') || pressed.has('d') || pressed.has('D') ? 1 : 0) - (pressed.has('ArrowLeft') || pressed.has('a') || pressed.has('A') ? 1 : 0)) * 360 * dt;
      playerX = Math.max(18, Math.min(622, playerX)); spawn += dt;
      if (spawn >= 0.65 - game.speed * 0.05) { spawn = 0; entities.push({x: 20 + Math.random() * 600, y: -12, good: Math.random() > 0.25}); }
      for (const entity of entities) {
        entity.y += (90 + game.speed * 24) * dt;
        if (Math.abs(entity.y - 331) < 19 && Math.abs(entity.x - playerX) < 24) { if (entity.good) score++; else mistakes++; entity.y = 1000; }
      }
      entities = entities.filter(entity => entity.y < 390); draw();
      if (score >= game.target_score) return finish('Цель достигнута! Собрано: ' + game.collectible + '.');
      if (mistakes >= 3) return finish('Три столкновения. Попробуйте ещё раз.');
      if (elapsed >= game.duration_seconds) return finish('Время вышло. Счёт: ' + score + ' / ' + game.target_score);
    }
    stats(); raf = requestAnimationFrame(tick);
  }
  function reset() {
    round++; cancelAnimationFrame(raf); started = true; playing = true; ended = false; elapsed = 0; last = performance.now(); score = 0; mistakes = 0; entities = []; spawn = 0; playerX = 320; opened = []; locked = false; question = 0; pressed.clear();
    status.textContent = 'Игра идёт';
    if (game.genre === 'memory') { board = shuffle(game.pairs.flatMap((label, pair) => [{label, pair, matched: false}, {label, pair, matched: false}])); renderCards(); }
    if (game.genre === 'quiz') renderQuestion();
    if (game.genre === 'arcade') { draw(); canvas.focus(); }
    stats(); controls(); raf = requestAnimationFrame(tick);
  }
  startButton.onclick = () => {
    if (!started || ended) return reset(); if (playing) return;
    playing = true; last = performance.now(); status.textContent = 'Игра идёт'; controls(); raf = requestAnimationFrame(tick);
    if (game.genre === 'arcade') canvas.focus();
  };
  pauseButton.onclick = pause; restartButton.onclick = reset;
  window.addEventListener('keydown', event => { if (game.genre !== 'arcade' || !playing) return; if (['ArrowLeft','ArrowRight','a','A','d','D'].includes(event.key)) { event.preventDefault(); pressed.add(event.key); } });
  window.addEventListener('keyup', event => pressed.delete(event.key)); window.addEventListener('blur', () => pressed.clear());
  canvas.addEventListener('pointermove', event => { if (!playing) return; if (event.pointerType === 'mouse' && event.buttons === 0) return; const rect = canvas.getBoundingClientRect(); playerX = Math.max(18, Math.min(622, (event.clientX - rect.left) * 640 / rect.width)); draw(); });
  canvas.addEventListener('pointerdown', event => { if (!playing) return; canvas.setPointerCapture(event.pointerId); const rect = canvas.getBoundingClientRect(); playerX = Math.max(18, Math.min(622, (event.clientX - rect.left) * 640 / rect.width)); draw(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { playing = false; cancelAnimationFrame(raf); });
  stats(); controls(); draw(); if (autoStart) reset();
})();`;

const css = `*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#222;font:14px/1.55 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:24px}h1{font-size:28px;letter-spacing:-.04em;margin:0 0 10px}p{margin:8px 0}button{font:inherit;cursor:pointer;border:1px solid #ccc;border-radius:9px;background:#fff;color:#222;padding:9px 14px}button:focus-visible,canvas:focus-visible{outline:2px solid #222;outline-offset:3px}button:disabled{opacity:.5;cursor:default}.controls,.stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.stats{justify-content:space-between;font-variant-numeric:tabular-nums}#stage{width:100%;height:auto;display:block;border:1px solid #ddd;border-radius:12px;touch-action:none}#stage[hidden],#cards[hidden],#quiz[hidden]{display:none}#cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}#cards button{min-height:78px;overflow-wrap:anywhere}#cards button[aria-pressed=true]{background:#222;color:#fff}#choices{display:grid;gap:10px;margin:15px 0}#choices button{text-align:left}#status{font-weight:600;min-height:24px}#rules,#description,footer{color:#666}footer{font-size:11px;margin-top:24px}@media(max-width:450px){main{padding:16px}h1{font-size:23px}#cards{gap:6px}#cards button{padding:6px;min-height:65px}}`;

export function createGameHtml(
  input: GamePackage,
  autoStart = false,
  nonce = crypto.randomUUID().replaceAll("-", "")
): string {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw Error("INVALID_GAME_NONCE");
  const game = parseGamePackage(JSON.stringify(input));
  const data = JSON.stringify(game).replace(
    /[<>&\u2028\u2029]/g,
    (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")
  );
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Kosmora Games</title><style>${css}</style></head><body><main><header><h1 id="title"></h1><p id="description"></p><p id="rules"></p></header><div class="controls"><button type="button" id="start">Начать</button><button type="button" id="pause">Пауза</button><button type="button" id="restart">Заново</button></div><p id="status" role="status" aria-live="polite">Нажмите «Начать»</p><div class="stats"><output id="score"></output><output id="time"></output></div><canvas id="stage" width="640" height="360" tabindex="0" aria-label="Игровое поле аркады"></canvas><section id="cards" aria-label="Карточки памяти"></section><section id="quiz" aria-label="Викторина"><h2 id="question"></h2><div id="choices"></div><p id="feedback" aria-live="polite"></p><button type="button" id="next">Дальше</button></section><footer>Создано в Kosmora Games · автономный прототип</footer></main><script type="application/json" id="game-data" data-autostart="${autoStart}" nonce="${nonce}">${data}</script><script nonce="${nonce}">${runtime}</script></body></html>`;
}
