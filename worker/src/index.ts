// TradIA Cloud · nube personal (Cloudflare Worker).
// Guarda la config y el estado del agente en KV y sirve la API de la app.
// Las claves del exchange NUNCA llegan aquí: viven solo en los secretos de
// GitHub del usuario y las usa el runner.

export interface Env {
  AGENTE: KVNamespace;
  APP_TOKEN: string;
  RUNNER_TOKEN: string;
  // IA: cualquier proveedor compatible con OpenAI. IA_CLAVE va vacía en los
  // que no piden cuenta (Kilo). GROQ_* queda para nubes instaladas antes.
  IA_URL?: string;
  IA_MODELOS?: string;
  IA_CLAVE?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  // Versión del código de la nube (runner/version.txt), la pone instalar.yml.
  AGENTE_VERSION?: string;
}

const GROQ_MODELOS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];

type Json = Record<string, any>;

const CONFIG_DEFECTO: Json = {
  modo: 'simulacion', pausado: false, quote: 'USDT', objetivo: { BTC: 40, ETH: 30 },
  monto_min: 5, monto_max: 25, rsi_compra: 35, rsi_venta: 68, banda: 3, ganancia_min: 1.5,
  stop_perdida: 0, nunca_vender_con_perdida: true, no_vender: [], ia: 'veto', ia_conf_min: 65, max_ops_ciclo: 2,
  marco: '1h', saldo_simulado: 1000, radar_pedidos: [], ordenes_ia: 'proponer', orden_horas: 24,
  // Varias IAs votan cada decisión del ciclo (un modelo de cada proveedor primero).
  ia_consenso: { enabled: true, size: 3 },
};
// Límites duros: la app no puede guardar valores fuera de estos rangos.
const RANGOS: Record<string, [number, number]> = {
  monto_min: [1, 1000], monto_max: [1, 5000], rsi_compra: [5, 60], rsi_venta: [40, 95], banda: [0, 20],
  ganancia_min: [0, 50], stop_perdida: [0, 50], ia_conf_min: [0, 100], max_ops_ciclo: [0, 10], saldo_simulado: [10, 1000000], orden_horas: [1, 168],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
}

function iguales(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function token(req: Request): string {
  const h = req.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function leer<T>(env: Env, clave: string, defecto: T): Promise<T> {
  return ((await env.AGENTE.get(clave, 'json')) as T) ?? defecto;
}

async function leerConfig(env: Env): Promise<Json> {
  const c = await leer<Json>(env, 'config', {});
  return { ...CONFIG_DEFECTO, ...c, objetivo: c.objetivo ?? CONFIG_DEFECTO.objetivo };
}

function limpiarSimbolo(s: unknown): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function validarConfig(actual: Json, cambios: Json): { config?: Json; error?: string } {
  const c: Json = { ...actual };
  for (const [k, [min, max]] of Object.entries(RANGOS)) {
    if (cambios[k] === undefined) continue;
    const v = Number(cambios[k]);
    if (!Number.isFinite(v) || v < min || v > max) return { error: `${k} debe estar entre ${min} y ${max}` };
    c[k] = v;
  }
  if (c.monto_min > c.monto_max) return { error: 'monto_min no puede ser mayor que monto_max' };
  if (c.rsi_compra >= c.rsi_venta) return { error: 'rsi_compra debe ser menor que rsi_venta' };
  if (cambios.quote !== undefined) c.quote = limpiarSimbolo(cambios.quote) || 'USDT';
  if (cambios.marco !== undefined) {
    if (!['15m', '1h', '4h', '1d'].includes(cambios.marco)) return { error: 'marco inválido' };
    c.marco = cambios.marco;
  }
  if (cambios.ia !== undefined) {
    if (!['off', 'veto', 'confirmar'].includes(cambios.ia)) return { error: 'ia inválida' };
    c.ia = cambios.ia;
  }
  if (cambios.ordenes_ia !== undefined) {
    if (!['off', 'proponer', 'auto'].includes(cambios.ordenes_ia)) return { error: 'ordenes_ia inválido' };
    c.ordenes_ia = cambios.ordenes_ia;
  }
  if (cambios.nunca_vender_con_perdida !== undefined) c.nunca_vender_con_perdida = Boolean(cambios.nunca_vender_con_perdida);
  // «Acumular»: monedas que el agente compra pero nunca vende solo (tus órdenes manuales sí pasan).
  if (cambios.no_vender !== undefined) {
    const l = Array.isArray(cambios.no_vender) ? [...new Set(cambios.no_vender.map(limpiarSimbolo).filter(Boolean))] : null;
    if (!l || l.length > 20) return { error: 'no_vender: lista de hasta 20 monedas' };
    c.no_vender = l;
  }
  if (cambios.objetivo !== undefined) {
    const obj: Json = {};
    let suma = 0;
    for (const [k, v] of Object.entries(cambios.objetivo || {})) {
      const s = limpiarSimbolo(k), n = Number(v);
      if (!s || !Number.isFinite(n) || n < 0 || n > 100) return { error: `objetivo inválido para ${k}` };
      if (n > 0) { obj[s] = Math.round(n * 10) / 10; suma += n; }
    }
    if (suma > 100) return { error: `El reparto suma ${suma}%: máximo 100%` };
    if (Object.keys(obj).length > 30) return { error: 'Máximo 30 monedas' };
    c.objetivo = obj;
  }
  if (cambios.modo !== undefined) {
    if (!['simulacion', 'real'].includes(cambios.modo)) return { error: 'modo inválido' };
    if (cambios.modo === 'real' && actual.modo !== 'real' && cambios.confirmar_real !== true) return { error: 'Activar dinero real requiere confirmar_real: true' };
    c.modo = cambios.modo;
  }
  return { config: c };
}

async function avisar(env: Env, items: Json[]) {
  if (!items.length) return;
  const feed = await leer<Json[]>(env, 'feed', []);
  const ts = Date.now();
  const nuevos = items.map((it, i) => ({ id: `${ts}-${i}`, ts, ...it }));
  await env.AGENTE.put('feed', JSON.stringify([...nuevos.reverse(), ...feed].slice(0, 30)));
}

// ---------------------------------------------------------------- Señales de la IA
// Historial de lo que dijo la IA en cada ciclo y qué pasó con cada orden, para
// que la app lo muestre en vivo. Una escritura de KV por ciclo con señales.
const MAX_SENALES = 60;
async function guardarSenales(env: Env, ciclo: number, ts: number, r: Json): Promise<void> {
  const op: Json = r.ia?.opiniones || {};
  const senales = Object.keys(op).map((s) => ({ simbolo: s, ...op[s] }));
  const ordenes: Json[] = Array.isArray(r.ordenes) ? r.ordenes : [];
  if (!senales.length && !ordenes.length) return;
  const lista = await leer<Json[]>(env, 'senales', []);
  const item = { tipo: 'ciclo', ciclo, ts, modelo: r.ia?.modelo || null, modo_ia: r.ia?.modo || null, modo: r.modo, quote: r.quote, senales, ordenes };
  await env.AGENTE.put('senales', JSON.stringify([item, ...lista].slice(0, MAX_SENALES)));
}

// ---------------------------------------------------------------- Órdenes
// Cola de órdenes explícitas: propuestas por la IA o creadas por el usuario.
// propuesta → (aprobar) → aprobada → (el runner la ejecuta) → ejecutada | error
// propuesta/aprobada → cancelada | caducada (orden_horas sin ejecutarse).
const MAX_ORDENES = 80;
const PENDIENTE = (o: Json) => o.estado === 'propuesta' || o.estado === 'aprobada';
// Si el resultado de una orden «ejecutando» no llega en este tiempo, no se reintenta:
// se marca error para que revises tu historial en el exchange.
const EJECUTANDO_MAX_MS = 2 * 3600_000;

async function leerOrdenes(env: Env): Promise<Json[]> {
  return leer<Json[]>(env, 'ordenes', []);
}
async function guardarOrdenes(env: Env, lista: Json[]): Promise<void> {
  // Las pendientes nunca se recortan; de las cerradas quedan las más nuevas.
  const viva = (o: Json) => PENDIENTE(o) || o.estado === 'ejecutando';
  const pend = lista.filter(viva), cerradas = lista.filter((o) => !viva(o));
  await env.AGENTE.put('ordenes', JSON.stringify([...pend, ...cerradas].sort((a, b) => b.ts - a.ts).slice(0, Math.max(MAX_ORDENES, pend.length))));
}
function nuevoId(prefijo: string): string {
  return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function textoOrden(o: Json): string {
  return `${o.accion === 'COMPRAR' ? 'Compra' : 'Venta'} ${o.simbolo} ${o.accion === 'COMPRAR' ? `${o.monto} ${o.quote || ''}`.trim() : `${o.pct}%`}${o.limite ? ` si ${o.accion === 'COMPRAR' ? '≤' : '≥'} ${o.limite}` : ''}`;
}

// Valida lo que llega de la app o de la IA. Devuelve la orden limpia o un error.
function limpiarOrden(base: Json, c: Json, config: Json): { orden?: Json; error?: string } {
  if (c.tipo === 'prediccion' || base.tipo === 'prediccion') return { error: 'Las predicciones no forman parte de TradIA Cloud' };
  const o: Json = { ...base };
  if (c.simbolo !== undefined) { o.simbolo = limpiarSimbolo(c.simbolo); if (!o.simbolo) return { error: 'Moneda inválida' }; }
  if (c.accion !== undefined) {
    const a = String(c.accion).toUpperCase();
    if (!['COMPRAR', 'VENDER'].includes(a)) return { error: 'La acción debe ser COMPRAR o VENDER' };
    o.accion = a;
  }
  if (!o.simbolo || !o.accion) return { error: 'Falta la moneda o la acción' };
  if (o.simbolo === String(config.quote).toUpperCase()) return { error: `${o.simbolo} es tu moneda base` };
  if (o.accion === 'COMPRAR') {
    const m = Number(c.monto ?? o.monto);
    if (!(m >= 1 && m <= 100000)) return { error: 'Monto inválido (mínimo 1)' };
    o.monto = Math.round(m * 100) / 100; delete o.pct;
  } else {
    const p = Number(c.pct ?? o.pct ?? 100);
    if (!(p >= 1 && p <= 100)) return { error: 'El % a vender va de 1 a 100' };
    o.pct = Math.round(p); delete o.monto;
  }
  if (c.limite !== undefined) {
    const l = c.limite === null || c.limite === '' ? null : Number(c.limite);
    if (l !== null && !(l > 0)) return { error: 'Precio límite inválido' };
    o.limite = l;
  }
  if (c.permitir_perdida !== undefined) o.permitir_perdida = Boolean(c.permitir_perdida);
  if (c.razon !== undefined) o.razon = String(c.razon).slice(0, 240);
  o.quote = config.quote;
  return { orden: o };
}

async function mezclarOrdenes(env: Env, ahora: number, r: Json): Promise<void> {
  const upd: Json[] = Array.isArray(r.ordenes_upd) ? r.ordenes_upd : [];
  const nuevas: Json[] = Array.isArray(r.ordenes_nuevas) ? r.ordenes_nuevas : [];
  let lista = await leerOrdenes(env);
  const config = await leerConfig(env);
  let cambio = false;
  const eventos: Json[] = [];
  for (const u of upd) {
    const o = lista.find((x) => x.id === u.id);
    if (!o) continue;
    // Si el usuario la canceló mientras corría el ciclo, solo cuenta si de verdad se ejecutó.
    if (o.estado === 'cancelada' && u.estado !== 'ejecutada') continue;
    // De «ejecutando» de vuelta a «aprobada» = sigue esperando su precio: no es noticia.
    if (o.estado !== u.estado && !(o.estado === 'ejecutando' && u.estado === 'aprobada')) eventos.push({ tipo: 'orden', ok: u.estado !== 'error', texto: `${textoOrden(o)}: ${u.estado}${u.error ? ` · ${u.error}` : ''}`, id: o.id });
    if (o.estado !== u.estado || o.nota !== u.nota) cambio = true;
    Object.assign(o, { estado: u.estado, nota: u.nota || null, error: u.error || null, resultado: u.resultado || o.resultado || null, ts_mod: ahora });
  }
  for (const n of nuevas) {
    const v = limpiarOrden({}, n, config);
    if (!v.orden) continue;
    const previa = lista.find((x) => PENDIENTE(x) && x.origen === 'ia' && x.simbolo === v.orden!.simbolo && x.accion === v.orden!.accion);
    if (previa) continue;
    const o: Json = { ...v.orden, id: n.id || nuevoId('ia'), ts: ahora, origen: 'ia', confianza: n.confianza, ia: n.ia || null,
      estado: ['propuesta', 'aprobada', 'ejecutada', 'error'].includes(n.estado) ? n.estado : 'propuesta',
      nota: n.nota || null, error: n.error || null, resultado: n.resultado || null,
      vence: Math.min(ahora + (config.orden_horas || 24) * 3600_000, Number(n.caduca) > ahora ? Number(n.caduca) : Infinity),
      historia: [{ ts: ahora, quien: 'ia', texto: `Propuesta con ${n.confianza}% de confianza: ${n.razon || ''}`.trim() }] };
    lista.unshift(o);
    cambio = true;
    eventos.push({ tipo: 'orden', ok: o.estado !== 'error', texto: `IA ${o.estado === 'ejecutada' ? 'ejecutó' : 'propuso'}: ${textoOrden(o)}`, id: o.id });
  }
  for (const o of lista) {
    if (o.estado === 'ejecutando' && (o.ts_mod || o.ts) < ahora - EJECUTANDO_MAX_MS) {
      Object.assign(o, { estado: 'error', ts_mod: ahora, error: 'El ciclo que la enviaba no informó el resultado. No la reintento para no repetirla: revisa en tu exchange si se ejecutó.' });
      cambio = true;
      eventos.push({ tipo: 'orden', ok: false, texto: `Sin resultado: ${textoOrden(o)}`, id: o.id });
      continue;
    }
    if (PENDIENTE(o) && o.vence && o.vence < ahora) {
      o.estado = 'caducada'; o.ts_mod = ahora; cambio = true;
      eventos.push({ tipo: 'orden', ok: true, texto: `Caducó: ${textoOrden(o)}`, id: o.id });
    }
  }
  if (cambio) await guardarOrdenes(env, lista);
  if (eventos.length) await bitacora(env, eventos.map((e) => ({ ...e, ts: ahora })));
}

async function ordenesApi(env: Env, c: Json): Promise<Response> {
  const config = await leerConfig(env);
  const lista = await leerOrdenes(env);
  const ahora = Date.now();
  const accion = String(c.accion || '');
  const o = c.id ? lista.find((x) => x.id === c.id) : null;
  if (c.id && !o) return json({ error: 'Esa orden ya no existe' }, 404);
  if (o && !PENDIENTE(o)) return json({ error: `La orden ya está ${o.estado}` }, 409);
  const hist = (x: Json, quien: string, texto: string) => { x.historia = [...(x.historia || []), { ts: ahora, quien, texto }].slice(-12); x.ts_mod = ahora; };

  if (accion === 'crear') {
    const v = limpiarOrden({}, c.orden || {}, config);
    if (!v.orden) return json({ error: v.error }, 400);
    const n: Json = { ...v.orden, id: nuevoId('u'), ts: ahora, origen: 'usuario', estado: 'aprobada', vence: ahora + (config.orden_horas || 24) * 3600_000 };
    hist(n, 'usuario', `Creada: ${textoOrden(n)}`);
    lista.unshift(n);
    await guardarOrdenes(env, lista);
    await bitacora(env, [{ ts: ahora, tipo: 'orden', ok: true, texto: `Creaste: ${textoOrden(n)}`, id: n.id }]);
    return json({ ok: true, orden: n });
  }
  if (accion === 'editar' && o) {
    const v = limpiarOrden(o, c.cambios || {}, config);
    if (!v.orden) return json({ error: v.error }, 400);
    Object.assign(o, v.orden);
    hist(o, 'usuario', `Editada: ${textoOrden(o)}`);
    await guardarOrdenes(env, lista);
    await bitacora(env, [{ ts: ahora, tipo: 'orden', ok: true, texto: `Editaste: ${textoOrden(o)}`, id: o.id }]);
    return json({ ok: true, orden: o });
  }
  if ((accion === 'aprobar' || accion === 'cancelar') && o) {
    o.estado = accion === 'aprobar' ? 'aprobada' : 'cancelada';
    if (accion === 'aprobar') o.vence = Math.max(o.vence || 0, ahora + (config.orden_horas || 24) * 3600_000);
    hist(o, 'usuario', accion === 'aprobar' ? 'Aprobada: se ejecuta en el próximo ciclo' : 'Cancelada');
    await guardarOrdenes(env, lista);
    await bitacora(env, [{ ts: ahora, tipo: 'orden', ok: true, texto: `${accion === 'aprobar' ? 'Aprobaste' : 'Cancelaste'}: ${textoOrden(o)}`, id: o.id }]);
    return json({ ok: true, orden: o });
  }
  if (accion === 'ia') {
    const instruccion = String(c.instruccion || '').trim().slice(0, 400);
    if (!instruccion) return json({ error: 'Escribe qué quieres que haga la IA' }, 400);
    return ordenConIA(env, config, lista, o ?? null, instruccion);
  }
  return json({ error: 'Acción de orden desconocida' }, 400);
}

// La IA crea una orden a partir de lo que escribes, o edita una existente.
// El resultado siempre queda como «propuesta»: tú la apruebas.
async function ordenConIA(env: Env, config: Json, lista: Json[], o: Json | null, instruccion: string): Promise<Response> {
  const estado = await leer<Json>(env, 'estado', {});
  const ahora = Date.now();
  const mercado = (estado.radar || []).slice(0, 25).map((f: Json) => ({ s: f.simbolo, p: f.precio, rsi: f.rsi, t: f.tendencia, c24: f.cambio_24h }));
  const cartera = (estado.ultimo?.activos || []).map((a: Json) => ({ s: a.simbolo, cant: a.cantidad, valor: a.valor }));
  const t0 = Date.now();
  let d: Json, modelo: string;
  try {
    ({ datos: d, modelo } = await iaChat(env, [
      { role: 'system', content: 'Preparas órdenes spot para un agente cripto. Respondes SOLO JSON válido en español. Eres prudente y no inventas precios.' },
      { role: 'user', content: `${o ? `Orden actual: ${JSON.stringify({ simbolo: o.simbolo, accion: o.accion, monto: o.monto, pct: o.pct, limite: o.limite ?? null })}\nEl usuario pide cambiarla así: "${instruccion}"` : `El usuario pide esta orden: "${instruccion}"`}
Moneda base: ${config.quote}. Mínimo por orden: ${config.monto_min} ${config.quote}. Cartera: ${JSON.stringify(cartera)}. Mercado: ${JSON.stringify(mercado)}.
COMPRAR usa "monto" en ${config.quote}; VENDER usa "pct" (1-100 de lo que tiene). "limite" es un precio opcional (null = a mercado).
Formato: {"simbolo":"HYPE","accion":"COMPRAR|VENDER","monto":12,"pct":null,"limite":null,"razon":"máx. 25 palabras","aviso":"riesgo o duda, o vacío"}` },
    ]));
  } catch (e: any) {
    await bitacora(env, [{ ts: ahora, tipo: 'ia', ok: false, texto: `IA (órdenes) falló: ${String(e.message || e).slice(0, 160)}`, ms: Date.now() - t0 }]);
    return json({ error: String(e.message || e) }, 502);
  }
  const v = limpiarOrden(o || {}, { simbolo: d.simbolo, accion: d.accion, monto: d.monto ?? undefined, pct: d.pct ?? undefined, limite: d.limite ?? null, razon: d.razon }, config);
  await bitacora(env, [{ ts: ahora, tipo: 'ia', ok: !!v.orden, texto: `IA (órdenes) respondió con ${modelo} en ${((Date.now() - t0) / 1000).toFixed(1)} s${v.error ? ` · orden inválida: ${v.error}` : ''}`, ms: Date.now() - t0, modelo }]);
  if (!v.orden) return json({ error: `La IA propuso algo inválido: ${v.error}` }, 422);
  const n: Json = o || { id: nuevoId('ia'), ts: ahora, vence: ahora + (config.orden_horas || 24) * 3600_000 };
  Object.assign(n, v.orden, { origen: o ? o.origen : 'ia', estado: 'propuesta', ia: { accion: v.orden.accion, confianza: null, razon: v.orden.razon || '' }, aviso: String(d.aviso || '').slice(0, 200) || null });
  n.historia = [...(n.historia || []), { ts: ahora, quien: 'ia', texto: `${o ? 'Editada' : 'Creada'} por la IA («${instruccion.slice(0, 80)}»): ${textoOrden(n)}` }].slice(-12);
  n.ts_mod = ahora;
  if (!o) lista.unshift(n);
  await guardarOrdenes(env, lista);
  await bitacora(env, [{ ts: ahora, tipo: 'orden', ok: true, texto: `IA ${o ? 'editó' : 'creó'}: ${textoOrden(n)} (espera tu aprobación)`, id: n.id }]);
  return json({ ok: true, orden: n, modelo });
}

// ---------------------------------------------------------------- Bitácora
// Historial para saber si todo funciona: ciclos, llamadas a la IA (modelo,
// tiempo, error), órdenes y errores. Una escritura por ciclo y por acción.
const MAX_LOG = 200;
async function bitacora(env: Env, items: Json[]): Promise<void> {
  if (!items.length) return;
  const lista = await leer<Json[]>(env, 'bitacora', []);
  await env.AGENTE.put('bitacora', JSON.stringify([...items.slice().reverse(), ...lista].slice(0, MAX_LOG)));
}
async function bitacoraCiclo(env: Env, ciclo: number, ahora: number, r: Json): Promise<void> {
  const items: Json[] = [];
  // Con consenso hay varias llamadas por ciclo: a la bitácora van como mucho 3 respuestas
  // buenas y 4 fallas por ciclo (lo que hace falta para ver qué falló y por qué).
  const todas: Json[] = Array.isArray(r.ia_log) ? r.ia_log : [];
  const log = [...todas.filter((l) => l.ok).slice(0, 3), ...todas.filter((l) => !l.ok).slice(0, 4)];
  for (const l of log) {
    items.push({ ts: Number(l.ts) || ahora, tipo: 'ia', ok: !!l.ok, ms: l.ms, modelo: l.modelo,
      texto: l.ok ? `IA ${l.proveedor || ''} respondió con ${l.modelo} en ${(Number(l.ms) / 1000).toFixed(1)} s` : `IA ${l.proveedor || ''} falló con ${l.modelo}: ${l.error || 'error'}` });
  }
  if (!log.length && r.ok && r.ia?.modo && r.ia.modo !== 'off') items.push({ ts: ahora, tipo: 'ia', ok: true, texto: 'IA: no hubo nada que consultar en este ciclo' });
  // Candado de pérdidas: ventas automáticas frenadas (sin repetir la misma en cada ciclo).
  const bloq: Json[] = Array.isArray(r.bloqueos_perdida) ? r.bloqueos_perdida : [];
  if (bloq.length) {
    const previos = new Set((await leer<Json[]>(env, 'bitacora', [])).slice(0, 40).map((l) => l.texto));
    for (const b of bloq.slice(0, 3)) {
      const texto = `Candado: no vendí «${String(b.que).slice(0, 80)}»: ${String(b.motivo).slice(0, 160)}`;
      if (!previos.has(texto)) items.push({ ts: Number(b.ts) || ahora, tipo: 'loss_sell_block', ok: false, texto });
    }
  }
  const errs: string[] = Array.isArray(r.errores) ? r.errores : [];
  for (const e of errs.slice(0, 5)) items.push({ ts: ahora, tipo: 'error', ok: false, texto: String(e).slice(0, 240) });
  const ops = Array.isArray(r.ejecutadas) ? r.ejecutadas.length : 0;
  items.push({ ts: ahora, tipo: 'ciclo', ok: r.ok !== false, ciclo,
    texto: `Ciclo #${ciclo} ${r.ok === false ? 'con error' : 'OK'} · ${r.exchange || '?'} · ${r.modo || '?'} · ${ops} operaci${ops === 1 ? 'ón' : 'ones'} · ${errs.length} error${errs.length === 1 ? '' : 'es'}${r.duracion ? ` · ${r.duracion} s` : ''}` });
  await bitacora(env, items);
}

// ---------------------------------------------------------------- Runner
async function runnerReporte(env: Env, r: Json): Promise<Response> {
  const estado = await leer<Json>(env, 'estado', {});
  const ciclo = (estado.ciclo || 0) + 1;
  const ahora = Date.now();
  let historial: [number, number][] = estado.historial || [];
  // La gráfica solo compara peras con peras: al cambiar de exchange o entre
  // simulación y real empieza de cero (si no, 1000 simulados → 10 reales sale -99%).
  const serie = r.ok ? `${r.exchange}|${r.modo}` : estado.serie;
  if (r.ok && estado.serie !== serie) historial = [];
  if (r.ok && typeof r.total === 'number') historial.push([ahora, r.total]);
  const { radar, cartera_sim, costos, graficas, ...ultimo } = r;
  const nuevo: Json = {
    ciclo, actualizado: ahora, serie, ultimo: { ...ultimo, ts: ahora },
    historial: historial.slice(-500),
    runner: { costos: costos ?? estado.runner?.costos ?? {}, cartera_sim: cartera_sim ?? estado.runner?.cartera_sim ?? null },
    radar: Array.isArray(radar) && radar.length ? radar : estado.radar || [],
    radar_ts: Array.isArray(radar) && radar.length ? ahora : estado.radar_ts || null,
  };
  await env.AGENTE.put('estado', JSON.stringify(nuevo));
  // Velas de tus activos para las gráficas de la app: una escritura por ciclo,
  // aparte del estado para que el Panel no tenga que descargarlas.
  if (r.ok && graficas && typeof graficas === 'object' && Object.keys(graficas).length) {
    await env.AGENTE.put('graficas', JSON.stringify({ ts: ahora, exchange: r.exchange, quote: r.quote, datos: graficas }));
  }

  await guardarSenales(env, ciclo, ahora, r);
  await mezclarOrdenes(env, ahora, r);
  await bitacoraCiclo(env, ciclo, ahora, r);

  const ops: Json[] = Array.isArray(r.ejecutadas) ? r.ejecutadas : [];
  if (ops.length) {
    const lista = await leer<Json[]>(env, 'operaciones', []);
    await env.AGENTE.put('operaciones', JSON.stringify([...ops.slice().reverse(), ...lista].slice(0, 200)));
  }
  const avisos: Json[] = ops.map((o) => ({
    tipo: 'operacion',
    titulo: `${o.simulada ? '🧪 ' : ''}${o.accion === 'COMPRAR' ? 'Compra' : 'Venta'} ${o.simbolo}`,
    texto: `${Number(o.total).toFixed(2)} ${r.quote} a ${o.precio} · ${o.motivo}`,
  }));
  const errores: string[] = r.errores || [];
  const previos: string[] = estado.ultimo?.errores || [];
  const nuevosErr = errores.filter((e) => !previos.includes(e));
  if (nuevosErr.length) avisos.push({ tipo: 'error', titulo: 'TradIA necesita tu atención', texto: nuevosErr.join(' · ').slice(0, 240) });
  await avisar(env, avisos);
  return json({ ok: true, ciclo });
}

// El runner «toma» las órdenes aprobadas justo antes de enviarlas al exchange: pasan a
// «ejecutando» y ya no se le vuelven a mandar. Si el ciclo se cae después de operar,
// la orden no se repite en el siguiente ciclo. Devuelve los ids tomados.
async function runnerTomar(env: Env, c: Json): Promise<Response> {
  const ids: string[] = Array.isArray(c.ids) ? c.ids.map(String) : [];
  const lista = await leerOrdenes(env);
  const ahora = Date.now(), tomadas: string[] = [];
  for (const o of lista) {
    if (ids.includes(o.id) && o.estado === 'aprobada' && !(o.vence && o.vence < ahora)) {
      Object.assign(o, { estado: 'ejecutando', ts_mod: ahora });
      tomadas.push(o.id);
    }
  }
  if (tomadas.length) await guardarOrdenes(env, lista);
  return json({ ok: true, ids: tomadas });
}

async function runnerConfig(env: Env): Promise<Response> {
  const [config, estado] = await Promise.all([leerConfig(env), leer<Json>(env, 'estado', {})]);
  const ahora = Date.now();
  // Las ya vencidas no se mandan (aunque el ciclo anterior no alcanzara a marcarlas caducadas).
  // Órdenes de predicción que quedaran de versiones anteriores no se mandan: ya no se ejecutan aquí.
  const ordenes = (await leerOrdenes(env)).filter((o) => PENDIENTE(o) && o.tipo !== 'prediccion' && !(o.vence && o.vence < ahora));
  const ia_pref = await env.AGENTE.get('ia_pref');
  // El runner recibe tus proveedores de IA con sus claves (por HTTPS y con su token):
  // así no hace falta copiarlas a los secretos de GitHub.
  const { lista: ia_proveedores } = await proveedoresIA(env);
  return json({ config, estado_runner: estado.runner || {}, ordenes, ia_pref,
    ia_proveedores: ia_proveedores.map((p) => ({ id: p.id, url: p.url, key: p.key, modelos: p.modelos })), ia_consenso: config.ia_consenso });
}

// ---------------------------------------------------------------- Proveedores de IA
// Varias IAs gratuitas en orden de prioridad. Tus claves se guardan cifradas (AES-GCM)
// en una sola entrada de KV; la llave sale del token de la app, así que si cambia ese
// token las claves quedan ilegibles y hay que volver a pegarlas. Detrás de tus claves
// van siempre los respaldos: la clave de la instalación y los gratuitos sin clave
// (si alguno no se quita a propósito), para que la IA nunca quede caída por uno solo.
// Las claves nunca vuelven completas a la app ni a la bitácora: solo recortadas.
const IA_CATALOGO: Json[] = [
  { id: 'groq', nombre: 'Groq', url: 'https://api.groq.com/openai/v1', prefijos: ['gsk_'], link: 'https://console.groq.com/keys', nota: 'Muy rápida. Plan gratis con límite por minuto.' },
  { id: 'gemini', nombre: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', prefijos: ['AIza', 'AQ.'], link: 'https://aistudio.google.com/apikey', nota: 'Gratis con cuenta de Google. A veces da «sin cuota» (429) en horas pico.' },
  { id: 'openrouter', nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', prefijos: ['sk-or-'], link: 'https://openrouter.ai/keys', nota: 'Solo se usan sus modelos «:free».' },
  { id: 'cerebras', nombre: 'Cerebras', url: 'https://api.cerebras.ai/v1', prefijos: ['csk-'], link: 'https://cloud.cerebras.ai', nota: 'Muy rápida. Plan gratis.' },
  { id: 'mistral', nombre: 'Mistral', url: 'https://api.mistral.ai/v1', prefijos: [], link: 'https://console.mistral.ai/api-keys', nota: 'Plan gratis «Experiment».' },
  { id: 'kilo', nombre: 'Kilo (sin clave)', url: 'https://api.kilo.ai/api/gateway', sinClave: true, nota: 'Sin registro. Sus modelos gratis cambian seguido.',
    modelos: ['nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'poolside/laguna-s-2.1:free'] },
  { id: 'llm7', nombre: 'LLM7 (sin clave)', url: 'https://api.llm7.io/v1', sinClave: true, nota: 'Sin registro. Límite anónimo bajo.', modelos: ['GLM-5.3-Flash', 'gpt-oss:20b', 'DeepSeek-V4-Flash-0731'] },
  { id: 'ovh', nombre: 'OVH (sin clave)', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', sinClave: true, nota: 'Sin registro. Solo 2 consultas por minuto: queda de último respaldo.',
    modelos: ['gpt-oss-120b', 'Meta-Llama-3_3-70B-Instruct', 'Qwen3.8-27B'] },
];
const catIA = (id: string) => IA_CATALOGO.find((c) => c.id === id);
const recortar = (k: string) => (k ? (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '…') : '');
function detectarProveedor(clave: string): string | null {
  const k = clave.trim();
  for (const c of IA_CATALOGO) if ((c.prefijos || []).some((p: string) => k.startsWith(p))) return c.id;
  return null;
}

// ---- Cifrado (AES-GCM con WebCrypto)
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const deB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function llaveIA(env: Env): Promise<CryptoKey> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tradia:ia-keys:' + env.APP_TOKEN));
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
type DocIA = { lista: Json[]; quitados: string[]; orden?: string[] };
async function leerDocIA(env: Env): Promise<{ doc: DocIA; ilegible: boolean; migrar: boolean }> {
  const crudo = await env.AGENTE.get('ia_proveedores');
  const vacio: DocIA = { lista: [], quitados: [] };
  if (!crudo) return { doc: vacio, ilegible: false, migrar: false };
  let x: Json;
  try { x = JSON.parse(crudo); } catch { return { doc: vacio, ilegible: true, migrar: false }; }
  if (Array.isArray(x)) return { doc: { lista: x, quitados: [] }, ilegible: false, migrar: true }; // lista vieja en texto plano
  if (!x.iv || !x.data) return { doc: { lista: x.lista || [], quitados: x.quitados || [], orden: x.orden }, ilegible: false, migrar: true };
  try {
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(x.iv) }, await llaveIA(env), deB64(x.data));
    const d = JSON.parse(new TextDecoder().decode(plano));
    return { doc: { lista: d.lista || [], quitados: d.quitados || [], orden: d.orden }, ilegible: false, migrar: false };
  } catch {
    return { doc: vacio, ilegible: true, migrar: false }; // cambió el token de la app
  }
}
async function guardarDocIA(env: Env, doc: DocIA): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await llaveIA(env), new TextEncoder().encode(JSON.stringify(doc))));
  await env.AGENTE.put('ia_proveedores', JSON.stringify({ v: 1, iv: b64(iv), data: b64(data) }));
}

// Lista efectiva: tus claves, luego la de la instalación y al final los sin clave
// (con los modelos del catálogo actual), salvo los que quitaste. Si moviste algo con
// ↑ ↓, se respeta ese orden.
function listaEfectiva(env: Env, doc: DocIA): Json[] {
  const out: Json[] = doc.lista.filter((p) => p.key && !catIA(p.id)?.sinClave).map((p) => ({ ...p, url: catIA(p.id)?.url || p.url, origen: 'tuya' }));
  const inst = proveedorIA(env);
  if (inst && inst.modelos.length && !doc.quitados.includes('instalacion') && !out.some((p) => p.url === inst.url && p.key === inst.clave)) {
    const id = IA_CATALOGO.find((c) => inst.url.startsWith(c.url))?.id;
    if (!(id && catIA(id)?.sinClave && !doc.quitados.includes(id))) out.push({ id: 'instalacion', url: inst.url, key: inst.clave, modelos: inst.modelos, origen: 'instalacion', de: id || inst.nombre });
  }
  for (const c of IA_CATALOGO.filter((c) => c.sinClave)) {
    if (!doc.quitados.includes(c.id)) out.push({ id: c.id, url: c.url, key: '', modelos: c.modelos, origen: 'sin_clave' });
  }
  if (doc.orden?.length) {
    const pos = (id: string) => { const i = doc.orden!.indexOf(id); return i < 0 ? 1e6 : i; };
    out.sort((a, b) => pos(a.id) - pos(b.id) || 0);
  }
  return out;
}
async function proveedoresIA(env: Env): Promise<{ lista: Json[]; ilegible: boolean }> {
  const { doc, ilegible, migrar } = await leerDocIA(env);
  if (migrar) await guardarDocIA(env, doc); // migra la lista vieja a cifrada
  return { lista: listaEfectiva(env, doc), ilegible };
}
async function candidatosIA(env: Env): Promise<{ prov: Json; modelo: string }[]> {
  const { lista } = await proveedoresIA(env);
  const pref = await env.AGENTE.get('ia_pref');
  return lista.flatMap((p) => {
    const ms: string[] = pref && p.modelos.includes(pref) ? [pref, ...p.modelos.filter((m: string) => m !== pref)] : p.modelos;
    return ms.map((modelo) => ({ prov: p, modelo }));
  });
}

// Una pregunta a un proveedor, con lo suyo de cada uno.
function cuerpoIA(prov: Json, modelo: string, mensajes: Json[], formatoJson: boolean): Json {
  const id = IA_CATALOGO.find((c) => String(prov.url).startsWith(c.url))?.id;
  const c: Json = { model: modelo, messages: mensajes, temperature: 0.2, max_tokens: id === 'kilo' ? 1500 : 2048 };
  if (formatoJson) {
    if (id === 'groq' && !/llama/i.test(modelo)) { c.response_format = { type: 'json_schema', json_schema: { name: 'respuesta', strict: false, schema: { type: 'object' } } }; c.reasoning_effort = 'low'; }
    else if (id === 'groq' || id === 'mistral' || id === 'cerebras') c.response_format = { type: 'json_object' };
  }
  return c;
}
function errorIA(status: number, texto = ''): string {
  if (status === 429) return 'sin cuota (429)';
  if (status === 401 || status === 403) return `clave rechazada (HTTP ${status})`;
  return texto || `HTTP ${status}`;
}
async function preguntarIA(prov: Json, modelo: string, mensajes: Json[], ms: number): Promise<{ ok: boolean; datos?: Json; status?: number; error?: string }> {
  const groq = String(prov.url).startsWith('https://api.groq.com');
  const cab: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': groq ? 'curl/8.14.1' : 'tradia-cloud/1.0' };
  if (prov.key) cab.Authorization = `Bearer ${prov.key}`;
  for (const formatoJson of [true, false]) {
    let r: Response;
    try {
      r = await fetch(`${prov.url}/chat/completions`, { method: 'POST', headers: cab, body: JSON.stringify(cuerpoIA(prov, modelo, mensajes, formatoJson)), signal: AbortSignal.timeout(ms) });
    } catch (e: any) {
      return { ok: false, status: 0, error: /timeout|abort/i.test(String(e?.name || e)) ? 'timeout' : 'sin conexión' };
    }
    if (r.ok) {
      const d: any = await r.json().catch(() => ({}));
      const texto = d.choices?.[0]?.message?.content || '';
      if (!String(texto).trim()) return { ok: false, status: 200, error: 'respuesta vacía' };
      try { return { ok: true, datos: extraerJson(texto) }; } catch { return { ok: false, status: 200, error: 'JSON inválido' }; }
    }
    // Gemini responde 400 si la clave no sirve.
    if (r.status === 400 && formatoJson && !String(prov.url).includes('generativelanguage')) continue;
    return { ok: false, status: r.status, error: errorIA(r.status) };
  }
  return { ok: false, status: 0, error: 'error' };
}

// Elige hasta 3 modelos de lo que la cuenta tiene: fuera los que no sirven para
// chat y primero los grandes conocidos. Así no hay nombres fijos que caduquen.
const NO_CHAT = /guard|safety|whisper|tts|audio|embed|image|code|omni|moderation|vision|ocr|rerank|transcri/i;
function elegirModelos(id: string, ids: string[]): string[] {
  let l = [...new Set(ids.map((x) => String(x).replace(/^models\//, '')))].filter((x) => !NO_CHAT.test(x));
  if (id === 'openrouter') l = l.filter((x) => x.endsWith(':free'));
  const ver = (x: string) => Number((x.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const puntos = (x: string) => {
    if (id === 'gemini') return /^gemini-\d+(\.\d+)?-flash$/.test(x) ? 200 + ver(x) : /^gemini-\d+(\.\d+)?-flash/.test(x) && !/preview|exp|lite/.test(x) ? 150 + ver(x) : /flash/.test(x) ? 100 + ver(x) : 0;
    if (/gpt-oss-120b/.test(x)) return 100;
    if (/qwen/i.test(x) && /(32b|72b|235b|397b|480b|qwen3)/i.test(x)) return 90;
    if (/llama/i.test(x) && /70b/i.test(x)) return 80;
    if (/(large|70b|120b|maverick|nemotron|glm|deepseek|mistral-medium|mistral-large)/i.test(x)) return 50;
    return 10;
  };
  return l.map((x) => [x, puntos(x)] as [string, number]).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x);
}
async function validarProveedor(id: string, clave: string): Promise<{ modelos?: string[]; error?: string }> {
  const c = catIA(id);
  if (!c) return { error: 'Proveedor desconocido' };
  const cab: Record<string, string> = { 'User-Agent': id === 'groq' ? 'curl/8.14.1' : 'tradia-cloud/1.0' };
  if (clave) cab.Authorization = `Bearer ${clave}`;
  let r: Response;
  try {
    if (id === 'openrouter') {
      const k = await fetch(`${c.url}/key`, { headers: cab, signal: AbortSignal.timeout(15_000) });
      if (!k.ok) return { error: k.status === 401 || k.status === 403 ? 'Clave rechazada: OpenRouter no la reconoce' : `OpenRouter respondió HTTP ${k.status}` };
    }
    r = await fetch(`${c.url}/models`, { headers: cab, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { error: `No pude conectar con ${c.nombre}: prueba de nuevo en un rato` };
  }
  if (r.status === 401 || r.status === 403 || (id === 'gemini' && r.status === 400)) return { error: `Clave rechazada: ${c.nombre} no la reconoce. Revisa que la copiaste completa.` };
  if (!r.ok) return { error: `${c.nombre} respondió HTTP ${r.status}. Prueba de nuevo en un rato.` };
  const d: any = await r.json().catch(() => ({}));
  // Los que el proveedor marca como de pago («usage_based_only», p. ej. LLM7 «pro») no sirven sin plan.
  const ids: string[] = (d.data || d.models || []).filter((m: Json) => !(c.sinClave && m.usage_based_only === true)).map((m: Json) => m.id || m.name).filter(Boolean);
  // Sin clave: los del catálogo que sigan existiendo.
  const modelos = c.sinClave ? c.modelos.filter((m: string) => ids.includes(m)) : elegirModelos(id, ids);
  if (!modelos.length) return { error: `${c.nombre} no tiene ahora modelos de chat gratis disponibles` };
  return { modelos };
}

async function iaProveedoresApi(env: Env, ruta: string, c: Json): Promise<Response> {
  const config = await leerConfig(env);
  const { doc, ilegible, migrar } = await leerDocIA(env);
  if (migrar) await guardarDocIA(env, doc);
  const vista = (lista: Json[]) => lista.map((p, i) => ({
    id: p.id, nombre: p.id === 'instalacion' ? `Clave de la instalación${p.de ? ` (${catIA(p.de)?.nombre || p.de})` : ''}` : catIA(p.id)?.nombre || p.id,
    clave: recortar(p.key), modelos: p.modelos, origen: p.origen, rol: i === 0 ? 'PRINCIPAL' : 'RESPALDO', actualizada: p.updated_at || null,
  }));
  const respuesta = (extra: Json = {}) => json({
    catalogo: IA_CATALOGO.map(({ prefijos, ...x }) => ({ ...x, prefijos })), activa: vista(listaEfectiva(env, doc)),
    cifrada: true, ilegible, quitados: doc.quitados, consenso: config.ia_consenso, ...extra,
  });
  if (ruta === '/api/ia/proveedores' && c._get) return respuesta();
  if (!c.confirmed) return json({ error: 'Falta confirmar el cambio' }, 400);

  if (ruta === '/api/ia/proveedores') {
    const id = String(c.proveedor || ''), cat = catIA(id), clave = String(c.key || '').trim();
    if (!cat) return json({ error: 'Elige un proveedor de la lista' }, 400);
    const parece = clave ? detectarProveedor(clave) : null;
    if (parece && parece !== id) return json({ error: `Esa clave parece de ${catIA(parece)!.nombre}, no de ${cat.nombre}. Cambia el proveedor o pega otra clave.`, sugerido: parece }, 400);
    if (!cat.sinClave && !clave) return json({ error: `${cat.nombre} necesita una clave` }, 400);
    const v = await validarProveedor(id, cat.sinClave ? '' : clave);
    if (v.error) return json({ error: v.error }, 400);
    const ahora = Date.now();
    doc.quitados = doc.quitados.filter((q) => q !== id);
    if (!cat.sinClave) {
      doc.lista = [...doc.lista.filter((p) => p.id !== id), { id, key: clave, modelos: v.modelos, updated_at: ahora }];
      // Una clave nueva entra antes de los respaldos sin clave.
      if (doc.orden?.length) {
        const ord = doc.orden.filter((x) => x !== id);
        const i = ord.findIndex((x) => catIA(x)?.sinClave);
        ord.splice(i < 0 ? ord.length : i, 0, id);
        doc.orden = ord;
      }
    }
    await guardarDocIA(env, doc);
    await bitacora(env, [{ ts: ahora, tipo: 'ia', ok: true, texto: `IA: ${cat.nombre} ${cat.sinClave ? 'activada' : `guardada (${recortar(clave)})`} con ${v.modelos!.join(', ')}` }]);
    return respuesta({ ok: true, guardado: { id, modelos: v.modelos } });
  }
  if (ruta === '/api/ia/proveedores/orden') {
    const lista = listaEfectiva(env, doc), ids = lista.map((p) => p.id), id = String(c.id || ''), i = ids.indexOf(id);
    if (i < 0) return json({ error: 'Ese proveedor no está en tu lista' }, 404);
    const acc = String(c.accion || '');
    if (acc === 'quitar') {
      if (ids.length <= 1) return json({ error: 'No puedes quitar el último proveedor: la IA quedaría apagada' }, 400);
      doc.lista = doc.lista.filter((p) => p.id !== id);
      if (!doc.quitados.includes(id) && (id === 'instalacion' || catIA(id)?.sinClave)) doc.quitados.push(id); // no volver a agregarlo solo
      doc.orden = ids.filter((x) => x !== id);
    } else if (['subir', 'bajar', 'primero'].includes(acc)) {
      const j = acc === 'primero' ? 0 : acc === 'subir' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1);
      ids.splice(i, 1); ids.splice(j, 0, id); doc.orden = ids;
    } else return json({ error: 'Acción inválida' }, 400);
    await guardarDocIA(env, doc);
    return respuesta({ ok: true });
  }
  if (ruta === '/api/ia/proveedores/probar') {
    const lista = listaEfectiva(env, doc);
    const pares = lista.flatMap((p) => p.modelos.map((m: string) => ({ p, m }))).slice(0, 14);
    const msg = [{ role: 'user', content: 'Responde solo: {"ok":true}' }];
    const res = await Promise.all(pares.map(async ({ p, m }) => {
      const t0 = Date.now();
      const r = await preguntarIA(p, m, msg, 20_000);
      return { id: p.id, modelo: m, ok: r.ok, ms: Date.now() - t0, error: r.ok ? null : r.error };
    }));
    return respuesta({ pruebas: res });
  }
  if (ruta === '/api/ia/consenso') {
    const size = Math.round(Number(c.size));
    if (c.size !== undefined && !(size >= 2 && size <= 5)) return json({ error: 'Pueden votar de 2 a 5 IAs' }, 400);
    config.ia_consenso = { enabled: c.enabled !== undefined ? Boolean(c.enabled) : !!config.ia_consenso?.enabled, size: c.size !== undefined ? size : config.ia_consenso?.size || 3 };
    await env.AGENTE.put('config', JSON.stringify(config));
    return respuesta({ ok: true });
  }
  return json({ error: 'Ruta no encontrada' }, 404);
}

// ---------------------------------------------------------------- IA radar
const analisisMem = new Map<string, { ts: number; datos: Json }>();

function proveedorIA(env: Env): { url: string; clave: string; modelos: string[]; nombre: string } | null {
  const url = (env.IA_URL || '').trim().replace(/\/+$/, '');
  if (url) {
    const modelos = (env.IA_MODELOS || '').split(',').map((m) => m.trim()).filter(Boolean);
    return { url, clave: (env.IA_CLAVE || '').trim(), modelos, nombre: url.replace(/^https?:\/\/(api\.)?/, '').split('/')[0] };
  }
  if (env.GROQ_API_KEY) {
    return { url: 'https://api.groq.com/openai/v1', clave: env.GROQ_API_KEY, modelos: [env.GROQ_MODEL, ...GROQ_MODELOS].filter(Boolean) as string[], nombre: 'groq.com' };
  }
  return null;
}

// Algunos modelos envuelven el JSON en ```json``` o en <think>…</think>.
function extraerJson(texto: string): Json {
  const t = (texto || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try { return JSON.parse(t); } catch {
    // El primer objeto JSON completo (hay modelos que lo repiten o agregan texto o emojis).
    for (let a = t.indexOf('{'); a >= 0; a = t.indexOf('{', a + 1)) {
      let prof = 0, enTexto = false, esc = false;
      for (let i = a; i < t.length; i++) {
        const ch = t[i];
        if (enTexto) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') enTexto = false; continue; }
        if (ch === '"') enTexto = true;
        else if (ch === '{') prof++;
        else if (ch === '}' && --prof === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch { break; } }
      }
    }
    throw new Error('JSON inválido');
  }
}

// Modelo que respondió en la última prueba del semáforo: se prueba primero.
async function modelosOrdenados(env: Env, modelos: string[]): Promise<string[]> {
  const pref = await env.AGENTE.get('ia_pref');
  return pref && modelos.includes(pref) ? [pref, ...modelos.filter((m) => m !== pref)] : modelos;
}

// Cadena de respaldo: cada proveedor y modelo de tu lista, en orden de prioridad.
// Un 429, un timeout o un JSON inválido pasan al siguiente; una clave rechazada
// salta los demás modelos de ese proveedor. `solo` = probar solo esos.
async function iaChat(env: Env, mensajes: Json[], solo?: { prov: Json; modelo: string }[]): Promise<{ datos: Json; modelo: string; proveedor?: string; respaldo?: Json[] }> {
  const cands = solo || (await candidatosIA(env));
  if (!cands.length) throw new Error('Tu nube no tiene IA configurada: agrega un proveedor en Config → IA');
  const respaldo: Json[] = [], caidos = new Set<string>();
  for (const { prov, modelo } of cands) {
    if (caidos.has(prov.id)) continue;
    const r = await preguntarIA(prov, modelo, mensajes, 45_000);
    if (r.ok) return { datos: r.datos!, modelo, proveedor: prov.id, respaldo };
    respaldo.push({ proveedor: prov.id, modelo, error: r.error });
    if ((r.status === 401 || r.status === 403) && prov.key) caidos.add(prov.id); // sin clave, el 401 es solo de ese modelo
  }
  const u = respaldo[respaldo.length - 1];
  throw new Error(u ? `${u.proveedor} ${u.error} con ${u.modelo}` : 'La IA no respondió');
}

async function radarAnalizar(env: Env, cuerpo: Json): Promise<Response> {
  const sym = limpiarSimbolo(cuerpo.simbolo);
  if (!sym) return json({ error: 'Falta el símbolo' }, 400);
  const mem = analisisMem.get(sym);
  if (mem && Date.now() - mem.ts < 10 * 60_000) return json({ ...mem.datos, cache: true });
  const [estado, config] = await Promise.all([leer<Json>(env, 'estado', {}), leerConfig(env)]);
  const fila = (estado.radar || []).find((f: Json) => f.simbolo === sym);
  if (!fila) return json({ error: `${sym} aún no tiene datos. Pide el análisis y espera el próximo ciclo.`, pendiente: true }, 404);
  const cartera = (estado.ultimo?.activos || []).map((a: Json) => ({ s: a.simbolo, peso: a.peso }));
  const t0 = Date.now();
  const { datos: d, modelo } = await iaChat(env, [
    { role: 'system', content: 'Eres un analista cripto prudente para principiantes. Respondes SOLO JSON válido en español.' },
    { role: 'user', content: `Evalúa si conviene INCORPORAR la moneda ${sym} a un agente de trading spot.\nDatos de mercado (velas diarias del exchange del usuario): ${JSON.stringify(fila)}\nCartera actual (peso %): ${JSON.stringify(cartera)}\nModo: ${config.modo}.\nIncluye qué es el proyecto si lo conoces (sin inventar cifras), riesgos y una entrada sugerida.\nFormato: {"veredicto":"INCORPORAR|ESPERAR|NO INCORPORAR","confianza":0-100,"resena":"2-4 frases","riesgos":["..."],"entrada":numero|null,"pct_sugerido":1-10}` },
  ]);
  const veredicto = ['INCORPORAR', 'ESPERAR', 'NO INCORPORAR'].includes(String(d.veredicto).toUpperCase()) ? String(d.veredicto).toUpperCase() : 'ESPERAR';
  const datos = {
    simbolo: sym, fila, modelo, veredicto,
    confianza: Math.max(0, Math.min(100, Number(d.confianza) || 0)),
    resena: String(d.resena || '').slice(0, 800),
    riesgos: (Array.isArray(d.riesgos) ? d.riesgos : []).slice(0, 5).map((x: unknown) => String(x).slice(0, 160)),
    entrada: Number(d.entrada) > 0 ? Number(d.entrada) : null,
    pct_sugerido: Math.max(1, Math.min(10, Number(d.pct_sugerido) || 3)),
  };
  analisisMem.set(sym, { ts: Date.now(), datos });
  await bitacora(env, [{ ts: Date.now(), tipo: 'ia', ok: true, modelo, ms: Date.now() - t0, texto: `IA (Radar ${sym}) respondió con ${modelo} en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${veredicto}` }]);
  const lista = await leer<Json[]>(env, 'senales', []);
  const item = { tipo: 'radar', ts: Date.now(), modelo, senales: [{ simbolo: sym, accion: veredicto, confianza: datos.confianza, razon: datos.resena.slice(0, 200), precio: fila.precio }] };
  await env.AGENTE.put('senales', JSON.stringify([item, ...lista].slice(0, MAX_SENALES)));
  return json(datos);
}

// ---------------------------------------------------------------- Mercado global
// Cripto, bolsa, oro y petróleo con datos públicos de Hyperliquid (perps «xyz:» para
// bolsa y materias primas). Entra en cada decisión de la IA: tono y turbulencia.
async function hlInfo(cuerpo: Json): Promise<any> {
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}`);
  return r.json();
}
const NOMBRES_SUB: Json = { 'xyz:XYZ100': 'Nasdaq 100', 'xyz:SP500': 'S&P 500', 'xyz:CL': 'Petróleo WTI', 'xyz:BRENTOIL': 'Petróleo Brent', 'xyz:GOLD': 'Oro', 'xyz:SILVER': 'Plata', 'xyz:SPCX': 'SpaceX' };
const nombreSub = (s: string) => NOMBRES_SUB[s] || s.replace(/^xyz:/, '');
// Volatilidad por hora en tres ventanas, con velas de 15 min de las últimas 49 h
// (una sola petición por activo: el plan gratis de Cloudflare permite 50 por llamada):
//  · 1 h: rango alto-bajo de las 4 últimas velas (Parkinson, más estable que 4 cierres);
//  · 24 h y 48 h: desviación de los cierres.
// También el cambio de precio en 1 h, 24 h y 48 h (para el análisis del mercado global).
const volMem = new Map<string, { ts: number; v: Json }>();
async function volatilidades(subyacentes: string[]): Promise<Json> {
  const out: Json = {}, ahora = Date.now();
  await Promise.all(subyacentes.slice(0, 26).map(async (u) => {
    const m = volMem.get(u);
    if (m && ahora - m.ts < 3 * 60_000) { out[u] = m.v; return; }
    try {
      const velas: Json[] = await hlInfo({ type: 'candleSnapshot', req: { coin: u, interval: '15m', startTime: ahora - 49 * 3_600_000, endTime: ahora } });
      const v = velas.map((x) => ({ c: Number(x.c), h: Number(x.h), l: Number(x.l) })).filter((x) => x.c > 0 && x.h > 0 && x.l > 0);
      if (v.length < 12) return;
      const c = v.map((x) => x.c), n = c.length - 1;
      const sd = (xs: number[]) => {
        const r = xs.slice(1).map((x, i) => Math.log(x / xs[i])), me = r.reduce((a, b) => a + b, 0) / r.length;
        return Math.sqrt(r.reduce((a, b) => a + (b - me) ** 2, 0) / Math.max(1, r.length - 1));
      };
      // Por hora = por vela de 15 min × √4.
      const s24 = sd(c.slice(-97)) * 2, s48 = sd(c) * 2;
      const park = Math.sqrt(v.slice(-4).reduce((a, x) => a + Math.log(x.h / x.l) ** 2, 0) / 4 / (4 * Math.LN2)) * 2;
      // Una hora sin movimiento no significa que el riesgo desapareció: piso en la mitad de la de 24 h.
      const s1 = Math.max(park || 0, s24 * 0.5);
      const cambio = (k: number) => (n >= k ? Math.round((c[n] / c[n - k] - 1) * 10000) / 100 : null);
      const r = s48 > 0 ? s1 / s48 : 1;
      const x: Json = { sigma_1h: s1, sigma_24h: s24, sigma_48h: s48, cambio_1h_pct: cambio(4), cambio_24h_pct: cambio(96), cambio_48h_pct: cambio(Math.min(n, 192)),
        regimen: r >= 1.8 ? 'turbulento' : r <= 0.5 ? 'calmo' : 'normal' };
      volMem.set(u, { ts: ahora, v: x });
      out[u] = x;
    } catch { /* sin velas: sin modelo */ }
  }));
  return out;
}
// Movimiento típico (1 desviación) en %, para mostrar.
const movTipico = (v: Json) => ({ h1: Math.round(v.sigma_1h * 10000) / 100, h24: Math.round(v.sigma_24h * Math.sqrt(24) * 10000) / 100, h48: Math.round(v.sigma_48h * Math.sqrt(48) * 10000) / 100 });
// ---- Mercado global: cripto, bolsa, oro y petróleo en 1 h / 24 h / 48 h. Entra en
// cada decisión (IA y reglas): tono (apetito o aversión al riesgo) y turbulencia.
const GLOBALES = ['BTC', 'ETH', 'SOL', 'HYPE', 'xyz:SP500', 'xyz:XYZ100', 'xyz:GOLD', 'xyz:CL'];
function mercadoGlobal(mids: Json, vol: Json, ahora: number): Json {
  const activos = GLOBALES.filter((s) => vol[s] && mids[s] != null).map((s) => ({ sub: s, nombre: nombreSub(s), precio: Number(mids[s]),
    cambio_1h_pct: vol[s].cambio_1h_pct, cambio_24h_pct: vol[s].cambio_24h_pct, cambio_48h_pct: vol[s].cambio_48h_pct, regimen: vol[s].regimen, mov: movTipico(vol[s]) }));
  const prom = (subs: string[]) => {
    const xs = activos.filter((a) => subs.includes(a.sub) && a.cambio_24h_pct != null).map((a) => a.cambio_24h_pct as number);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 : null;
  };
  const cripto = prom(['BTC', 'ETH', 'SOL', 'HYPE']), bolsa = prom(['xyz:SP500', 'xyz:XYZ100']), oro = prom(['xyz:GOLD']), petroleo = prom(['xyz:CL']);
  const riesgo = [cripto, bolsa].filter((x) => x != null) as number[];
  let tono = 'mixto';
  if (riesgo.length && riesgo.every((x) => x >= 0.5)) tono = 'alcista';
  else if (riesgo.length && riesgo.every((x) => x <= -0.5)) tono = 'bajista';
  const refugio = oro != null && oro >= 0.5 && (bolsa ?? 0) < 0;
  const turb = activos.filter((a) => a.regimen === 'turbulento');
  const turbulencia = turb.length > 0 && (turb.length * 3 >= activos.length || turb.some((a) => a.sub === 'BTC' || a.sub === 'xyz:SP500'));
  const f = (x: number | null) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x}%`);
  const resumen = `24 h: cripto ${f(cripto)}, bolsa ${f(bolsa)}, oro ${f(oro)}, petróleo ${f(petroleo)}. ` +
    (tono === 'alcista' ? 'Apetito por riesgo (todo sube).' : tono === 'bajista' ? 'Aversión al riesgo (cripto y bolsa caen).' : 'Tono mixto.') +
    (refugio ? ' El oro sube mientras la bolsa baja: buscan refugio.' : '') +
    (turbulencia ? ` Turbulencia: la última hora se mueve mucho más que lo normal (${turb.map((a) => a.nombre).join(', ')}); TradIA exige más confianza para comprar.` : ' Volatilidad normal.');
  return { ts: ahora, activos, cripto_24h_pct: cripto, bolsa_24h_pct: bolsa, oro_24h_pct: oro, petroleo_24h_pct: petroleo, tono, refugio, turbulencia, resumen };
}
let globalMem: { ts: number; datos: Json } | null = null;
async function contextoGlobal(): Promise<Json> {
  if (globalMem && Date.now() - globalMem.ts < 60_000) return globalMem.datos;
  const [mids, midsXyz] = await Promise.all([hlInfo({ type: 'allMids' }), hlInfo({ type: 'allMids', dex: 'xyz' }).catch(() => ({}))]);
  const todos: Json = { ...mids, ...midsXyz }, ahora = Date.now();
  const vol = await volatilidades(GLOBALES.filter((g) => todos[g] != null));
  const datos = { ts: ahora, global: mercadoGlobal(todos, vol, ahora) };
  globalMem = { ts: ahora, datos };
  return datos;
}

// ---------------------------------------------------------------- Gráficas
// Las velas las lee el runner de TU exchange en cada ciclo (1h, 4h y 1d).
async function graficasApi(env: Env, url: URL): Promise<Response> {
  const sym = limpiarSimbolo(url.searchParams.get('simbolo'));
  const g = await leer<Json>(env, 'graficas', {});
  const datos: Json = g.datos || {};
  if (!sym) return json({ ts: g.ts || null, simbolos: Object.keys(datos) });
  if (!datos[sym]) return json({ error: `${sym} aún no tiene gráfica: aparece en el próximo ciclo si está en tu cartera o en tu reparto.`, pendiente: true, simbolos: Object.keys(datos) }, 404);
  return json({ simbolo: sym, ts: g.ts, exchange: g.exchange, quote: g.quote, marcos: datos[sym] });
}

// ---------------------------------------------------------------- Semáforo
// Lo que la nube sabe de sí misma; la app le suma la latencia y GitHub Actions.
async function semaforo(env: Env): Promise<Response> {
  const [estado, config, log] = await Promise.all([leer<Json>(env, 'estado', {}), leerConfig(env), leer<Json[]>(env, 'bitacora', [])]);
  const u: Json = estado.ultimo || {};
  const ia = log.filter((l) => l.tipo === 'ia' && l.modelo).slice(0, 6);
  const { lista: provs } = await proveedoresIA(env);
  const p = provs[0] ? { nombre: provs[0].id === 'instalacion' ? provs[0].de || 'instalación' : provs[0].id, modelos: provs[0].modelos } : null;
  return json({
    version: env.AGENTE_VERSION || '1.0.0', ahora: Date.now(),
    ciclo: estado.ciclo || 0, actualizado: estado.actualizado || null, ok: u.ok !== false && !!estado.ciclo,
    errores: u.errores || [], exchange: u.exchange || null, modo: config.modo, pausado: !!config.pausado,
    real: u.real ? { error: u.real.error || null, libre: u.real.libre ?? null } : null, libre: u.libre ?? null,
    monto_min: config.monto_min, quote: config.quote, objetivo: config.objetivo,
    ia: { modo: config.ia, proveedor: p?.nombre || null, modelos: p?.modelos || [], preferido: await env.AGENTE.get('ia_pref'), ultimas: ia },
  });
}

// Prueba la IA con una pregunta mínima. Con `todos` prueba cada modelo y deja
// como preferido el primero que responde (así el agente deja de perder tiempo con
// modelos caídos). Solo escribe en KV si el preferido cambia.
async function iaProbar(env: Env, c: Json): Promise<Response> {
  const cands = await candidatosIA(env);
  if (!cands.length) return json({ ok: false, codigo: 'sin_ia', error: 'Tu nube no tiene IA configurada' });
  const mensajes = [{ role: 'system', content: 'Respondes SOLO JSON.' }, { role: 'user', content: 'Responde exactamente {"ok":true}' }];
  const lista = cands.slice(0, c.todos ? 5 : 3);
  const pruebas: Json[] = [];
  for (const x of lista) {
    const t0 = Date.now();
    try {
      await iaChat(env, mensajes, [x]);
      pruebas.push({ modelo: x.modelo, proveedor: x.prov.id, ok: true, ms: Date.now() - t0 });
      if (!c.todos) break;
    } catch (e: any) {
      pruebas.push({ modelo: x.modelo, proveedor: x.prov.id, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 160) });
    }
  }
  const bueno = pruebas.find((x) => x.ok);
  const previo = await env.AGENTE.get('ia_pref');
  let cambio = null;
  if (bueno && bueno.modelo !== (previo || cands[0].modelo)) {
    await env.AGENTE.put('ia_pref', bueno.modelo);
    cambio = bueno.modelo;
    await bitacora(env, [{ ts: Date.now(), tipo: 'ia', ok: true, texto: `Autocorrección: ${bueno.modelo} queda como modelo preferido (respondió en ${(bueno.ms / 1000).toFixed(1)} s)` }]);
  }
  const clave = pruebas.some((x) => /clave rechazada/.test(x.error || ''));
  return json({ ok: !!bueno, proveedor: bueno?.proveedor || cands[0].prov.id, modelo: bueno?.modelo || null, ms: bueno?.ms ?? null, pruebas, preferido_nuevo: cambio,
    codigo: bueno ? 'ok' : clave ? 'clave' : 'caida', error: bueno ? null : pruebas[pruebas.length - 1]?.error || 'La IA no respondió' });
}

// La IA lee el diagnóstico de la app y elige arreglos SOLO de la lista que la
// app le ofrece (nunca inventa acciones ni toca montos o el modo real).
async function iaDiagnosticar(env: Env, c: Json): Promise<Response> {
  const hallazgos = (Array.isArray(c.hallazgos) ? c.hallazgos : []).slice(0, 12).map((h: Json) => ({ id: String(h.id).slice(0, 30), estado: String(h.estado).slice(0, 10), detalle: String(h.detalle || '').slice(0, 300) }));
  const arreglos = (Array.isArray(c.arreglos) ? c.arreglos : []).slice(0, 10).map((a: Json) => ({ id: String(a.id).slice(0, 40), texto: String(a.texto || '').slice(0, 200) }));
  const t0 = Date.now();
  const { datos: d, modelo } = await iaChat(env, [
    { role: 'system', content: 'Eres el técnico de soporte de TradIA Cloud (agente de trading en GitHub Actions + Cloudflare Worker). Explicas en español sencillo a un principiante. Respondes SOLO JSON válido.' },
    { role: 'user', content: `Diagnóstico automático:\n${JSON.stringify(hallazgos)}\nArreglos disponibles (elige solo ids de esta lista, los que de verdad resuelvan algo):\n${JSON.stringify(arreglos)}\nFormato: {"resumen":"1-3 frases: qué falla y por qué","pasos":["pasos que debe hacer el usuario si algo no se arregla solo"],"arreglos":["id",...]}` },
  ]);
  const validos = new Set(arreglos.map((a: Json) => a.id));
  const elegidos = (Array.isArray(d.arreglos) ? d.arreglos : []).map(String).filter((x: string) => validos.has(x));
  await bitacora(env, [{ ts: Date.now(), tipo: 'ia', ok: true, modelo, ms: Date.now() - t0, texto: `IA (diagnóstico) respondió con ${modelo}: ${elegidos.length ? 'arreglos ' + elegidos.join(', ') : 'sin arreglos automáticos'}` }]);
  return json({ modelo, resumen: String(d.resumen || '').slice(0, 600), pasos: (Array.isArray(d.pasos) ? d.pasos : []).slice(0, 6).map((x: unknown) => String(x).slice(0, 240)), arreglos: [...new Set(elegidos)] });
}

// ---------------------------------------------------------------- API app
async function api(req: Request, env: Env, ruta: string, url: URL): Promise<Response> {
  const cuerpo: Json = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Json) : {};
  switch (`${req.method} ${ruta}`) {
    case 'GET /api/estado': {
      const [config, estado] = await Promise.all([leerConfig(env), leer<Json>(env, 'estado', {})]);
      const { runner, radar, ...resto } = estado;
      return json({ version: env.AGENTE_VERSION || '1.0.0', config, ...resto, costos: runner?.costos || {} });
    }
    case 'GET /api/ordenes':
      return json({ ordenes: await leerOrdenes(env), modo: (await leerConfig(env)).ordenes_ia });
    case 'POST /api/ordenes':
      return ordenesApi(env, cuerpo);
    case 'GET /api/historial':
      return json({ items: await leer<Json[]>(env, 'bitacora', []) });
    case 'GET /api/mercado/global':
      return json(await contextoGlobal().catch((e) => ({ error: `Hyperliquid no respondió: ${String(e?.message || e).slice(0, 120)}` })));
    case 'GET /api/graficas':
      return graficasApi(env, url);
    case 'GET /api/semaforo':
      return semaforo(env);
    case 'GET /api/ia/proveedores':
      return iaProveedoresApi(env, ruta, { _get: true });
    case 'POST /api/ia/proveedores':
    case 'POST /api/ia/proveedores/orden':
    case 'POST /api/ia/proveedores/probar':
    case 'POST /api/ia/consenso':
      return iaProveedoresApi(env, ruta, cuerpo);
    case 'POST /api/ia/probar':
      return iaProbar(env, cuerpo);
    case 'POST /api/ia/diagnosticar':
      return iaDiagnosticar(env, cuerpo).catch((e) => json({ error: String(e?.message || e) }, 502));
    case 'GET /api/senales':
      return json({ senales: await leer<Json[]>(env, 'senales', []) });
    case 'GET /api/operaciones':
      return json({ operaciones: await leer<Json[]>(env, 'operaciones', []) });
    case 'GET /api/config':
      return json({ config: await leerConfig(env), rangos: RANGOS });
    case 'POST /api/config': {
      const v = validarConfig(await leerConfig(env), cuerpo);
      if (v.error) return json({ error: v.error }, 400);
      await env.AGENTE.put('config', JSON.stringify(v.config));
      return json({ ok: true, config: v.config });
    }
    case 'POST /api/control': {
      const config = await leerConfig(env);
      if (cuerpo.accion === 'pausar' || cuerpo.accion === 'reanudar') {
        config.pausado = cuerpo.accion === 'pausar';
        await env.AGENTE.put('config', JSON.stringify(config));
        return json({ ok: true, pausado: config.pausado });
      }
      if (cuerpo.accion === 'reiniciar_simulacion') {
        const estado = await leer<Json>(env, 'estado', {});
        estado.runner = { costos: {}, cartera_sim: null };
        estado.historial = [];
        await env.AGENTE.put('estado', JSON.stringify(estado));
        return json({ ok: true });
      }
      return json({ error: 'acción desconocida' }, 400);
    }
    case 'GET /api/radar': {
      const estado = await leer<Json>(env, 'estado', {});
      return json({ radar: estado.radar || [], actualizado: estado.radar_ts || null, quote: estado.ultimo?.quote, exchange: estado.ultimo?.exchange });
    }
    case 'POST /api/radar/analizar':
      return radarAnalizar(env, cuerpo).catch(async (e) => {
        await bitacora(env, [{ ts: Date.now(), tipo: 'ia', ok: false, texto: `IA (Radar) falló: ${String(e.message || e).slice(0, 160)}` }]);
        return json({ error: String(e.message || e) }, 502);
      });
    case 'POST /api/radar/pedir': {
      const sym = limpiarSimbolo(cuerpo.simbolo);
      if (!sym) return json({ error: 'Falta el símbolo' }, 400);
      const config = await leerConfig(env);
      config.radar_pedidos = [sym, ...(config.radar_pedidos || []).filter((s: string) => s !== sym)].slice(0, 5);
      await env.AGENTE.put('config', JSON.stringify(config));
      return json({ ok: true, pedidos: config.radar_pedidos });
    }
    case 'POST /api/radar/incluir': {
      const sym = limpiarSimbolo(cuerpo.simbolo);
      const pct = Number(cuerpo.pct);
      if (!sym || !(pct > 0 && pct <= 25)) return json({ error: 'Elige un % entre 1 y 25' }, 400);
      const config = await leerConfig(env);
      const v = validarConfig(config, { objetivo: { ...config.objetivo, [sym]: pct } });
      if (v.error) return json({ error: v.error }, 400);
      await env.AGENTE.put('config', JSON.stringify(v.config));
      return json({ ok: true, config: v.config });
    }
    case 'GET /api/feed': {
      const desde = Number(url.searchParams.get('since') || 0);
      const feed = await leer<Json[]>(env, 'feed', []);
      return json({ now: Date.now(), items: feed.filter((f) => f.ts > desde).map((f) => ({ id: f.id, ts: f.ts, kind: f.tipo, title: f.titulo, body: f.texto })) });
    }
    case 'POST /api/avisos/probar':
      await avisar(env, [{ tipo: 'prueba', titulo: '¡TradIA conectado! ☁️', texto: 'Las notificaciones de tu nube funcionan.' }]);
      return json({ ok: true });
  }
  return json({ error: 'Ruta no encontrada' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (ruta === '/' || ruta === '/api/salud') {
        const estado = await leer<Json>(env, 'estado', {});
        return json({ ok: true, nombre: 'tradia-cloud', version: env.AGENTE_VERSION || '1.0.0', ciclo: estado.ciclo || 0, ultimo_ciclo: estado.actualizado || null });
      }
      if (ruta.startsWith('/runner/')) {
        if (!iguales(token(req), env.RUNNER_TOKEN)) return json({ error: 'No autorizado' }, 401);
        if (req.method === 'GET' && ruta === '/runner/config') return runnerConfig(env);
        // El runner usa la misma lectura de mercados y el mismo modelo que la app.
        // «/runner/predicciones» queda como alias para runners anteriores (sin mercados).
        if (req.method === 'GET' && (ruta === '/runner/mercado' || ruta === '/runner/predicciones')) return json({ mercados: [], ...(await contextoGlobal().catch(() => ({ global: null }))) });
        if (req.method === 'POST' && ruta === '/runner/tomar') return runnerTomar(env, (await req.json()) as Json);
        if (req.method === 'POST' && ruta === '/runner/reporte') return runnerReporte(env, (await req.json()) as Json);
        return json({ error: 'Ruta no encontrada' }, 404);
      }
      if (ruta.startsWith('/api/')) {
        if (!iguales(token(req), env.APP_TOKEN)) return json({ error: 'Token inválido' }, 401);
        return await api(req, env, ruta, url);
      }
      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (e: any) {
      return json({ error: `Error interno: ${String(e?.message || e).slice(0, 200)}` }, 500);
    }
  },
};
