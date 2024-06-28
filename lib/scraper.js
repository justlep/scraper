import {ScraperOpts} from './ScraperOpts.js';
import http from 'node:http';
import https from 'node:https';
import * as cheerio from 'cheerio';
import {decodeHTML} from 'entities';
import {isYoutubeUrl, parseWgetHeadersInto} from './helpers.js';

const CONTENT_TYPE_HTML_REGEX = /text\/x?html/i;

const MAXIMUM_REQUEST_FREQUENCY_PER_HOST_IN_MILLIS = 3000;

/** @type {Map<string, number>} */
const nextAllowedRequestTimeByHostname = new Map();

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MiB websites should be more than enough

const LOG_DEBUG = false;

/**
 * Checks if a new request to a given hostname is allowed
 * (i.e. that the minimum time since the last request is elapsed, {@link MAXIMUM_REQUEST_FREQUENCY_PER_HOST_IN_MILLIS}}).
 * If the request is ok, the new request is considered to take place and the time for the next allowed
 * request time to the host is updated.
 * @param {string} host
 * @returns {boolean} true if the request is allowed, false if too many requests in short time
 */
function validateRequestToHostFrequency(host) {
    let now = Date.now(),
        nextAllowedTime = nextAllowedRequestTimeByHostname.get(host) || now,
        isAllowed = nextAllowedTime <= now;

    if (isAllowed) {
        nextAllowedRequestTimeByHostname.set(host, now + MAXIMUM_REQUEST_FREQUENCY_PER_HOST_IN_MILLIS);
    }

    // cleanup old ones..
    for (let host of [...nextAllowedRequestTimeByHostname.keys()]) {
        if (nextAllowedRequestTimeByHostname.get(host) < now) {
            // auto-cleanup
            // console.log(`Requests to ${host} are allowed again`);
            nextAllowedRequestTimeByHostname.delete(host);
        }
    }

    return isAllowed;
}

/**
 * Requests an HTML page.
 * Does follow redirects up to the limit specified in {@link ScraperOpts#maxRedirects}
 * @param {ScraperOpts} opts
 * @returns {Promise<string>} - resolves with the page's HTML content according to given opts, rejects otherwise
 * @private
 */
const _requestHtml = (opts) => new Promise((resolve, reject) => {
    const parsedUrl = opts.url,
        headers = Object.create(null),
        requestOpts = {
            method: 'GET',
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            timeout: opts.timeout,
            headers
        };

    if (!opts.isRedirect() && opts.restrictRequestFrequency && !validateRequestToHostFrequency(requestOpts.hostname)) {
        reject('Too frequent requests'); // let's not disclose requestOpts.hostname to the logs here
    }

    if (opts.userAgent) {
        headers['User-Agent'] = opts.userAgent;
    }

    if (opts.headers) {
        parseWgetHeadersInto(headers, opts.headers);
    }

    const httpOrHttps = parsedUrl.protocol === 'https:' ? https : http;

    let _isRequestDestroyed = false,
        _destroyRequest = () => {
            if (!_isRequestDestroyed) {
                _isRequestDestroyed = true;
                _request.destroy();
            }
        },
        _request;

    _request = httpOrHttps.request(requestOpts, res => {
        res.setEncoding('utf8'); // brute-force here, it's 2021

        // (1) ensure this is an HTML page and no redirect

        let redirectUrl = res.headers['location'];
        if (redirectUrl) {
            try {
                res.destroy();
                opts.updateForRedirect(redirectUrl);
            } catch (err) {
                return reject('' + err);
            }
            // recurse with next redirect
            return resolve(_requestHtml(opts));
        }

        let contentType = res.headers['content-type'] || '';
        if (!CONTENT_TYPE_HTML_REGEX.test(contentType)) {
            _destroyRequest();
            reject(`Unsupported content type "${contentType}" for url "${parsedUrl.href}"`);
        }

        // (2) process incoming response data...

        const startToken = opts.startToken || '';
        const startTokenLength = startToken.length;
        const stopToken = opts.stopToken || '';
        const stopTokenLength = stopToken.length;
        const chunkBufferSize = Math.max(opts.chunkBufferSize, startTokenLength, stopTokenLength);
        const maxHtmlSize = opts.maxBytes || DEFAULT_MAX_SIZE;

        let isStartTokenFound = !startToken,
            minStopTokenIndexInAllHtml = 0,
            bufferedData = '',
            retHtml = '',
            /** @type {function(string,boolean):void} */
            _processChunk;

        // let totalChunks = 0,
        //     totalChunkSize = 0,
        //     totalProcessedBufferedChunks = 0;

        if (startToken || stopToken) {

            _processChunk = (chunkData, forceProcessing) => {
                if (_isRequestDestroyed && !bufferedData) {
                    return;
                }

                // totalChunks++;
                // totalChunkSize += (bufferedData ? chunkData.length : 0);

                bufferedData += chunkData;
                if (bufferedData.length < chunkBufferSize && forceProcessing !== true) {
                    // console.log('buffering (%s/%s), added chunk size: %s', bufferedData.length, chunkBufferSize, chunkData.length);
                    return;
                }

                // console.log('processing chunk (%s bytes), startsWith: %s', bufferedData.length, bufferedData.substr(0, 10));
                // totalProcessedBufferedChunks++;

                if (!isStartTokenFound) {
                    let startTokenIndex = bufferedData.indexOf(startToken);
                    if (startTokenIndex >= 0) {
                        bufferedData = bufferedData.substring(startTokenIndex + startTokenLength);
                        if (opts.isStartTokenIncluded) {
                            retHtml = startToken;
                            minStopTokenIndexInAllHtml = startTokenLength;
                        }
                        isStartTokenFound = true;
                    } else {
                        bufferedData = bufferedData.substr(1 - startTokenLength);
                        return;
                    }
                }

                retHtml += bufferedData;
                bufferedData = '';

                if (stopToken) {
                    let stopTokenIndex = retHtml.indexOf(stopToken, minStopTokenIndexInAllHtml);
                    if (stopTokenIndex >= 0) {
                        let endOffset = opts.isStopTokenIncluded ? stopTokenLength : 0;
                        retHtml = retHtml.substring(0, Math.min(stopTokenIndex + endOffset, maxHtmlSize));
                        return _destroyRequest();
                    }
                    minStopTokenIndexInAllHtml = retHtml.length - stopTokenLength;
                }

                if (retHtml.length < maxHtmlSize) {
                    return;
                }
                if (retHtml.length > maxHtmlSize) {
                    retHtml = retHtml.substring(0, maxHtmlSize);
                }
                _destroyRequest();
            };

        } else {
            let remainingChars = maxHtmlSize;

            _processChunk = (chunkData) => {
                if (_isRequestDestroyed) {
                    return;
                }
                remainingChars -= chunkData.length;
                if (remainingChars <= 0) {
                    retHtml = chunkData.substring(0, -remainingChars);
                    _destroyRequest();
                    return;
                }
                retHtml += chunkData;
            };
        }

        const _doResolve = () => {
            if (resolve) {
                if (bufferedData) {
                    _processChunk('', true);
                }

                // removing the handlers should be unnecessary, but hey..
                res.off('data', _processChunk);
                res.off('close', _doResolve);
                res.off('end', _doResolve);

                setImmediate(resolve, retHtml);
                resolve = undefined;
                // console.log('totalChunks: %s, totalChunkSize: %s, totalProcessedBufferedChunks: %s',
                //                  totalChunks, totalChunkSize, totalProcessedBufferedChunks);
            }
        };

        res.on('data', _processChunk);
        res.once('close', _doResolve);
        res.once('end', _doResolve);

        // There is NO 'error' event in Node http.Response
    });

    _request.once('error', e => {
        resolve = undefined;
        reject('scraper request failed, reason: ' + e);
    });

    _request.once('timeout', () => _request.abort());

    _request.end();
});

/**
 * @param {ScraperOpts} opts
 * @return {Promise<cheerio.Root>}
 */
export async function loadPageAsCheerio(opts) {
    const html = await loadPageAsHtml(opts);
    opts.startMeasureToDom();
    const $ = cheerio.load(html.indexOf('<body') < 0 ? '<body>' + html : html, {
        decodeEntities: true,
        _useHtmlParser2: true
    })
    opts.stopMeasureToDom();
    return $;
}

/**
 * @param {ScraperOpts} opts
 * @returns {Promise<string>} resolves with either the HTML or a Cheerio instance, depending on the given opts; {null} on error
 */
export async function loadPageAsHtml(opts) {
    if (!(opts instanceof ScraperOpts)) {
        throw new Error('Invalid ScraperOpts');
    }

    opts.startMeasureLoad();

    const pageHtml = await _requestHtml(opts);

    opts.stopMeasureLoad().startMeasureTransform();

    // TODO multi-space to '' is radical, but saves millis compared to ' ' during parsing. Maybe reconsider later
    let sanitizedHtml = opts.compact ? pageHtml.replace(/\n|\r|\s{2,}/g, '') : pageHtml;

    if (opts.transform) {
        sanitizedHtml = opts.transform(sanitizedHtml);
    }

    opts.stopMeasureTransform();

    return sanitizedHtml;
}

const TITLE_CONTENT_REGEX = /^<title[^>]*?>([^<]*)/im;
const _extractTitleContent = s => TITLE_CONTENT_REGEX.test(s) ? RegExp.$1.trim() : '';

/**
 * Determines the page title of a given URL.
 * @param {string} url - the url to determine the title for
 * @param {boolean} [skipRequestFrequencyRestriction]
 * @return {Promise<string|null>} resolved with the title, otherwise error
 */
export async function lookupPageTitle(url, skipRequestFrequencyRestriction) {
    LOG_DEBUG && console.log('lookupPageTitle("%s")', url);

    const opts = new ScraperOpts(url)
            .withStartToken('<title', true)
            .withStopToken('</title>', false)
            .withCompact(true)
            .withMaxRedirects(3)
            .withTimeoutInMillis(4000)
            .withMaxBytes(isYoutubeUrl(url) ? 600000 : 25000)
            .withTransform(_extractTitleContent)
            .withRequestFrequencyRestriction(!skipRequestFrequencyRestriction);

    const title = decodeHTML(await loadPageAsHtml(opts) || '').trim();

    LOG_DEBUG && console.log('Title for "%s" determined with timings %o', url, opts.getTimings());

    return title;
}
