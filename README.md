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


## Locomotion expansion

The atlas now includes 245 references, with 34 curated quadruped locomotion studies exposed separately from quadruped-arm studies. Research directions include locomotion, perceptive locomotion, and agility/parkour. The two newly collected papers are arXiv:2201.08117 and arXiv:2309.14341; their source PDFs remain in the private local library, with public primary-source links. The homepage uses an AI-generated conceptual pair portrait, compressed as a local JPEG; it does not identify commercial models.


## Code, projects, figures, and imports

The resource audit covers all 245 catalog entries: 69 papers have verified public code links, 34 have at least one verified standard open-source license, and 96 have an author project or companion-resource page. A missing link means not verified, not that no release exists. Author links in abstracts and the first two PDF pages were screened; access failures and uncaptured later-page links remain limitations. Each resource keeps its source and check date. Download `assets/resource-index.csv` for the full index.

62 paper overviews are reproduced from the locally held original PDFs with author credit, source, page, and figure number. The website loads each compressed image only when needed; missing overviews are explicitly marked.

Use **Import papers** for BibTeX/JSON preview, deduplication, browser-local storage, backup, and removal. See [IMPORT.md](IMPORT.md) for formats and publishing to the shared site through `papers.custom.json`. Imported records remain separate from manuscript citations. Both the runtime and repository exporter preserve the custom overlay and use the same normalizer.

## Paper relationship explorer

Open **Paper graph** or **Related papers** in any paper detail. Search for a starting paper, select a nearby node to inspect the connection, and choose **Make starting paper** to continue exploring. Zoom controls, pointer panning, keyboard node/list selection, and a responsive paper list are available.

The graph uses shared catalog evidence, not a bibliographic citation database: each shared research subtopic contributes 3 points (generic survey/review tags excluded), an exact shared robot platform contributes 4, and an identical stored review paragraph contributes 5. Filters restrict which evidence counts. Up to 22 neighbors (12 on small screens) and 24 additional neighbor-to-neighbor edges are shown. The deterministic layout and scores are navigation aids, not scientific impact metrics. Source paragraphs can be expanded in the selected-node panel. Imported records participate through their supplied metadata; missing metadata may hide relationships.

Routes such as `#graph?seed=L260408508&basis=co-mention` are shareable. The page uses local JavaScript, SVG, and CSS with no external graph service or framework. Link icons and the site mark are also local SVGs.
