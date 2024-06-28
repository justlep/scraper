import {URL} from 'node:url';

const UNSUPPORTED_FILENAMES_REGEX = /\.(jpe?g|png|gif.?|mp.|avi|web.)$/i;
const HTTP_OR_HTTPS_URL_REGEX = /^https?:\/\/.*/;
const DEFAULT_USER_AGENT = 'node.js';
const DEFAULT_CHUNK_BUFFER_SIZE = 6000;

/**
 * @param {string} urlString
 * @return {URL} - the url instance if valid
 * @throws {Error} if invalid, unsupported or malicious
 */
const _assertValidUrl = urlString => {
    let url;
    try {
        url = typeof urlString === 'string'
            && HTTP_OR_HTTPS_URL_REGEX.test(urlString)
            && !UNSUPPORTED_FILENAMES_REGEX.test(urlString)
            && new URL(urlString);
    } catch (err) {
        // just ignore here
    }
    if (!url) {
        throw new Error('Invalid url');
    }
    return url;
};

/**
 * Options to be passed to {@link loadPageAsHtml} and {@link loadPageAsCheerio}.
 */
export class ScraperOpts {
    #totalRedirects = 0
    chunkBufferSize = DEFAULT_CHUNK_BUFFER_SIZE;
    timeout = 5000;
    /** @type {?string} */
    startToken = null;
    isStartTokenIncluded = true;
    /** @type {?string} */
    stopToken = null;
    isStopTokenIncluded = false;
    /** @type {?ScraperOptsTransformFn} */
    transform = null;
    compact = false
    /**
     * The number of bytes returned by the Scraper (0 meaning scraper decides).
     * @type {number}
     */
    maxBytes = 0;
    restrictRequestFrequency = true
    maxRedirects = 0;
    userAgent = DEFAULT_USER_AGENT;
    /** @type {?string} */
    headers = null;
    /**
     * @type {ScraperTimings}
     */
    #timings = {
        load: 0,
        transform: 0,
        toDom: 0,
        scrape: 0
    };

    /**
     * @param {string} url
     */
    constructor(url) {
        /** @type {URL} */
        this.url = _assertValidUrl(url);
    }

    startMeasureLoad() {
        this._load = Date.now();
    }
    stopMeasureLoad() {
        this.#timings.load = Date.now() - this._load || 0;
        return this;
    }
    startMeasureTransform() {
        this._transform = Date.now();
    }
    stopMeasureTransform() {
        this.#timings.transform = Date.now() - this._transform || 0;
        return this;
    }
    startMeasureToDom() {
        this._toDom = Date.now();
    }
    stopMeasureToDom() {
        this.#timings.toDom = Date.now() - this._toDom || 0;
        return this;
    }
    startMeasureScrape() {
        this._scrape = Date.now();
    }
    stopMeasureScrape() {
        this.#timings.scrape = Date.now() - this._scrape || 0;
        return this;
    }

    /**
     * @param {ScraperOptsTransformFn} fn
     * @return {ScraperOpts}
     */
    withTransform(fn) {
        if (typeof fn !== 'function') {
            throw new Error('Invalid transform function');
        }
        this.transform = fn;
        return this;
    }

    /**
     * @param {?string} s
     * @param {boolean} [included] - if true, the start token will be part of the response
     * @return {ScraperOpts}
     */
    withStartToken(s, included) {
        this.startToken = s || null;
        this.isStartTokenIncluded = !!included;
        return this;
    }

    /**
     * @param {?string} s
     * @return {ScraperOpts}
     */
    withHeaders(s) {
        this.headers = (typeof s === 'string') && s || null;
        return this;
    }

    /**
     * @param {string} s
     * @param {boolean} [included=false] - if true, the stop token will be part of the response (default = false)
     * @return {ScraperOpts}
     */
    withStopToken(s, included) {
        this.stopToken = '' + (s || '');
        this.isStopTokenIncluded = !!included;
        return this;
    }

    /**
     * @param {boolean} compact
     */
    withCompact(compact) {
        this.compact = !!compact;
        return this;
    }

    /**
     * @param {boolean} restrict
     * @return {ScraperOpts}
     */
    withRequestFrequencyRestriction(restrict) {
        this.restrictRequestFrequency = !!restrict;
        return this;
    }

    /**
     * @param {number} max - 0 means Scraper's (large) default value
     * @return {ScraperOpts}
     */
    withMaxBytes(max) {
        if (typeof max !== 'number' || max < 0 || max > 10000000) {
            throw new Error('Illegal value for max: ' + max);
        }
        this.maxBytes = max;
        return this;
    }

    /**
     * @param {number} max
     * @returns {ScraperOpts}
     */
    withMaxRedirects(max) {
        if (typeof max !== 'number' || max <= 0 || max >= 5) {
            throw new Error('Illegal value for maxRedirects: ' + max);
        }
        this.maxRedirects = max;
        return this;
    }

    /**
     * @param {number} timeout
     * @return {ScraperOpts}
     */
    withTimeoutInMillis(timeout) {
        if (isNaN(timeout) || timeout < 2) {
            throw new Error('Invalid timeout value: ' + timeout);
        }
        this.timeout = timeout;
        return this;
    }

    /**
     * Sets the number of bytes the scraper should buffer before looking for a startToken or stopToken.
     * The scraper may use a larger buffer size though, matching at least the start/stop token size.
     * @param {number} size
     * @return {ScraperOpts}
     */
    withChunkBufferSize(size) {
        if (isNaN(size) || size < 0) {
            throw new Error('Invalid chunk buffer size: ' + size);
        }
        this.chunkBufferSize = size;
        return this;
    }

    /**
     * @param {string} agent
     * @return {ScraperOpts}
     */
    withUserAgent(agent) {
        if (agent && typeof agent !== 'string') {
            throw new Error('Invalid user agent');
        }
        this.userAgent = agent || null;
        return this;
    }

    /**
     * @param {string} redirectUrl
     */
    updateForRedirect(redirectUrl) {
        if (this.#totalRedirects >= this.maxRedirects) {
            throw new Error(`Redirect limit exceeded (${this.maxRedirects})`);
        }
        this.url = _assertValidUrl((redirectUrl.startsWith('/') ? this.url.origin : '') + redirectUrl);
        this.#totalRedirects++;
    }

    /**
     * @return {boolean} - true if the opts have been previously updated to follow a redirect,
     */
    isRedirect() {
        return !!this.#totalRedirects;
    }

    /**
     * @return {ScraperTimings}
     */
    getTimings() {
        return {
            ...this.#timings
        };
    }
}


/**
 * @typedef {Function} ScraperOptsTransformFn
 * @param {string} html
 * @return {string} transformed html
 */

/**
 * @typedef {Object} ScraperTimings
 * @property {number} load
 * @property {number} transform
 * @property {number} toDom
 * @property {number} scrape
 */
