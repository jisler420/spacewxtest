# SpaceWx experimental

Isolated from the stable test kiosk. Primary + one fallback per number. Data-age colors on timestamps. Does not poll full RTSW JSON.

| Number | Primary | Fallback |
|---|---|---|
| Speed / Bt / Bz | KNMI `*_rt` | NOAA summary (~60 B) |
| Density | KNMI plasma | last good (summary has no density) |
| Hp30 | KNMI `hp30_index` | none (no GFZ in browser) |
| Kp 3hr | NOAA Kp JSON | KNMI `kp_index` |
| Dst now | NOAA `kyoto-dst.json` | last good; Pred stays Geospace |
| Hemi / map | NOAA hemi + OVATION | last canvas |

Timestamps: muted = fresh, yellow = soft stale (keep number), red = hard stale (keep number). Cards are not wiped when a sibling feed fails.

## Later ideas (not wired)

NASA CCMC ISWA HAPI catalog: https://iswa.ccmc.gsfc.nasa.gov/hapi/catalog  
Possible NOAA-copy failover IDs: `swpc_rtsw_mag_P1M`, `swpc_rtsw_plasma_P1M`, `NOAA_KP_P3H`. Do not use as primary vs KNMI.

