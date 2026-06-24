import { setElementHTML } from './dom-utils';

type FetchJson = (url: string) => Promise<any>;

export interface ContentSystemCaptureOptions {
	url: string;
	fetchJson?: FetchJson;
	maxPosts?: number;
}

interface DiscoursePost {
	id: number;
	username?: string;
	name?: string;
	created_at?: string;
	cooked?: string;
	post_number?: number;
	post_url?: string;
}

const DISCOURSE_CHUNK_SIZE = 50;
const DEFAULT_MAX_POSTS = 500;

function isDiscourseDocument(doc: Document): boolean {
	const generator = doc.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
	if (/discourse/i.test(generator)) return true;

	return doc.body?.classList.contains('archetype-regular')
		&& !!doc.querySelector('[data-post-id], .topic-post, .cooked');
}

function getDiscourseTopicId(doc: Document, url: string): string | null {
	const candidates = [
		url,
		doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
		doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || '',
	];

	for (const candidate of candidates) {
		const match = candidate.match(/\/t\/(?:[^/?#]+\/)?(\d+)(?:\/\d+)?(?:[?#].*)?$/);
		if (match) return match[1];
	}

	return null;
}

async function defaultFetchJson(doc: Document, url: string): Promise<any> {
	const fetchFn = doc.defaultView?.fetch ?? fetch;
	const response = await fetchFn(url, { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status}`);
	}
	return response.json();
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

function copyHead(original: Document, captured: Document, title: string) {
	captured.head.textContent = '';

	const titleElement = captured.createElement('title');
	titleElement.textContent = title || original.title || '';
	captured.head.appendChild(titleElement);

	const base = captured.createElement('base');
	base.href = original.baseURI || original.URL;
	captured.head.appendChild(base);

	original.head?.querySelectorAll('meta, link[rel="canonical"], link[rel~="icon"]').forEach(node => {
		captured.head.appendChild(captured.importNode(node, true));
	});
}

function formatDiscourseAuthor(post: DiscoursePost): string {
	if (post.name && post.username) return `${post.name} (@${post.username})`;
	return post.name || (post.username ? `@${post.username}` : 'Unknown author');
}

function mediaLabel(element: Element): string {
	const tag = element.tagName.toLowerCase();
	if (tag === 'audio') return 'Audio';
	if (tag === 'iframe') return 'Embedded media';
	return 'Video';
}

function fileNameFromUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		const name = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
		return name || url;
	} catch {
		return url;
	}
}

function mediaUrl(element: Element): string | null {
	return element.getAttribute('src')
		|| element.querySelector('source[src]')?.getAttribute('src')
		|| element.querySelector('a[href]')?.getAttribute('href')
		|| null;
}

function isImageUrl(url: string): boolean {
	try {
		const pathname = new URL(url).pathname.toLowerCase();
		return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(pathname);
	} catch {
		return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(url);
	}
}

function preferOriginalLinkedImages(root: HTMLElement) {
	const images = Array.from(root.querySelectorAll('a[href] > img[src]')) as HTMLImageElement[];
	for (const image of images) {
		const link = image.parentElement as HTMLAnchorElement | null;
		const href = link?.getAttribute('href');
		if (!href) continue;

		const src = image.getAttribute('src') || '';
		const pointsToOriginal = href.includes('/original/') || isImageUrl(href);
		const sourceIsOptimized = src.includes('/optimized/') || src.includes('_2_');
		if (!pointsToOriginal || !sourceIsOptimized) continue;

		image.setAttribute('src', href);
		image.removeAttribute('srcset');
	}
}

function removeEmptyOnebox(element: Element) {
	const parent = element.parentElement;
	if (!parent?.classList.contains('onebox')) return;
	if ((parent.textContent || '').trim()) return;
	if (parent.querySelector('img, a[href], video, audio, iframe')) return;
	parent.remove();
}

function materializeMediaLinks(root: HTMLElement) {
	const mediaElements = Array.from(root.querySelectorAll('video, audio, iframe'));
	for (const element of mediaElements) {
		const url = mediaUrl(element);
		if (!url) continue;

		const paragraph = root.ownerDocument.createElement('p');
		const link = root.ownerDocument.createElement('a');
		link.href = url;
		link.textContent = `${mediaLabel(element)}: ${fileNameFromUrl(url)}`;
		paragraph.appendChild(link);

		element.parentNode?.insertBefore(paragraph, element);
		const parent = element.parentElement;
		element.remove();
		if (parent) removeEmptyOnebox(parent);
	}
}

function appendDiscoursePost(doc: Document, article: HTMLElement, post: DiscoursePost, baseUrl: string, appendDivider: boolean) {
	const section = doc.createElement('section');
	section.setAttribute('data-post-id', String(post.id));
	if (post.post_number) section.setAttribute('data-post-number', String(post.post_number));

	const heading = doc.createElement('h2');
	heading.textContent = `Post #${post.post_number || post.id} - ${formatDiscourseAuthor(post)}`;
	section.appendChild(heading);

	if (post.created_at) {
		const meta = doc.createElement('p');
		const link = doc.createElement('a');
		link.href = new URL(post.post_url || `#post-${post.post_number || post.id}`, baseUrl).href;
		link.textContent = post.created_at;
		meta.appendChild(link);
		section.appendChild(meta);
	}

	const content = doc.createElement('div');
	content.className = 'cooked';
	setElementHTML(content, post.cooked || '');
	preferOriginalLinkedImages(content);
	materializeMediaLinks(content);
	section.appendChild(content);

	article.appendChild(section);
	if (appendDivider) {
		article.appendChild(doc.createElement('hr'));
	}
}

async function captureDiscourseDocument(
	doc: Document,
	options: Required<ContentSystemCaptureOptions>
): Promise<Document | null> {
	const topicId = getDiscourseTopicId(doc, options.url);
	if (!topicId) return null;

	const topicUrl = new URL(`/t/${topicId}.json`, options.url).href;
	const topic = await options.fetchJson(topicUrl);
	const stream: number[] = (topic.post_stream?.stream || []).slice(0, options.maxPosts);
	const postsById = new Map<number, DiscoursePost>();

	for (const post of topic.post_stream?.posts || []) {
		postsById.set(post.id, post);
	}

	const missingIds = stream.filter(id => !postsById.has(id));
	for (const ids of chunk(missingIds, DISCOURSE_CHUNK_SIZE)) {
		const postsUrl = new URL(`/t/${topicId}/posts.json`, options.url);
		for (const id of ids) {
			postsUrl.searchParams.append('post_ids[]', String(id));
		}

		const postsResponse = await options.fetchJson(postsUrl.href);
		for (const post of postsResponse.post_stream?.posts || postsResponse.posts || []) {
			postsById.set(post.id, post);
		}
	}

	const orderedPosts = stream.length
		? stream.map(id => postsById.get(id)).filter((post): post is DiscoursePost => !!post)
		: Array.from(postsById.values());

	if (orderedPosts.length === 0) return null;

	const captured = doc.implementation.createHTMLDocument(topic.title || doc.title || '');
	copyHead(doc, captured, topic.title || doc.title || '');
	captured.body.setAttribute('data-obsidian-content-system-capture', 'discourse');

	const main = captured.createElement('main');
	main.setAttribute('data-obsidian-content-system-capture-content', 'true');
	const article = captured.createElement('article');
	article.setAttribute('data-content-system', 'discourse-topic');

	if (topic.title) {
		const h1 = captured.createElement('h1');
		h1.textContent = topic.title;
		article.appendChild(h1);
	}

	for (let i = 0; i < orderedPosts.length; i++) {
		appendDiscoursePost(captured, article, orderedPosts[i], options.url, i < orderedPosts.length - 1);
	}

	main.appendChild(article);
	captured.body.appendChild(main);
	return captured;
}

export async function captureContentSystemDocument(
	doc: Document,
	options: ContentSystemCaptureOptions
): Promise<Document | null> {
	if (!isDiscourseDocument(doc)) return null;

	const resolvedOptions: Required<ContentSystemCaptureOptions> = {
		url: options.url,
		fetchJson: options.fetchJson ?? ((url: string) => defaultFetchJson(doc, url)),
		maxPosts: options.maxPosts ?? DEFAULT_MAX_POSTS,
	};

	try {
		return await captureDiscourseDocument(doc, resolvedOptions);
	} catch (error) {
		console.warn('[Obsidian Clipper] Content system capture failed:', error);
		return null;
	}
}
