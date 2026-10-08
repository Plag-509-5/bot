# Petits médias de test

Ces fichiers synthétiques ne contiennent aucune donnée personnelle et servent
aux tests hors réseau de chiffrement / publication de statuts avec xzcbailz.
Ils ne remplacent pas un essai de lecture sur un téléphone WhatsApp.

- `status-video.mp4` : 1 seconde, carré bleu 32×32, H.264, sans audio (~1,5 Ko).
- `status-audio.ogg` : 1 seconde, sinus 440 Hz, Opus 48 kHz (~1,1 Ko).

Génération (ffmpeg n'est pas requis pour exécuter les tests, seulement pour
recréer ces deux fixtures) :

```sh
ffmpeg -f lavfi -i color=c=blue:s=32x32:r=1 -t 1 -an -c:v libx264 \
  -pix_fmt yuv420p -movflags +faststart status-video.mp4
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 \
  -c:a libopus -b:a 8k status-audio.ogg
```

Les images PNG et miniatures JPEG des tests sont créées en mémoire avec le
`sharp` déjà utilisé par le projet.
