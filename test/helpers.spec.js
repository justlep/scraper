import {describe, it, expect} from 'vitest';
import {isYoutubeUrl, parseWgetHeadersInto} from '../lib/helpers.js';

describe('helpers', () => {

    it('can identify youtube urls', () => {
        expect(isYoutubeUrl(null)).toBe(false);
        expect(isYoutubeUrl(undefined)).toBe(false);
        expect(isYoutubeUrl('http://foo.bar')).toBe(false);
        expect(isYoutubeUrl('https://foo.bar')).toBe(false);
        expect(isYoutubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
        expect(isYoutubeUrl('https://youtube.com/watch?v=abc123')).toBe(true);
        expect(isYoutubeUrl('https://youtu.be/abc123')).toBe(true);
        expect(isYoutubeUrl('http://youtu.be/abc123')).toBe(true);
    });

    it('can parse custom headers into an object', () => {
        expect(parseWgetHeadersInto({}, 'x-foo: 123 \nx-bar: abc   \n x-baz: 666\nx-go:now')).toEqual({'x-foo': '123', 'x-bar': 'abc', 'x-baz': '666', 'x-go': 'now'});
        expect(parseWgetHeadersInto({}, 'x-foo  : 123')).toEqual({'x-foo': '123'});
        expect(parseWgetHeadersInto({}, 'x-foo  :     123')).toEqual({'x-foo': '123'});
        expect(parseWgetHeadersInto({}, 'x-foo  :     123    ')).toEqual({'x-foo': '123'});
        expect(parseWgetHeadersInto({}, 'x-foo  :123    ')).toEqual({'x-foo': '123'});
        expect(parseWgetHeadersInto({}, ' x-foo  :123    ')).toEqual({'x-foo': '123'});
        expect(() => parseWgetHeadersInto({}, 'baz: 666')).toThrow('Invalid header line: "baz: 666"');
        expect(() => parseWgetHeadersInto({}, 'x-foo: 123 \nx-bar: abc   \n baz: 666\nx-go:now')).toThrow('Invalid header line: "baz: 666"');
    });
});
