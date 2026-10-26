import { parseGameProject, type GameProject } from "@cosmora/contracts/game-project";
import { staticSiteDocument } from "../sites/site-preview";

// Only this fixed program executes in the iframe. Project JavaScript executes in a worker,
// which has no DOM/navigation/cookies and inherits the frame's network-denying CSP.
export const GAME_SOURCE_RUNTIME = String.raw`
const data = JSON.parse(document.getElementById('project-data').textContent);
const canvas = document.getElementById('game-stage');
let worker = null, stage = canvas, frame = 0, last = 0, sentAt = 0, waiting = false, timer = 0;
let messages = 0, activeAt = 0, messageWindow = 0, windowMessages = 0;
const status = document.getElementById('game-status');
const log = document.getElementById('game-log');
function report(kind, text) {
  if (log.childElementCount >= 100) log.firstElementChild.remove();
  const line = document.createElement('li'); line.textContent = kind + ': ' + String(text).slice(0,1000); log.append(line);
}
function stop(message) {
  cancelAnimationFrame(frame); clearInterval(timer);
  if(worker) worker.terminate(); worker=null; waiting=false;
  status.textContent=message || 'Остановлено';
}
function tick(now) {
  if(!worker) return;
  frame=requestAnimationFrame(tick);
  if(waiting || document.hidden) { last=now; return; }
  const dt=last ? Math.min(.05,(now-last)/1000) : 0; last=now;
  waiting=true; sentAt=performance.now(); worker.postMessage({type:'frame',dt});
}
function start() {
  stop(); messages=0; messageWindow=performance.now(); windowMessages=0; log.replaceChildren();
  if(!HTMLCanvasElement.prototype.transferControlToOffscreen) { status.textContent='Браузер не поддерживает запуск Canvas в Worker'; return; }
  const next=document.createElement('canvas'); next.id='game-stage'; next.width=800; next.height=500; next.tabIndex=0;
  next.setAttribute('aria-label','Игровое поле'); stage.replaceWith(next); stage=next;
  let url;
  try {
    url=URL.createObjectURL(new Blob([data.worker],{type:'text/javascript'}));
    worker=new Worker(url); URL.revokeObjectURL(url);
    worker.onerror=(event)=>{ event.preventDefault(); report('Ошибка',event.message+' · строка '+event.lineno); stop('Ошибка в game.js'); };
    worker.onmessage=(event)=>{
      if(!worker) return;
      const now=performance.now(); if(now-messageWindow>1000){messageWindow=now;windowMessages=0;}
      if(++windowMessages>240){stop('Слишком много сообщений от игрового кода');return;}
      if(++messages>200000) { stop('Достигнут предел сообщений запуска'); return; }
      const message=event.data;
      if(!message || typeof message !== 'object') return;
      if(message.type==='ready') { status.textContent='Игра запущена'; waiting=false; last=0; frame=requestAnimationFrame(tick); }
      else if(message.type==='done') waiting=false;
      else if(message.type==='error') { report('Ошибка',message.text); stop('Ошибка в game.js'); }
      else if(message.type==='log') report('Консоль',message.text);
    };
    stage.addEventListener('keydown',event=>{ event.preventDefault(); worker?.postMessage({type:'key',key:event.key.toLowerCase(),down:true}); });
    stage.addEventListener('keyup',event=>{ event.preventDefault(); worker?.postMessage({type:'key',key:event.key.toLowerCase(),down:false}); });
    stage.addEventListener('blur',()=>worker?.postMessage({type:'reset-input'}));
    for(const name of ['pointerdown','pointermove','pointerup','pointercancel']) stage.addEventListener(name,event=>{
      if(name==='pointerdown') { stage.focus(); stage.setPointerCapture(event.pointerId); }
      const rect=stage.getBoundingClientRect(); worker?.postMessage({type:'pointer',x:(event.clientX-rect.left)*800/rect.width,y:(event.clientY-rect.top)*500/rect.height,down:(event.buttons&1)!==0});
    });
    const offscreen=stage.transferControlToOffscreen();
    waiting=true; sentAt=performance.now(); activeAt=sentAt;
    worker.postMessage({type:'init',canvas:offscreen},[offscreen]);
    timer=setInterval(()=>{ const now=performance.now(); if(waiting && now-sentAt>3000) stop('Код не отвечает: запуск остановлен'); else if(now-activeAt>600000) stop('Завершён 10-минутный запуск. Можно запустить снова.'); },500);
    stage.focus();
  } catch(error) { if(url) URL.revokeObjectURL(url); report('Ошибка',error.message); stop('Запуск недоступен'); }
}
document.getElementById('game-start').addEventListener('click',start);
document.getElementById('game-stop').addEventListener('click',()=>stop());
document.addEventListener('visibilitychange',()=>worker?.postMessage({type:'reset-input'}));
if(data.autoStart) start();
`;

export function gameWorkerSource(code: string): string {
  return (
    String.raw`
let game;
const send = self.postMessage.bind(self);
let logged=0;
for(const level of ['log','info','warn','error']) console[level]=(...items)=>{
  if(logged++<100) send({type:'log',text:items.map(item=>String(item).slice(0,500)).join(' ').slice(0,1000)});
};
self.onmessage=(event)=>{
  const message=event.data;
  try {
    if(message.type==='init') {
      game={canvas:message.canvas,ctx:message.canvas.getContext('2d'),keys:new Set(),pointer:{x:0,y:0,down:false},onUpdate:null,onKey:null,onPointer:null};
      (function(){
` +
    code +
    String.raw`
      })();
      send({type:'ready'});
    } else if(game && message.type==='frame') { if(typeof game.onUpdate==='function') game.onUpdate(message.dt); send({type:'done'}); }
    else if(game && message.type==='key') { if(message.down) game.keys.add(message.key); else game.keys.delete(message.key); game.onKey?.(message.key,message.down); }
    else if(game && message.type==='pointer') { Object.assign(game.pointer,{x:message.x,y:message.y,down:message.down}); game.onPointer?.(game.pointer); }
    else if(game && message.type==='reset-input') { game.keys.clear(); game.pointer.down=false; }
  } catch(error) { send({type:'error',text:String(error?.stack || error).slice(0,1000)}); self.close(); }
};
`
  );
}

/** Browser-only serializer: model HTML is inert/sanitized, CSS is a text node, JS stays worker data. */
export function createGameProjectHtml(project: GameProject, autoStart = false): string {
  const parsed = parseGameProject(JSON.stringify(project));
  const file = (name: string) => parsed.files.find((item) => item.name === name)!.content;
  const doc = document.implementation.createHTMLDocument("Kosmora Games");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
  doc.head.prepend(policy);
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  doc.head.prepend(charset);
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  doc.head.append(viewport);
  const style = document.createElement("style");
  style.textContent =
    `body{margin:0;padding:16px;font:14px system-ui;background:#fafafa;color:#171717}#game-stage{display:block;width:100%;max-width:800px;aspect-ratio:8/5;background:#fff;touch-action:none}button{padding:8px 12px;margin:0 8px 10px 0}#game-log{max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-word}` +
    file("styles.css");
  // CSS closing-tag text is escaped when the serialized HTML is reparsed.
  style.textContent = style.textContent.replace(/<\/style/gi, "<\\/style");
  doc.head.append(style);
  const source = new DOMParser().parseFromString(
    staticSiteDocument(file("scene.html")),
    "text/html"
  );
  // Prevent IDs from shadowing trusted controls. The scene is static instructions only.
  for (const node of source.body.querySelectorAll("[id]")) node.removeAttribute("id");
  const scene = document.createElement("section");
  scene.innerHTML = source.body.innerHTML;
  // User <style> content would share the trusted runtime document; all styling is in styles.css.
  for (const node of scene.querySelectorAll("style")) node.remove();
  doc.body.append(scene);
  const controls = document.createElement("div");
  controls.innerHTML =
    '<button id="game-start">Запустить заново</button><button id="game-stop">Остановить</button><p id="game-status" role="status">Готово к запуску</p><canvas id="game-stage" width="800" height="500" tabindex="0" aria-label="Игровое поле"></canvas><ol id="game-log" aria-label="Консоль игры"></ol>';
  doc.body.append(controls);
  const data = document.createElement("script");
  data.type = "application/json";
  data.id = "project-data";
  data.textContent = JSON.stringify({
    worker: gameWorkerSource(file("game.js")),
    autoStart
  }).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  doc.body.append(data);
  // Browsers hide nonce attributes when a script is inserted into a document.
  // Serialize the trusted script explicitly so the exported CSP nonce stays intact.
  return (
    "<!doctype html>" +
    doc.documentElement.outerHTML.replace(
      /<\/body><\/html>$/,
      () => `<script nonce="${nonce}">${GAME_SOURCE_RUNTIME}</script></body></html>`
    )
  );
}
