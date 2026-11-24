# Melanite

## App de escritorio (Windows)

La misma app, empaquetada con Electron: ícono propio en la barra de tareas, funciona offline desde el primer arranque y se actualiza sola.

**Instalar**

1. Entrá a [Releases](https://github.com/Gr8Kaio/melanite/releases/latest) y bajá `Melanite-Setup-X.Y.Z.exe`.
2. Ejecutalo. El instalador no está firmado (la firma de código es paga), así que Windows muestra **"Windows protegió tu PC"**: hacé click en **Más información → Ejecutar de todas formas**.
3. Elegí la carpeta de instalación. Se crean accesos directos en el escritorio y en el menú Inicio.

**Anclar a la barra de tareas:** abrí Melanite, click derecho sobre su ícono en la barra → *Anclar a la barra de tareas*.

**Datos:** los datos de la app de escritorio son independientes de los del navegador (cada uno guarda en su propio almacenamiento) hasta que se active la sync. Desinstalar la app **no borra** tus notas.

**Actualizaciones:** al arrancar y cada 6 horas revisa los Releases, descarga en segundo plano y pregunta si reiniciar ahora o después.

**Desarrollo**

```
npm run desktop:dev      # build de escritorio + Electron
npm run desktop:build    # instalador local en release/
```

**Publicar una versión nueva**

1. Subí `version` en `package.json` y commiteá.
2. `git tag vX.Y.Z` (el mismo número que `package.json`).
3. `git push --tags`. El workflow `desktop.yml` construye el instalador y lo sube al Release del tag.
