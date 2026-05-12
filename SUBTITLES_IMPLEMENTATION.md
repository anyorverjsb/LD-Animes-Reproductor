# Implementación de Subtítulos Automáticos

## Descripción
Se ha implementado la detección y carga automática de subtítulos en ambos reproductores de video (CustomVideoPlayer y CustomVideoPlayerOrange).

## Características

### Detección Automática
- Cuando se carga una URL de video, el sistema busca automáticamente archivos de subtítulos en la misma carpeta
- Soporta formatos: `.srt`, `.vtt`, `.ass`, `.ssa`
- Utiliza el mismo nombre de archivo del video (ejemplo: `video.mp4` → `video.srt`)

### Funcionalidad
1. **Parseo de Subtítulos SRT**: Lee y parsea archivos SRT para extraer tiempos y textos
2. **Sincronización en Tiempo Real**: Los subtítulos se actualizan automáticamente según el tiempo actual del video
3. **UI Personalizada**: Subtítulos mostrados en un overlay en la parte inferior del video (con fondo semi-transparente)

## Ejemplo de Uso

Para una URL como:
```
https://huggingface.co/anioruberu/mp4/resolve/main/Dragon%20Ball%20Z.../video.mp4
```

El sistema busca automáticamente:
```
https://huggingface.co/anioruberu/mp4/resolve/main/Dragon%20Ball%20Z.../video.srt
https://huggingface.co/anioruberu/mp4/resolve/main/Dragon%20Ball%20Z.../video.vtt
https://huggingface.co/anioruberu/mp4/resolve/main/Dragon%20Ball%20Z.../video.ass
https://huggingface.co/anioruberu/mp4/resolve/main/Dragon%20Ball%20Z.../video.ssa
```

Si encuentra alguno, lo carga y muestra automáticamente.

## Estados Agregados
- `autoDetectedSubtitleUrl`: Almacena la URL del archivo de subtítulos detectado
- `currentSubtitleText`: Texto del subtítulo actual siendo mostrado
- `subtitles`: Array con todos los subtítulos parseados
- `showSubtitles`: Control para mostrar/ocultar subtítulos (siempre true actualmente)

## Funciones Agregadas
- `parseSRTSubtitles()`: Parsea contenido SRT a array de objetos {start, end, text}
- `loadSubtitles()`: Carga archivo de subtítulos desde una URL
- `detectSubtitleUrl()`: Detecta automáticamente archivo de subtítulos

## Archivos Modificados
- `/components/custom-video-player.tsx`
- `/components/custom-video-player-orange.tsx`
