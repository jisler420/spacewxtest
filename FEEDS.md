# Open space weather feeds

Public, no API key. The page tries **primary**, then **backup**. If a URL fails, it moves to the next.

Primary family: NOAA SWPC — https://services.swpc.noaa.gov

## Failover order

### Aurora oval
1. https://services.swpc.noaa.gov/json/ovation_aurora_latest.json
2. https://services.swpc.noaa.gov/images/animations/ovation/north/latest.jpg
3. https://services.swpc.noaa.gov/images/animations/ovation/south/latest.jpg

### Planetary Kp
1. https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
2. https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json

### Dst
1. https://services.swpc.noaa.gov/products/kyoto-dst.json
2. https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json

### Solar flux (SFI / F10.7)
1. https://services.swpc.noaa.gov/products/summary/10cm-flux.json

### X-ray (0.1–0.8 nm)
1. https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json
2. https://services.swpc.noaa.gov/json/goes/secondary/xrays-6-hour.json

### Solar wind speed
1. https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json

### IMF Bz / Bt
1. https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json

### R / S / G scales
1. https://services.swpc.noaa.gov/products/noaa-scales.json

### Hemispheric power
1. https://services.swpc.noaa.gov/text/aurora-nowcast-hemi-power.txt

### WSA-Enlil
1. https://services.swpc.noaa.gov/images/animations/enlil/latest.jpg

### Europe magnetometers (TGO official H GIF)
1. https://flux.phys.uit.no/cgi-bin/mkstackplot.cgi?GifOnly&&comp=H&nor=&Sync=

### North America magnetometers (USGS JSON, X component)
BRW, CMO, BOU, FRD — https://geomag.usgs.gov/ws/data/?id=STATION&format=json

### Map tiles
NASA GIBS Blue Marble (no API key)

### ZIP lookup
https://api.zippopotam.us/us/58201
