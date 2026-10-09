"""Órdenes explícitas: las que propone la IA y las que crea o aprueba el usuario.

Viven en la nube (KV `ordenes`). Cada ciclo el runner recibe las aprobadas, las
ejecuta si se cumple su precio límite y devuelve qué pasó con cada una. También
convierte las señales fuertes de la IA en órdenes nuevas: «propuesta» (esperan
tu aprobación) o, en modo auto, ejecutadas en el mismo ciclo.
"""
import time

from exchanges import ErrorExchange

MAX_IA_CICLO = 2  # órdenes nuevas de la IA por ciclo

# Vender monedas spot sin pérdida: precio ≥ costo + este margen (comisión de venta ~0.1-0.4 %
# y diferencia entre el último precio y lo que de verdad paga el comprador).
MARGEN_SPOT = 0.005


def minimo_spot(costo):
    return costo * (1 + MARGEN_SPOT) if costo and costo > 0 else None


# Ventas que el candado frenó en este ciclo (van al reporte como «loss_sell_block»).
BLOQUEOS = []


def _bloqueo(que, motivo):
    BLOQUEOS.append({"ts": int(time.time() * 1000), "que": str(que)[:90], "motivo": str(motivo)[:200]})


def _cantidad_venta(o, saldos):
    pct = max(1.0, min(100.0, float(o.get("pct") or 100)))
    return saldos.get(o["simbolo"], 0.0) * pct / 100


def lista_para_intentar(o, precios):
    """¿Se puede intentar ya? Una orden spot con límite espera a que el precio lo cumpla."""
    if not o.get("limite"):
        return True
    p = precios.get(o.get("simbolo"))
    if not p:
        return True  # que ejecutar() explique que no hay precio
    return p <= o["limite"] if o.get("accion") == "COMPRAR" else p >= o["limite"]


def ejecutar(ex, o, saldos, precios, costos, cfg, simulado):
    """Intenta ejecutar una orden aprobada. Devuelve (actualizacion, operacion|None).
    Si aún no se cumple su condición, la orden sigue «aprobada» con una nota."""
    if o.get("tipo") == "prediccion":  # de versiones anteriores: aquí ya no se operan
        return {"id": o["id"], "estado": "error", "error": "Las predicciones no forman parte de TradIA Cloud"}, None
    sym, acc = o["simbolo"], o["accion"]
    upd = {"id": o["id"]}
    precio = precios.get(sym)
    if not precio:
        return {**upd, "estado": "error", "error": f"Sin precio para {sym} en tu exchange"}, None
    lim = o.get("limite")
    if lim and ((acc == "COMPRAR" and precio > lim) or (acc == "VENDER" and precio < lim)):
        return {**upd, "estado": "aprobada", "nota": f"Esperando precio {'≤' if acc == 'COMPRAR' else '≥'} {lim} (ahora {precio:.6g})"}, None
    minimo = float(cfg.get("monto_min") or 1)
    quote = cfg["quote"].upper()
    try:
        if acc == "COMPRAR":
            libre = saldos.get(quote, 0.0)
            monto = min(float(o.get("monto") or 0), libre)
            if monto < minimo:
                return {**upd, "estado": "aprobada", "nota": f"Saldo libre insuficiente: {libre:.2f} {quote} (mínimo {minimo:g})"}, None
            r = ex.comprar(sym, monto)
            from estrategia import registrar_compra
            registrar_compra(costos, sym, saldos.get(sym, 0.0), r["cantidad"], r["precio"])
        else:
            if o.get("origen") != "usuario" and sym in {str(s).upper() for s in (cfg.get("no_vender") or [])}:
                _bloqueo(f"Vender {sym}", "moneda en «acumular»")
                return {**upd, "estado": "error", "error": f"No vendí: {sym} está en «acumular» (solo la vendes tú, con una orden tuya)."}, None
            cant = _cantidad_venta(o, saldos)
            if cant * precio < minimo:
                return {**upd, "estado": "error", "error": f"No tienes suficiente {sym} para vender (mínimo {minimo:g} {quote})"}, None
            c = costos.get(sym) or {}
            costo, minimo = c.get("costo"), None
            if cfg.get("nunca_vender_con_perdida", True) and not o.get("permitir_perdida"):
                if o.get("origen") == "ia" and (not costo or c.get("estimado")):
                    _bloqueo(f"Vender {sym}", f"costo {'estimado' if costo else 'desconocido'}")
                    return {**upd, "estado": "error", "error": f"No vendí: no sé a cuánto compraste {sym} (costo {'estimado' if costo else 'desconocido'}) y la IA no vende si puede haber pérdida."}, None
                minimo = minimo_spot(costo)
                if minimo and precio < minimo:
                    _bloqueo(f"Vender {sym}", f"P/L {(precio / costo - 1) * 100:+.2f} % (mínimo +{MARGEN_SPOT * 100:g} %)")
                    return {**upd, "estado": "aprobada", "nota": f"Sería con pérdida o sin cubrir comisión ({(precio / costo - 1) * 100:+.1f}%; sin pérdida desde {minimo:.6g}): espero o marca «vender aunque pierda»"}, None
            r = ex.vender(sym, cant, minimo)
    except ErrorExchange as e:
        return {**upd, "estado": "error", "error": str(e)[:200]}, None
    costo = (costos.get(sym) or {}).get("costo")
    op = {"ts": int(time.time()), "simbolo": sym, "accion": acc, "cantidad": r["cantidad"], "precio": r["precio"],
          "total": round(r["total"], 2), "motivo": f"Orden {'de la IA' if o.get('origen') == 'ia' else 'tuya'}: {o.get('razon') or ''}".strip(": "),
          "simulada": simulado, "pnl": round((r["precio"] / costo - 1) * 100, 2) if acc == "VENDER" and costo else None,
          "orden": o["id"], "ia": o.get("ia")}
    return {**upd, "estado": "ejecutada", "resultado": {"precio": r["precio"], "cantidad": r["cantidad"], "total": round(r["total"], 2), "ts": int(time.time() * 1000)}}, op


def de_la_ia(cfg, opiniones, saldos, precios, pendientes, notas=None):
    """Señales COMPRAR/VENDER con confianza suficiente → órdenes nuevas (sin repetir
    las que ya están pendientes). En modo auto la IA solo compra monedas de tu reparto
    y sin pasar su objetivo: si no, cada ciclo podría volver a comprar lo mismo."""
    if cfg.get("ia") == "off" or cfg.get("ordenes_ia", "proponer") == "off":
        return []
    notas = notas if notas is not None else []
    auto = cfg.get("ordenes_ia") == "auto"
    from estrategia import valorar
    total, activos = valorar(saldos, precios, cfg["quote"].upper())
    pesos = {a["simbolo"]: a["peso"] for a in activos}
    umbral = float(cfg.get("ia_conf_min") or 65)
    quote = cfg["quote"].upper()
    mn, mx = float(cfg.get("monto_min") or 5), float(cfg.get("monto_max") or 25)
    ya = {(o["simbolo"], o["accion"]) for o in pendientes}
    guardar = {str(s).upper() for s in (cfg.get("no_vender") or [])}
    nuevas = []
    for sym, o in sorted(opiniones.items(), key=lambda kv: -kv[1].get("confianza", 0)):
        acc, conf = o.get("accion"), float(o.get("confianza") or 0)
        if acc not in ("COMPRAR", "VENDER") or conf < umbral or (sym, acc) in ya or sym not in precios:
            continue
        orden = {"simbolo": sym, "accion": acc, "origen": "ia", "razon": o.get("razon", ""), "confianza": int(conf),
                 "ia": {"accion": acc, "confianza": int(conf), "razon": o.get("razon", "")}}
        if acc == "COMPRAR":
            if saldos.get(quote, 0.0) < mn:
                continue
            f = (conf - umbral) / max(1.0, 100 - umbral)
            orden["monto"] = round(mn + (mx - mn) * f, 2)
            if auto:
                obj = float((cfg.get("objetivo") or {}).get(sym, 0))
                tras = pesos.get(sym, 0.0) + (100 * orden["monto"] / total if total else 100)
                if obj <= 0 or tras > obj + float(cfg.get("banda") or 0):
                    notas.append(f"IA: quería comprar {sym}, pero {'no está en tu reparto' if obj <= 0 else f'pasaría su objetivo ({tras:.1f}% de {obj:g}%)'}: no compro sola")
                    continue
        else:
            if sym in guardar:
                notas.append(f"IA: sugirió vender {sym}, pero está en «acumular»: no la propongo")
                continue
            if saldos.get(sym, 0.0) * precios[sym] < mn:
                continue
            orden["pct"] = 100 if conf >= 85 else 50
        nuevas.append(orden)
        if len(nuevas) >= MAX_IA_CICLO:
            break
    return nuevas
