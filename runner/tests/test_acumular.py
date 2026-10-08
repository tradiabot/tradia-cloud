"""«Acumular»: monedas que el agente compra pero nunca vende por su cuenta."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import estrategia as E  # noqa: E402
import ordenes as O  # noqa: E402
from exchanges import Simulador  # noqa: E402

CFG = {**E.CONFIG_DEFECTO, "quote": "USDC", "objetivo": {"BTC": 20}, "monto_min": 5, "no_vender": ["BTC"]}


class Pub:
    id, quote = "prueba", "USDC"

    def __init__(self, precios):
        self.p = precios

    def existe(self, s):
        return s in self.p

    def precios(self, s):
        return {k: {"precio": self.p[k]} for k in s if k in self.p}


class Acumular(unittest.TestCase):
    def test_estrategia_no_vende_aunque_haya_ganancia(self):
        saldos = {"USDC": 10, "BTC": 0.002}  # BTC ≈ 92 % de la cartera, RSI alto y +20 %
        p, notas = E.proponer(CFG, saldos, {"BTC": 60000}, {"BTC": {"rsi": 85}}, {"BTC": {"costo": 50000}})
        self.assertEqual(p, [])
        self.assertTrue(any("acumular" in n for n in notas))
        p, _ = E.proponer({**CFG, "no_vender": []}, saldos, {"BTC": 60000}, {"BTC": {"rsi": 85}}, {"BTC": {"costo": 50000}})
        self.assertEqual(p[0]["accion"], "VENDER")

    def test_tampoco_con_stop(self):
        cfg = {**CFG, "stop_perdida": 5, "nunca_vender_con_perdida": False}
        p, _ = E.proponer(cfg, {"USDC": 10, "BTC": 0.002}, {"BTC": 40000}, {"BTC": {"rsi": 50}}, {"BTC": {"costo": 50000}})
        self.assertEqual(p, [])

    def test_si_compra_lo_acumulado(self):
        p, _ = E.proponer(CFG, {"USDC": 100}, {"BTC": 60000}, {"BTC": {"rsi": 25}}, {})
        self.assertEqual(p[0]["accion"], "COMPRAR")

    def test_la_ia_no_propone_venderlo(self):
        notas = []
        op = {"BTC": {"accion": "VENDER", "confianza": 95}, "ETH": {"accion": "VENDER", "confianza": 95}}
        nuevas = O.de_la_ia(CFG, op, {"USDC": 0, "BTC": 0.01, "ETH": 1}, {"BTC": 60000, "ETH": 3000}, [], notas)
        self.assertEqual([o["simbolo"] for o in nuevas], ["ETH"])
        self.assertTrue(any("acumular" in n for n in notas))

    def test_ejecucion_bloquea_salvo_orden_tuya(self):
        ex = Simulador(Pub({"BTC": 60000}), {"USDC": 0, "BTC": 0.001})
        o = {"id": "i1", "simbolo": "BTC", "accion": "VENDER", "pct": 100, "origen": "ia"}
        costos = {"BTC": {"costo": 50000}}
        upd, op = O.ejecutar(ex, o, ex.saldos(), {"BTC": 60000}, costos, CFG, True)
        self.assertEqual((upd["estado"], op), ("error", None))
        self.assertIn("acumular", upd["error"])
        upd, op = O.ejecutar(ex, {**o, "id": "u1", "origen": "usuario"}, ex.saldos(), {"BTC": 60000}, costos, CFG, True)
        self.assertEqual(upd["estado"], "ejecutada")


if __name__ == "__main__":
    unittest.main()
