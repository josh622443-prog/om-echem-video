# OM × ECHEM Video Generator

Browser-based tool for turning time-stamped optical microscopy images into a time-lapse video, optionally synchronized with electrochemical data.

## Current release

Version **1.6.0** (2026-09-12)

## Features

- Image-only time-lapse or synchronized OM + electrochemistry video
- Automatic chronological sorting using trailing numbers in image filenames
- GCPL text/CSV/TSV data parsing and automatic column detection
- Voltage curve with optional current curve
- Difference-from-first-frame visualization
- Scale-bar overlay in difference mode
- Chinese and English interface
- WebM video generation in the browser

## Run the tool

Keep these three files in the same folder:

- `index.html`
- `echem_v1.6.0.js`
- `om-video_v1.6.0.js`

Open `index.html` in a modern desktop browser. An internet connection is required when the page first loads because Papa Parse and fonts are loaded from CDNs.

Select all desired images together. The trailing number in each filename is interpreted as elapsed minutes and used to sort the images. For example, `OM_frame_23.jpg` is treated as 23 minutes.

## Data privacy

Images and electrochemical data are processed locally in the browser and are not uploaded by this repository.

## Output note

The tool records video through the browser `MediaRecorder` API and normally exports WebM (VP9, VP8, or browser-supported WebM fallback). Browser support and output encoding may vary.

## Citation

If you use this software in research, a presentation, or a publication, please cite this repository using GitHub's **Cite this repository** button. A related manuscript is in preparation; citation information will be updated after publication. See [CITATION.md](CITATION.md).

## Known limitations

- Image filenames must end in a number to be included and synchronized correctly.
- Automated tests and example input files are not yet included.
- Browser compatibility has not yet been documented systematically.
- MP4 export is not currently provided; the normal output is WebM.

## License

MIT License. Copyright (c) 2026 Kuo-Feng King.
