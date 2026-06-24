// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { captureScrollableDocument } from './scroll-capture';

function setPage(html: string) {
	document.body.innerHTML = html;
}

describe('captureScrollableDocument', () => {
	test('keeps blocks that were visible before virtual scrolling unloads them', async () => {
		let y = 0;
		const render = () => {
			const post = y < 100
				? ['1', 'First virtual post']
				: y < 200
					? ['2', 'Second virtual post']
					: ['3', 'Third virtual post'];
			setPage(`<main><article data-post-id="${post[0]}"><p>${post[1]}</p></article></main>`);
			document.querySelector('article')!.getBoundingClientRect = () => ({
				top: 0,
				bottom: 80,
				left: 0,
				right: 800,
				width: 800,
				height: 80,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			});
		};

		render();
		const captured = await captureScrollableDocument(document, {
			maxSteps: 5,
			settleMs: 0,
			getScrollState: () => ({ scrollY: y, scrollHeight: 300, viewportHeight: 100 }),
			scrollTo: async (_x, nextY) => {
				y = nextY;
				render();
			},
		});

		expect(captured.body.textContent).toContain('First virtual post');
		expect(captured.body.textContent).toContain('Second virtual post');
		expect(captured.body.textContent).toContain('Third virtual post');
	});

	test('deduplicates overlapping blocks captured on adjacent scroll positions', async () => {
		let y = 0;
		const render = () => {
			const posts = y < 100
				? [['1', 'First post'], ['2', 'Shared post']]
				: [['2', 'Shared post'], ['3', 'Third post']];
			setPage(`<main>${posts.map(([id, text]) => `<article data-post-id="${id}"><p>${text}</p></article>`).join('')}</main>`);
			document.querySelectorAll('article').forEach((article, index) => {
				article.getBoundingClientRect = () => ({
					top: index * 80,
					bottom: index * 80 + 70,
					left: 0,
					right: 800,
					width: 800,
					height: 70,
					x: 0,
					y: index * 80,
					toJSON: () => ({}),
				});
			});
		};

		render();
		const captured = await captureScrollableDocument(document, {
			maxSteps: 3,
			settleMs: 0,
			getScrollState: () => ({ scrollY: y, scrollHeight: 200, viewportHeight: 100 }),
			scrollTo: async (_x, nextY) => {
				y = nextY;
				render();
			},
		});

		const text = captured.body.textContent || '';
		expect(text.match(/Shared post/g)).toHaveLength(1);
		expect(captured.querySelectorAll('article')).toHaveLength(3);
	});

	test('materializes common lazy image attributes on captured clones', async () => {
		setPage('<main><article><p>Image post</p><img data-src="https://example.com/image.jpg"></article></main>');
		document.querySelector('article')!.getBoundingClientRect = () => ({
			top: 0,
			bottom: 100,
			left: 0,
			right: 800,
			width: 800,
			height: 100,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});

		const captured = await captureScrollableDocument(document, {
			maxSteps: 1,
			settleMs: 0,
			getScrollState: () => ({ scrollY: 0, scrollHeight: 100, viewportHeight: 100 }),
			scrollTo: async () => {},
		});

		expect(captured.querySelector('img')?.getAttribute('src')).toBe('https://example.com/image.jpg');
	});
});
