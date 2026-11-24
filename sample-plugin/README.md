# Pomodoro (plugin de ejemplo de Melanite)

Timer Pomodoro: bloques de trabajo con etiqueta, descanso corto automático después de cada bloque y descanso largo cada N bloques (por defecto 25/5/15, largo cada 3). Cada bloque terminado se anota en la nota diaria como `- 10:44–11:44 · 60 min · vuelo` (necesita el plugin interno "Notas diarias").

También es el **template** para escribir plugins nuevos: copiá esta carpeta y cambiá `manifest.json`.

## Compilar

```
npm install
npm run build          # tsc --noEmit (contra ../melanite-api.d.ts) + esbuild → main.js
npm run copy-to-app    # copia main.js, manifest.json y styles.css a ../public/plugins/pomodoro/
```

Desde la raíz del repo: `npm run plugin:sample` hace las dos cosas.

## Cómo está armado

- `src/main.ts`: la clase del plugin (`export default class … extends Plugin`), la vista del sidebar y la pestaña de ajustes.
- `src/timer.ts`: la lógica del timer, pura y testeada (`tests/unit/plugins.test.ts`). Guarda `endsAt`, así no se atrasa con la pestaña en segundo plano ni al recargar.
- `src/i18n.ts`: mini diccionario inglés/español que sigue `app.settings.language` (los plugins no tienen `t()`).
- `melanite` se importa como *external*: esbuild genera CommonJS y Melanite resuelve `require('melanite')` con la API de la app.

## Instalar

En Melanite: Ajustes → Plugins de la comunidad → Agregar plugin → "Instalar plugin de ejemplo: Pomodoro", o un zip con `manifest.json`, `main.js` y `styles.css`.
