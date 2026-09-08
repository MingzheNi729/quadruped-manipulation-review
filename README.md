# Legged & Armed

A lightweight, English-language research companion for quadrupedal mobile manipulation. English navigation, paper titles, abstracts and review.

Built with vanilla HTML/CSS/JavaScript. No framework, CDN, analytics, login or backend. The library is loaded once; the full review loads on demand. Bookmarks stay in browser localStorage.

- Search titles, authors, abstracts and identifiers.
- Filter by review direction, 16 research directions, evidence scope, robot platform and manipulator.
- View primary-source links, abstracts, platform evidence and all retained review excerpts.
- Read the complete review with clickable citations.
- Save favorites, share a paper link and export filtered BibTeX.

Technical keyword labels are title/catalog matches, not manually validated scientific classification. Research directions overlap. Hardware labels come from local source checks. Unknown models remain unspecified; paper-level simulation/hardware settings may differ across individual robots. The website corrects GAMMA to direct quadruped-arm evidence based on the B1 + Z1 hardware passage; the downloadable review PDF remains the preceding editorial snapshot.

## Development

From this directory: `python3 -m http.server 8765`. Open http://localhost:8765/ .

Data is exported from the parent research workspace using `scripts/build_website.py`. Public assets deliberately omit local filesystem paths, downloaded third-party PDFs and internal working records. The only PDF hosted here is the review itself. Research papers open at their original public sources.

GitHub Pages publishes the root of the main branch; `.nojekyll` disables Jekyll processing.
