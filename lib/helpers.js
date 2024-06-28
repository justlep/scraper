
export const YOUTUBE_URL_REGEX = /^https?:\/\/(?:youtu\.be\/|(www\.)?youtube\.com\/(watch|shorts))/i;

/**
 * @param {?string} url
 * @return {boolean}
 */
export const isYoutubeUrl = url => url ? YOUTUBE_URL_REGEX.test(url) : false;

const HTTP_HEADER_LINE_REGEX = /^\s*(Cookie|Authorization|Accept|[a-z0-9]+?-[a-z0-9-]+?)\s*:\s*([^"]+?)\s*$/i;

/**
 * @param {Object} target - parsed headers will be set in this given object;
 * @param {string} headersStr - (!) header names except "Cookie" MUST contain a dash ("-"); n
 * @return {Object} target - the trimmed(!) header names and values
 */
export const parseWgetHeadersInto = (target, headersStr) => {
    if (!headersStr || typeof headersStr !== 'string') {
        return target;
    }
    for (let line of headersStr.replaceAll('\r', '').split('\n').map(s => s.trim())) {
        if (!line) {
            continue;
        }
        if (!HTTP_HEADER_LINE_REGEX.test(line)) {
            throw new Error('Invalid header line: "' + line + '"');
        }
        target[RegExp.$1] = RegExp.$2;
    }
    return target;
};
