import {it, describe, expect, beforeAll, afterAll} from 'vitest';
import nock from 'nock';
import {lookupPageTitle, loadPageAsHtml, loadPageAsCheerio} from '../index.js';
import {ScraperOpts} from '../index.js';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT_PATH = resolve(fileURLToPath(import.meta.url), '../../');
export const resolveProjectPath = (relPath) => relPath ? join(PROJECT_ROOT_PATH, relPath) : PROJECT_ROOT_PATH;

const TEST1_URL = 'http://foo-bar.nil/test1';
const TEST1_HTML = readFileSync(resolveProjectPath('test/html/scraper-test.html')).toString();

const TEST2_URL = 'http://foo-bar.nil/test2';
const TEST2_HTML = readFileSync(resolveProjectPath('test/html/list.html')).toString();

// see https://hackerone.com/reports/678487
const MALICIOUS_HOSTNAME_SPOOFING_URL = 'http://evil.c℀.victim.test/foo/bar?';

describe('scraper', () => {

    beforeAll(() => {
        for (const [url, html] of [[TEST1_URL, TEST1_HTML], [TEST2_URL, TEST2_HTML]]) {
            let {origin, pathname} = new URL(url);
            nock(origin)
                .persist()
                .defaultReplyHeaders({
                    'Content-Type': 'text/html'
                })
                .get(pathname)
                .reply(200, html);
        }
    });

    afterAll(() => {
        nock.cleanAll();
    });

    it('should retrieve html fragments specified by a start/stop-tokens', async () => {

        const START_TOKEN = '<div id="page-body"',
              STOP_TOKEN = '<div class="action-bar actions-jump">', //'<form method="post" id="jumpbox" action="',
              opts = new ScraperOpts(TEST1_URL)
                  .withStartToken(START_TOKEN, true)
                  .withStopToken(STOP_TOKEN, false)
                  .withRequestFrequencyRestriction(false);

        let html = await loadPageAsHtml(opts);

        expect(typeof html).toBe('string');
        //console.log('html length -> ' + html.length);
        expect(html.startsWith(START_TOKEN)).toBe(true);
        expect(html.includes(STOP_TOKEN)).toBe(false);
        expect(html).toMatchSnapshot();

        const STRING_AFTER_START_TOKEN = html.substr(START_TOKEN.length, 3000);
        const STRING_BEFORE_STOP_TOKEN = html.substr(-3000);

        // different include/exclude start/stop token variants..

        opts.withStartToken(START_TOKEN, false);
        opts.withStopToken(STOP_TOKEN, false);
        html = await loadPageAsHtml(opts);
        expect(html.startsWith(STRING_AFTER_START_TOKEN)).toBe(true);
        expect(html.endsWith(STRING_BEFORE_STOP_TOKEN)).toBe(true);

        opts.withStartToken(START_TOKEN, false);
        opts.withStopToken(STOP_TOKEN, true);
        html = await loadPageAsHtml(opts);
        expect(html.startsWith(STRING_AFTER_START_TOKEN)).toBe(true);
        expect(html.endsWith(STRING_BEFORE_STOP_TOKEN + STOP_TOKEN)).toBe(true);

        opts.withStartToken(START_TOKEN, true);
        opts.withStopToken(STOP_TOKEN, true);
        html = await loadPageAsHtml(opts);
        expect(html.startsWith(START_TOKEN + STRING_AFTER_START_TOKEN)).toBe(true);
        expect(html.endsWith(STRING_BEFORE_STOP_TOKEN + STOP_TOKEN)).toBe(true);

        // test limit (expect the end tag to be truncated if needed)

        const THIRD_STOP_TOKEN = STOP_TOKEN.substr(0, Math.floor(STOP_TOKEN.length / 3));
        const maxBytes = html.length - (STOP_TOKEN.length - THIRD_STOP_TOKEN.length);
        opts.withMaxBytes(maxBytes);
        html = await loadPageAsHtml(opts);
        expect(html.startsWith(START_TOKEN + STRING_AFTER_START_TOKEN)).toBe(true);
        expect(html.endsWith(STRING_BEFORE_STOP_TOKEN + STOP_TOKEN)).toBe(false);
        expect(html.endsWith(STRING_BEFORE_STOP_TOKEN + THIRD_STOP_TOKEN)).toBe(true);

        opts.withMaxBytes(5);
        html = await loadPageAsHtml(opts);
        expect(html).toBe(START_TOKEN.substr(0, 5));

        opts.withMaxBytes(100).withStartToken(START_TOKEN, false);
        html = await loadPageAsHtml(opts);
        expect(html).toBe(STRING_AFTER_START_TOKEN.substr(0, 100));
    });

    it('should retrieve html fragments specified by a start/stop-tokens AND final transform', async () => {

        const START_TOKEN = '<div id="page-body"',
              STOP_TOKEN = '<div class="action-bar actions-jump">',
              opts = new ScraperOpts(TEST1_URL)
                  .withStartToken(START_TOKEN, true)
                  .withStopToken(STOP_TOKEN)
                  .withCompact(true)
                  .withRequestFrequencyRestriction(false);

        let html = await loadPageAsHtml(opts);

        expect(typeof html).toBe('string');
        //console.log('transformed html length -> ' + html.length);
        expect(html.startsWith(START_TOKEN)).toBe(true);
        expect(html.includes(STOP_TOKEN)).toBe(false);
        expect(html).toMatchSnapshot();
    });

    it('should determine page titles', async () => {
        let title = await lookupPageTitle(TEST1_URL);

        expect(typeof title).toBe('string');
        expect(title.includes('</title>')).toBe(false);
        expect(title).toMatchSnapshot();
    });

    it('should reject page title lookups for malicious hostname-spoofing urls', () => {
        expect(() => lookupPageTitle(MALICIOUS_HOSTNAME_SPOOFING_URL)).rejects.toThrow('Invalid url');
    });

    it('can parse an html file into a cheerio object', async () => {
        const opts = new ScraperOpts(TEST2_URL)
            .withCompact(true)
            .withRequestFrequencyRestriction(false)
            .withStartToken('</head>', false);

        const $ = await loadPageAsCheerio(opts);

        expect(typeof $.root).toBe('function');
        expect($.root().html().startsWith('<body>')).toBe(true);
        opts.startMeasureScrape();

        let lis = [...$('li')];
        expect(lis.length).toBe(3);
        expect($(lis[0]).text().trim()).toBe('foo');
        expect(lis[0].tagName).toBe('li');
        expect($(lis[1]).text().trim()).toBe('bar');
        expect($(lis[2]).text().trim()).toBe('baz');

        expect($.root()[0].firstChild.tagName).toBe('body');

        opts.stopMeasureScrape();

        let timings = opts.getTimings();
        expect(timings.load).toBeGreaterThanOrEqual(0);
        expect(timings.transform).toBeGreaterThanOrEqual(0);
        expect(timings.scrape).toBeGreaterThanOrEqual(0);
        expect(timings.toDom).toBeGreaterThanOrEqual(0);

        opts.withCompact(false)
            .withStartToken(null);

        const $$ = await loadPageAsCheerio(opts);
        expect($$.root().html().startsWith('<!DOCTYPE')).toBe(true);
        expect($('a')[0].attribs.href).toBe('#foo');
    });
});
