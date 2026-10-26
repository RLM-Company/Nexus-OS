export const GAME_SOURCE_FILES = [
  { name: "scene.html", content: "<h1>Звёздный пилот</h1><p>Стрелки: управление. R: сброс.</p>" },
  { name: "styles.css", content: "body{background:#fff;color:#111}canvas{border:1px solid #ccc}" },
  {
    name: "game.js",
    content: `let x=80, score=0;
console.log('Source game ready');
game.onKey=(key,down)=>{if(down && key==='r'){x=80;score=0;}};
game.onUpdate=(dt)=>{
  if(game.keys.has('arrowright')) x=Math.min(760,x+250*dt);
  if(game.keys.has('arrowleft')) x=Math.max(0,x-250*dt);
  const ctx=game.ctx;ctx.fillStyle='#fff';ctx.fillRect(0,0,800,500);
  ctx.fillStyle='#111';ctx.fillRect(x,400,40,40);ctx.font='22px sans-serif';ctx.fillText('Счёт: '+score,20,35);
};`
  }
];
