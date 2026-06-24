// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import Defuddle from 'defuddle';
import { createMarkdownContent } from 'defuddle/full';
import { captureContentSystemDocument } from './content-system-capture';

describe('captureContentSystemDocument', () => {
	test('builds a complete Discourse topic document from same-origin post stream JSON', async () => {
		document.head.innerHTML = '<meta name="generator" content="Discourse 2026.6.0">';
		document.body.innerHTML = '<main><article data-post-id="101">Current DOM only has one post</article></main>';

		const fetchJson = async (url: string) => {
			if (url === 'https://forum.example/t/123.json') {
				return {
					id: 123,
					title: 'Complete topic',
					post_stream: {
						stream: [101, 102, 103],
						posts: [
							{
								id: 101,
								username: 'alice',
								name: 'Alice',
								created_at: '2026-01-01T00:00:00.000Z',
								cooked: '<p>First post</p>',
								post_number: 1,
								post_url: '/t/topic/123/1',
							},
						],
					},
				};
			}

			if (url === 'https://forum.example/t/123/posts.json?post_ids%5B%5D=102&post_ids%5B%5D=103') {
				return {
					post_stream: {
						posts: [
							{
								id: 102,
								username: 'bob',
								name: 'Bob',
								created_at: '2026-01-02T00:00:00.000Z',
								cooked: '<p>Second post</p>',
								post_number: 2,
								post_url: '/t/topic/123/2',
							},
							{
								id: 103,
								username: 'carol',
								name: 'Carol',
								created_at: '2026-01-03T00:00:00.000Z',
								cooked: '<p>Third post</p>',
								post_number: 3,
								post_url: '/t/topic/123/3',
							},
						],
					},
				};
			}

			throw new Error(`Unexpected URL: ${url}`);
		};

		const captured = await captureContentSystemDocument(document, {
			url: 'https://forum.example/t/topic/123/82',
			fetchJson,
		});

		expect(captured).not.toBeNull();
		expect(captured!.title).toBe('Complete topic');
		expect(captured!.body.textContent).toContain('First post');
		expect(captured!.body.textContent).toContain('Second post');
		expect(captured!.body.textContent).toContain('Third post');
		expect(captured!.querySelectorAll('[data-post-id]')).toHaveLength(3);
	});

	test('renders Discourse posts with readable Markdown boundaries', async () => {
		document.head.innerHTML = '<meta name="generator" content="Discourse 2026.6.0">';
		document.body.innerHTML = '<main><article data-post-id="101">Current DOM only has one post</article></main>';

		const fetchJson = async () => ({
			id: 123,
			title: 'Readable topic',
			post_stream: {
				stream: [101, 102],
				posts: [
					{
						id: 101,
						username: 'alice',
						name: 'Alice',
						created_at: '2026-01-01T00:00:00.000Z',
						cooked: '<p>First post</p>',
						post_number: 1,
						post_url: '/t/topic/123/1',
					},
					{
						id: 102,
						username: 'bob',
						name: 'Bob',
						created_at: '2026-01-02T00:00:00.000Z',
						cooked: '<p>Second post</p>',
						post_number: 2,
						post_url: '/t/topic/123/2',
					},
				],
			},
		});

		const captured = await captureContentSystemDocument(document, {
			url: 'https://forum.example/t/topic/123',
			fetchJson,
		});
		const defuddled = new Defuddle(captured!, { url: 'https://forum.example/t/topic/123' }).parse();
		const markdown = createMarkdownContent(defuddled.content, 'https://forum.example/t/topic/123');

		expect(markdown).toContain('## Post #1 - Alice (@alice)');
		expect(markdown).toContain('## Post #2 - Bob (@bob)');
		expect(markdown).toContain('[2026-01-01T00:00:00.000Z](https://forum.example/t/topic/123/1)');
		expect(markdown).toContain('---');
		expect(markdown.indexOf('First post')).toBeLessThan(markdown.indexOf('Second post'));
	});

	test('preserves Discourse video oneboxes and ordinary links in Markdown', async () => {
		document.head.innerHTML = '<meta name="generator" content="Discourse 2026.6.0">';
		document.body.innerHTML = '<main><article data-post-id="101">Current DOM only has one post</article></main>';

		const videoUrl = 'https://cdn.example.com/videos/demo.mp4';
		const figmaUrl = 'https://www.figma.com/design/nkukrRZ3NCm3JJm3oYa8yz/';
		const fetchJson = async () => ({
			id: 123,
			title: 'Media topic',
			post_stream: {
				stream: [101, 102],
				posts: [
					{
						id: 101,
						username: 'alice',
						name: 'Alice',
						created_at: '2026-01-01T00:00:00.000Z',
						cooked: `<p>鸭老师我又重新做了一版，您看看</p><div class="onebox video-onebox"><video controls><source src="${videoUrl}"><a href="${videoUrl}">${videoUrl}</a></video></div>`,
						post_number: 1,
						post_url: '/t/topic/123/1',
					},
					{
						id: 102,
						username: 'bob',
						name: 'Bob',
						created_at: '2026-01-02T00:00:00.000Z',
						cooked: `<p>分享一个：<a href="${figmaUrl}" rel="noopener nofollow ugc">一个博主AI短剧拆解的内容库吧【只读】</a></p>`,
						post_number: 2,
						post_url: '/t/topic/123/2',
					},
				],
			},
		});

		const captured = await captureContentSystemDocument(document, {
			url: 'https://forum.example/t/topic/123',
			fetchJson,
		});
		const defuddled = new Defuddle(captured!, { url: 'https://forum.example/t/topic/123' }).parse();
		const markdown = createMarkdownContent(defuddled.content, 'https://forum.example/t/topic/123');

		expect(markdown).toContain('鸭老师我又重新做了一版，您看看');
		expect(markdown).toContain(`[Video: demo.mp4](${videoUrl})`);
		expect(markdown).not.toContain('<video');
		expect(markdown).toContain(`[一个博主AI短剧拆解的内容库吧【只读】](${figmaUrl})`);
	});

	test('returns null when the page is not a known content system', async () => {
		document.head.innerHTML = '<title>Plain page</title>';
		document.body.innerHTML = '<main><p>Plain content</p></main>';

		const captured = await captureContentSystemDocument(document, {
			url: 'https://example.com/article',
			fetchJson: async () => {
				throw new Error('Should not fetch');
			},
		});

		expect(captured).toBeNull();
	});
});
