# Cambios

## 1.0.0 · 2026-10-08 · Primera versión

*tradIA cloud*: tu agente cripto en tu propia nube. Nace de la arquitectura abierta de Kumo Bot y de lo aprendido en TradBot.

- **Agente, no bot**: cada 30 min **observa** (precios, mercado global y noticias de 24 h), **razona** (varias IAs votan y gana el consenso), **actúa** dentro de tus límites y te **reporta** todo.
- **Tu nube, tus claves**: la app viene vacía. Cada persona crea su repositorio privado `tradia-nube` en GitHub y su Worker en Cloudflare, con sus propias claves.
- **Varias IAs gratis**:
  - con clave: Groq, Gemini, OpenRouter, Cerebras y Mistral;
  - sin clave: Kilo, LLM7 y OVH.
  
  Tiene respaldo en cadena, ▶ PROBAR, orden ↑↓ y claves cifradas (AES-GCM). La nube elige sola los modelos que tiene cada cuenta.
- **🪙 Acumular (no vender)**: marca BTC u otras monedas. El agente las compra pero nunca las vende por su cuenta: ni por estrategia, ni por stop, ni por la IA, ni para pagar predicciones. Solo tus órdenes manuales.
- **Candado de pérdidas**: por defecto ninguna venta automática con pérdida ni con costo desconocido.
- **Exchanges**: Hyperliquid y MEXC (sin KYC), Crypto.com, Kraken, Coinbase, Bitstamp, Gate u otro de ccxt.
- **Marca e interfaz**:
  - logo de nube crema con gráfica terracota y sol mostaza (todo se genera desde `docs/marca/generar.py`);
  - temas indie **Atardecer** (por defecto) y **Lino**, además de Pro Grafito, Pro Porcelana, Neón Noche, Neón Día y Clásica.
- **Documentación**: README con los modelos de IA y sus enlaces, licencia MIT y [aviso legal](AVISO-LEGAL.md). No es un exchange, no custodia fondos y no es asesoría financiera.
