# Maintainer-managed paper additions

Public importing is disabled. The site does not initialize the browser import dialog or load browser-local imported records. To add literature, the maintainer edits `papers.custom.json`, validates entries using `LibraryImport.parse`, then commits and publishes the repository. Visitors can search, save and export published papers. The parser remains available internally for the published overlay.

The following format reference also documents the former local importer; its public UI is no longer enabled.

# Importing and publishing papers

Choose **Import papers**, paste BibTeX or JSON (or choose a `.bib` / `.json` file), then select **Preview import**. The preview lists papers ready to add, duplicates, parsing errors, and omitted invalid links. **Add previewed papers** adds only the accepted records. Invalid records are not silently added.

Imports belong to this browser and website origin. They are stored under `la-imported-papers` in localStorage. They are not uploaded, synchronized, or added to the review. Imported metadata is user supplied and unverified. The collection manager can remove individual local papers; it cannot remove published references. Export a JSON backup before clearing browser data or moving to another browser. Storage failures leave the current collection unchanged and show an error.

## Supported formats

JSON accepts a single paper, an array, or this portable wrapper:

```json
{
  "schemaVersion": 1,
  "papers": [
    {
      "title": "Paper title",
      "authors": "First Author; Second Author",
      "year": "2026",
      "doi": "10.1234/example",
      "arxiv": "2601.12345",
      "version": "v1",
      "url": "https://example.org/paper",
      "pdf": "https://example.org/paper.pdf",
      "scope": "direct",
      "platforms": ["Unitree Go2"],
      "arms": ["Unitree Z1"],
      "setting": "hardware",
      "topics": [],
      "subtopics": [],
      "facets": [],
      "abstract": "An optional abstract."
    }
  ]
}
```

The identifiers above illustrate the format, not an actual paper. A title is required. Missing author, year, platform, or arm values remain unknown. Scope defaults to `background`; specify `direct`, `adjacent`, `locomotion`, or `survey` only when supported by the paper. Nothing is looked up automatically: an identifier alone cannot provide a title or establish provenance.

Optional `resources` can contain `code` and `projects` arrays with `{url,label,source}`. A code entry may provide a `license` string; it is retained as `reportedLicense`, while `license` is cleared and `openSource` is forced to `false`. Optional `overview` accepts `{src,caption,source,page,figureLabel,alt}`. All resource and image URLs must use HTTPS without credentials. These annotations remain user supplied; imported license claims never receive the verified-open-source label. Images are remote links, not embedded copies in the backup.

BibTeX supports nested braced values, quoted values, numeric fields, standard month abbreviations, and `#` string concatenation. Author lists separated by `and` are converted to the site's author format. Custom `@string` macros are not resolved: macro-dependent entries produce errors. `@comment`, `@preamble`, and `@string` declarations are skipped with a note. Advanced TeX formatting and accent commands may remain literal text; check the preview and correct metadata when necessary. The parser is a bibliography importer, not a TeX interpreter.

Each preview accepts up to 500 records and 2 MB of UTF-8 text. The local collection is limited to 1,000 records and 4 MB, subject to a browser's smaller quota. All duplicates are skipped using normalized DOI, version-independent arXiv ID, normalized title, or existing record ID. This conservative title match may treat two genuinely distinct same-title papers as duplicates; review them separately rather than force-importing misleading duplicates.

## Publish a portable overlay

1. Export the local JSON backup.
2. Review the metadata and the rights to share any abstract or linked figure. The exported records have `number: null` and empty `contexts`; they are independent library additions, not review citations.
3. Merge the exported `papers` into `website/papers.custom.json`, preserving existing custom papers. Use `{ "schemaVersion": 1, "papers": [...] }`.
4. Commit that file to the website repository. If the website directory is the repository root, the path is simply `papers.custom.json`.
5. The site's runtime overlay loader reads the file; the normal GitHub Pages deployment publishes the updated library. No backend credentials or root-project build tools are needed for this flow. The project exporter also consumes the same overlay for its static build.

Publishing a file is distinct from importing it into one browser. The importer never commits, pushes, or triggers deployment. The overlay must be included by the site's loader, and GitHub Pages must already be configured. Keep a separate copy of the original exported backup.

## Integration API

Load `import.js` before the application script. It creates no button unless `mount` is supplied, and it makes no network calls.

```js
const imports = LibraryImport.init({
  getPapers: () => papers,
  onChange: localPapers => refreshCatalog(localPapers)
});
document.querySelector('#import-open').onclick = () => imports.open();
```

`onChange` runs once synchronously during initialization and after successful mutations. It receives the complete normalized local list, not a delta. Merge it with the published list and rebuild search, ID maps, and filters. `getLocalPapers()` returns a shallow copy. `destroy()` removes the injected dialog and optional launcher.

- `LibraryImport.parse(text, existingPapers = [])` → `{accepted, duplicates, records, errors, warnings}`. Format is detected automatically. `duplicates` contains `{paper, existing}`; `existing` identifies the matching record. Fatal format/size problems throw an Error.
- `LibraryImport.normalizeRecord(raw)` → one sanitized paper; invalid required fields throw.
- `LibraryImport.classify(normalizedEntries, existingPapers = [])` → `{accepted, duplicates}`.
- `LibraryImport.safeURL(value)` → credential-free HTTPS URL or an empty string.

The runtime overlay loader can use `parse` against the published collection. For a larger trusted overlay, enforce its own byte/count limits, normalize entries, and use `classify`. Published overlay entries should set `localImported: false` and `origin: 'published-import'`, remove the `Local import` facet, and remain outside review citation numbering. Every renderer must escape text, avoid presenting null numbers as references, and label local/published additions separately. Resource metadata should never be interpreted as verified solely because it was imported.

## Validation

The module is dependency-free and exports the parser API through CommonJS for Node checks. Parser assertions cover nested BibTeX, concatenation, malformed entries, unresolved macros, DOI/arXiv/title/ID duplicates, stable backup round trips, invalid URL schemes/credentials, resource sanitization, and size limits. Browser interaction checks should additionally exercise preview, add, reload, remove, backup export, and storage refusal in the deployment browser.
