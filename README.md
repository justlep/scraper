# @justlep/scraper
A simple scraping helper for HTML web pages,
including markup pre-sanitization / compacting.

Facilitates content scraping by retrieving a website either as raw HTML or parsed as a 
 [cheerio](https://github.com/cheeriojs/cheerio) object, 
allowing for CSS-like content queries. 
Optional start/stop tokens may help reducing memory & CPU usage by processing only relevant HTML fragments in the first place. 
`scraper` can determine page titles, too.

Based on 
* [Cheerio](https://github.com/cheeriojs/cheerio)
* [htmlparser2](https://github.com/fb55/htmlparser2/) 
  (provides fast, reliable parsing even when removing portions of the HTML before processing in order to speed up parsing)


### Usage:

```javascript
import {
  loadPageAsHtml,
  loadPageAsCheerio, 
  lookupPageTitle} from '@justlep/scraper';

const URL = 'https://foo.bar/baz.html';

const opts = new ScraperOpts(URL)
  .withStartToken('<body', true) // return html starting with & including the "<body" html part   
  .withStopToken('<footer', false) // don't return anything beyond the first footer tag
  .withRequestFrequencyRestriction(false) // don't rate-limit requests to this domain (default is 1 request per 3 sec)
  .withCompact(true) // remove multi-whitespaces and line breaks
  .withUserAgent('Chrome 123')
  .withMaxRedirects(2)
  .withChunkBufferSize(6_000)
  .withHeaders(`
      Cookie: name=value
      X-Token: sometoken
  `)
  .withMaxBytes(2_000_000) // load pages up to 2m only
  .withTimeoutInMillis(5_000)
  .withTransform(s => /class="[^"]+"/g, ''); // remove class attributes for faster parsing

// -------------------------
const html = await loadPageAsHtml(opts);
html.startsWith('<body'); // true

// -------------------------
const $ = await loadPageAsCheerio(opts);
opts.startMeasureScrape();
$.root()[0].firstChild.tagName === 'body'; // true
$('a')[0].attribs.href === '/first/link/url'; // true
opts.stopMeasureScrape();

opts.getTimings(); // {"load": 25, "transform": 0, "toDom": 2, "scrape": 2} 

// -------------------------
let title = await lookupPageTitle('https://github.com/');
title === 'GitHub: Let’s build from here · GitHub'; // true

```

### Limitations / Known issues
* UTF-8 encoding only (assumed fine for 95% of pages)
* using `ScraperOpts.withMaxBytes(x)` may cause a corrupt trailing multibyte char

### Bugs/Issues

[Please report here](https://github.com/justlep/scraper/issues)

## License
[MIT](./LICENSE)
