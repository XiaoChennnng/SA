# Research Workflow

SA is a Science Agent: its built-in tools cover literature discovery, paper reading, notes,
experiments, citations, data analysis, and manuscript builds. Everything is stored locally; SA
never uploads research data.

## Tools

| Tool | Use it for |
|---|---|
| `paper_search` | Search arXiv, OpenAlex, Semantic Scholar, Crossref, PubMed, Europe PMC, OpenAIRE, DOAJ, HAL, and configured Chinese sources; deduplicate results and save them locally |
| `paper_read` | Read a paper by DOI, arXiv ID, PMID, URL, or local file, with page ranges and caching |
| `research_note` | Save summaries, quotations, ideas, and todos, linked to papers and searchable in full text |
| `experiment_log` | Record hypotheses, configurations, metrics, artifacts, and compare runs |
| `citation` | Import BibTeX entries by DOI/arXiv/PMID, validate, list, and export `.bib` files |
| `latex_build` | Compile LaTeX with `latexmk`, `pdflatex`, `xelatex`, or `lualatex` and report diagnostics |
| `python_run` | Run Python code or scripts with output capture and optional experiment logging |
| `web_search` | Search the web through AnySearch; returns titles, URLs, snippets, and extracted content |
| `web_extract` | Read a public web page by URL through AnySearch |
| `web_search_domains` | List AnySearch domains, sub-domains, and parameters for specialized searches |

These tools are active by default. Remove them from `defaultTools` or disable individual tools with
`--exclude-tools` when you want a coding-only session.

## Typical literature loop

1. `paper_search` with a specific query. Try synonyms and author names. Results include DOI, arXiv
   ID, PMID, venue, citation count, abstract, and open-access PDF links.
2. `paper_read` on the most relevant IDs. Long papers are returned in page ranges; continue with
   `pageStart` until you have read the sections you need.
3. `research_note` to record claims, quotations, and contradictions, linked by `paperId`.
4. `citation` to import the papers you will reference, then `citation` with `action: "export"` to
   write `references.bib`.

## Typical experiment loop

1. Run analysis with `python_run` or `bash`. Keep the script in the repository.
2. Record the run with `experiment_log` (`action: "save"`) including configuration, metrics, and
   artifact paths. `python_run` can also record the run directly with `saveExperiment: true`.
3. Compare runs with `experiment_log` (`action: "compare"` and `ids`). The output includes per-metric
   values and deltas against the first run.
4. Write up the result and cite the papers from the citation database.

## Chinese literature

Chinese coverage uses configured sources:

- **Wanfang (万方)** — official open-platform API. Create an APP_KEY at
  [ai.wfdata.com](https://ai.wfdata.com), then run `/research` or set `research.wanfangAppKey`.
  Wanfang covers Chinese journals, theses, and conference papers.
- **CNKI (知网)** — CNKI has no public search API and its web search blocks automated clients. SA
  therefore runs a local command you configure (`research.cnkiCommand`). The command receives
  `{query}` and `{limit}`, must print JSON, and should use an access method you are authorized to
  use, for example a local `cnki-search` CLI. See [command contract](#command-contract).
- **NSTL (国家科技图书文献中心)** — NSTL exposes metadata and document delivery only through
  institutional Web Services that require an application, credentials, and NSTL documentation.
  Configure `research.nstlCommand` with your institution's authorized gateway. It uses the same
  command contract and is never scraped by SA.

Chinese sources join the default search only when configured. You can also name them explicitly in
`paper_search` with `sources: ["wanfang", "cnki", "nstl"]`; unconfigured sources return a source
error while other sources continue.

### Command contract

The command must print a JSON array (or `{ "results": [...] }`) with fields SA recognizes:

```json
[
  {
    "title": "论文标题",
    "authors": ["作者一", "作者二"],
    "journal": "期刊名",
    "year": 2024,
    "doi": "10.xxxx/xxxx",
    "abstract": "摘要",
    "url": "https://...",
    "pdfUrl": "https://...",
    "citationCount": 12
  }
]
```

Example setting:

```json
{ "research": { "cnkiCommand": "cnki-search search \"{query}\" --size {limit} --format json" } }
```

Command arguments are split without a shell, so `{query}` is passed as a single argument and cannot
inject shell syntax.

## Web search and reading

`web_search` uses the [AnySearch](https://www.anysearch.com/docs/api-endpoints/v1-search) v1 search API. It returns titles, URLs, snippets, and extracted
content. Use `web_extract` to read a result (or any public URL) in full, and `web_search_domains`
to discover domain tags such as `code.doc` and their parameters. AnySearch allows anonymous calls
with a lower quota; `research.anySearchApiKey` raises limits.

## Configuring sources with /research

Inside SA run:

```text
/research                 # interactive menu
/research status          # show effective configuration
/research set wanfang-key <APP_KEY>
/research set cnki-command cnki-search search "{query}" --size {limit} --format json
/research set nstl-command nstl-gateway search "{query}" --limit {limit} --json
/research set s2-key <key>
/research set core-key <key>
/research set anysearch-key <key>
/research clear cnki-command
```

In the interactive menu, every API field with a public signup page shows a clickable **↗ API**
link, and `Research configuration` lists the same URLs. Changes apply to the next tool call
without restarting the session. Secrets are stored in `settings.json` in plain text; protect that
file.

## Storage

By default everything lives under `~/.sa/agent/research/`:

- `research.db` — SQLite database with full-text indexes for papers, notes, experiments, and citations
- `cache/papers/` — downloaded PDFs and extracted text
- `work/` — temporary Python scripts and build artifacts

Nothing is uploaded. Deleting this directory resets the research knowledge base.

## System dependencies

SA uses existing command-line tools rather than bundled binaries:

| Capability | Requirement |
|---|---|
| PDF text extraction | `pdftotext` (poppler), `mutool` (MuPDF), or Python with PyMuPDF (`pip install pymupdf`) |
| Python analysis | Python 3 (`python3`, `python`, or `py -3`), or set `research.pythonPath` |
| LaTeX | `latexmk`, `pdflatex`, `xelatex`, or `lualatex`, or set `research.latexCommand` |

When no PDF extractor is available, `paper_read` returns an installation hint and can still return
the abstract. Scanned PDFs without a text layer are not OCRed.

## Settings

Add a `research` block to `settings.json`:

```json
{
  "research": {
    "mailto": "you@example.com",
    "semanticScholarApiKey": "...",
    "ncbiApiKey": "...",
    "coreApiKey": "...",
    "anySearchApiKey": "...",
    "wanfangAppKey": "...",
    "cnkiCommand": "cnki-search search \"{query}\" --size {limit} --format json",
    "nstlCommand": "nstl-gateway search \"{query}\" --limit {limit} --json",
    "databasePath": "~/.sa/agent/research/research.db",
    "cacheDir": "~/.sa/agent/research/cache",
    "workDir": "~/.sa/agent/research/work",
    "pdfCommand": "pdftotext",
    "pythonPath": "python",
    "latexCommand": "latexmk",
    "maxResults": 10,
    "requestTimeoutMs": 30000
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `mailto` | — | Contact address for OpenAlex and PubMed; recommended by both APIs |
| `semanticScholarApiKey` | — | Higher Semantic Scholar rate limits |
| `ncbiApiKey` | — | Higher PubMed rate limits |
| `coreApiKey` | — | CORE API key; enables CORE in default searches and raises limits |
| `anySearchApiKey` | — | AnySearch key for web_search/web_extract; anonymous access has a lower quota |
| `wanfangAppKey` | — | Wanfang open-platform APP_KEY, enables Chinese journal/thesis/conference search |
| `cnkiCommand` | — | Local command that searches CNKI and prints JSON; supports `{query}` and `{limit}` |
| `nstlCommand` | — | Institutional NSTL gateway command that prints JSON; supports `{query}` and `{limit}` |
| `databasePath` | `~/.sa/agent/research/research.db` | SQLite knowledge base |
| `cacheDir` | `~/.sa/agent/research/cache` | Downloaded PDFs and extracted text |
| `workDir` | `~/.sa/agent/research/work` | Temporary scripts and generated files |
| `pdfCommand` | auto-detect | `pdftotext`, `mutool`, or a Python executable with PyMuPDF |
| `pythonPath` | auto-detect | Python executable for `python_run` |
| `latexCommand` | auto-detect | LaTeX engine or executable for `latex_build` |
| `maxResults` | `10` | Default result count for searches and lookups |
| `requestTimeoutMs` | `30000` | Timeout for each research HTTP request |

Network requests use SA's configured HTTP proxy (`httpProxy` setting or `HTTPS_PROXY`).

## Limitations

- Paywalled papers without an open-access PDF cannot be read automatically; use `mode: "abstract"`
  or provide a local PDF path.
- Semantic Scholar and PubMed rate-limit unauthenticated requests. Configure their API keys for
  heavier use.
- Wanfang requires an APP_KEY and may require an institutional subscription for full text.
- CNKI has no public API. SA does not bypass its access controls; configure an authorized local
  command or use Wanfang/international databases.
- NSTL search requires an approved institutional Web Service account; there is no public endpoint.
- `paper_read` tries Unpaywall first when `research.mailto` is set, then OpenAlex, to find an
  open-access PDF for a DOI.
- AnySearch anonymous calls share a per-IP daily quota; configure a key for heavier web use.
- CORE is included in default searches only when a CORE API key is configured.
- HAL is queried by default but is often unreachable from mainland China; failures are reported as
  source errors while other sources continue.
- Citation metadata comes from the provider APIs. Check entries that matter before submission; SA
  never invents missing fields.
