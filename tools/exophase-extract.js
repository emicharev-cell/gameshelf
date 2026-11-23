// Ejecutar en la consola (o con el navegador de Claude) estando en https://www.exophase.com/user/EmiChaRev_2001/
// Usa la misma petición que hace la propia página para listar tus juegos y devuelve el JSON
// que espera tools/sync-exophase.mjs. No inicia sesión ni toca nada de tu cuenta.
(async () => {
  const pid = document.querySelector('[data-playerid]')?.getAttribute('data-playerid');
  if (!pid) throw new Error('Abre tu página de perfil de Exophase primero');
  const all = [];
  for (let p = 1; p <= 20; p++) {
    const j = await (await fetch(`https://api.exophase.com/public/player/${pid}/games?page=${p}&environment=&sort=1&showHidden=0`)).json();
    const a = j.games || [];
    all.push(...a);
    if (!a.length || j.more === false) break;
  }
  return JSON.stringify({
    games: all.map(g => ({
      id: g.master_id,
      title: g.meta?.title,
      platform: (g.meta?.platforms || []).map(x => x.name).join('/'),
      playtime: g.playtime,
      last_played: g.lastplayed ? new Date(g.lastplayed * 1000).toISOString().slice(0, 10) : null,
      status: g.status,
      percent: g.percent,
    })),
  });
})();
