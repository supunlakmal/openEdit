# PDF Tools

Privacy-first PDF utilities that run fully in the browser.  
No file uploads, no backend processing.

## What This Project Does

This app currently provides two core tools:

- Merge multiple PDF files into one output PDF
- Split one PDF into multiple PDFs by page range

It is a static frontend app built with vanilla HTML, CSS, and JavaScript.

## Key Features

- Drag-and-drop PDF upload
- Merge mode:
  - Combine pages from multiple files
  - Reorder pages with drag-and-drop or "Move to" dropdown
  - Remove and restore pages before export
  - Preview full file or single page before merging
- Split mode:
  - Split one source PDF by custom ranges (example: `1-3, 5, 8-10`)
  - Leave range input empty to export each page separately
  - Download split output as:
    - ZIP file
    - Individual PDF downloads
- Light/Dark theme toggle (saved in `localStorage`)
- App launcher modal (loads `../apps.html` in an iframe)
- Service worker file included for asset caching (`sw.js`)

## Tech Stack

- Vanilla HTML/CSS/JavaScript (ES modules)
- [pdf-lib](https://github.com/Hopding/pdf-lib) for merge/split processing
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering and previews
- [FileSaver.js](https://github.com/eligrey/FileSaver.js/) for downloads
- [JSZip](https://stuk.github.io/jszip/) for ZIP export
- Font Awesome + Google Fonts (CDN)

## Project Structure

```text
pdf/
|-- index.html            # App layout and modal markup
|-- styles.css            # UI styles, responsive layout, theme rules
|-- script.js             # Main controller: tool switching, events, processing
|-- sw.js                 # Service worker caching strategy
|-- manifest.json         # PWA metadata
|-- favicon.ico           # Browser favicon
|-- apple-touch-icon.png  # iOS home screen icon
|-- icons/
|   |-- icon-192.png      # PWA icon (192x192)
|   `-- icon-512.png      # PWA icon (512x512)
|-- modules/
|   |-- pdf_ops.js        # Merge/split core logic
|   `-- ui.js             # File/page state, rendering, preview modals
`-- README.md             # This file
```

## How To Run

### Option 1: Open directly

Open `pdf/index.html` in a modern browser.

### Option 2: Run from local server (recommended)

From repo root:

```bash
npx serve .
```

Then open:

- `http://localhost:3000/pdf/`

## How To Use

### Merge PDFs

1. Keep tool mode on **Merge**
2. Drop/select multiple `.pdf` files
3. Reorder or remove pages in the page grid
4. Set output filename
5. Click **Merge Files**

### Split PDF

1. Switch to **Split**
2. Drop/select one `.pdf` file
3. Enter ranges (optional), or select pages visually
4. Click **Split File**
5. Choose **Download as ZIP** or **Download all files**

## Split Range Syntax

- Single page: `4`
- Page range: `2-6`
- Mixed: `1-3, 5, 9-12`
- Empty input: one output file per page

Invalid ranges throw a user-facing error (for example out-of-bounds pages).

## Privacy & Data Handling

- Processing happens in-browser only
- Files are not uploaded to a server
- Theme preference is stored locally in `localStorage`

## PWA / Offline Notes

- `manifest.json` and `sw.js` are present.
- `sw.js` uses:
  - network-first for HTML navigation
  - cache-first for static assets and libraries
- `script.js` registers `sw.js` automatically on secure origins (`https`/`localhost`).
- App icons are configured for favicon, Apple touch icon, and PWA install icons.

## Known Constraints

- Split mode processes one source PDF at a time
- Password protection/encryption is not included in this app

## Browser Support

Modern Chromium, Firefox, Edge, and Safari versions that support:

- ES modules
- File API
- Canvas API
- `localStorage`

## License

Use the same license as the parent repository/project unless specified otherwise.
