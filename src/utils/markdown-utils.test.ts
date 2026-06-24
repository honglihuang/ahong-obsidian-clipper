import { describe, expect, test } from 'vitest';
import { normalizeMarkdownImageLinks } from './markdown-utils';

describe('normalizeMarkdownImageLinks', () => {
	test('unwraps image links that point to the same image URL', () => {
		const url = 'https://cdn3.ldstatic.com/original/4X/7/b/a/hash.jpeg';

		expect(normalizeMarkdownImageLinks(`[![4](${url})](${url} "4")`))
			.toBe(`![4](${url})`);
	});

	test('keeps image links that point somewhere else', () => {
		const markdown = '[![preview](https://example.com/thumb.jpg)](https://example.com/page)';

		expect(normalizeMarkdownImageLinks(markdown)).toBe(markdown);
	});
});
