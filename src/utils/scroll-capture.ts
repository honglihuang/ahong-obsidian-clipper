import { captureContentSystemDocument } from './content-system-capture';

interface ScrollState {
	scrollY: number;
	scrollHeight: number;
	viewportHeight: number;
}

export interface ScrollCaptureOptions {
	maxSteps?: number;
	maxTimeMs?: number;
	settleMs?: number;
	stepRatio?: number;
	minTextLength?: number;
	getScrollState?: () => ScrollState;
	scrollTo?: (x: number, y: number) => void | Promise<void>;
	now?: () => number;
}

interface CapturedBlock {
	key: string;
	element: Element;
	score: number;
}

const DEFAULT_MAX_STEPS = 80;
const DEFAULT_MAX_TIME_MS = 8000;
const DEFAULT_SETTLE_MS = 120;
const DEFAULT_STEP_RATIO = 0.8;
const DEFAULT_MIN_TEXT_LENGTH = 8;

const CAPTURE_SELECTOR = [
	'article',
	'[role="article"]',
	'[data-post-id]',
	'[data-comment-id]',
	'[data-item-id]',
	'.topic-post',
	'.post',
	'.comment',
	'.entry',
	'.cooked',
	'main > article',
	'main > section',
	'[role="main"] > article',
	'[role="main"] > section',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'figure',
	'pre',
	'blockquote',
	'table',
	'ul',
	'ol',
	'li',
].join(',');

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getDefaultScrollState(doc: Document): ScrollState {
	const win = doc.defaultView;
	const docEl = doc.documentElement;
	const body = doc.body;

	return {
		scrollY: win?.scrollY ?? docEl.scrollTop ?? body?.scrollTop ?? 0,
		scrollHeight: Math.max(
			docEl.scrollHeight || 0,
			body?.scrollHeight || 0,
			docEl.clientHeight || 0,
			body?.clientHeight || 0
		),
		viewportHeight: win?.innerHeight || docEl.clientHeight || body?.clientHeight || 800,
	};
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function mediaCount(element: Element): number {
	return element.querySelectorAll('img, video, audio, iframe, picture, source, canvas, svg').length;
}

function hasVisibleBox(element: Element, viewportHeight: number): boolean {
	const win = element.ownerDocument.defaultView;
	const style = win?.getComputedStyle(element);
	if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;

	const buffer = Math.max(100, viewportHeight * 0.25);
	return rect.bottom >= -buffer && rect.top <= viewportHeight + buffer;
}

function isMeaningfulBlock(element: Element, minTextLength: number): boolean {
	const text = normalizeText(element.textContent || '');
	if (/^H[1-6]$/.test(element.tagName)) return text.length > 0;
	return text.length >= minTextLength || mediaCount(element) > 0;
}

function removeNestedBlocks(elements: Element[]): Element[] {
	return elements.filter(element => {
		return !elements.some(other => other !== element && other.contains(element));
	});
}

function collectVisibleBlocks(doc: Document, minTextLength: number, viewportHeight: number): Element[] {
	const seen = new Set<Element>();
	const candidates = Array.from(doc.querySelectorAll(CAPTURE_SELECTOR))
		.filter(element => {
			if (seen.has(element)) return false;
			seen.add(element);
			return hasVisibleBox(element, viewportHeight)
				&& isMeaningfulBlock(element, minTextLength);
		});

	return removeNestedBlocks(candidates);
}

function stableKey(element: Element): string | null {
	const tag = element.tagName.toLowerCase();
	const stableAttributes = ['data-post-id', 'data-comment-id', 'data-item-id', 'id'];
	for (const attr of stableAttributes) {
		const value = element.getAttribute(attr);
		if (value) return `${tag}:${attr}:${value}`;
	}
	return null;
}

function fingerprintElement(element: Element): string {
	const stable = stableKey(element);
	if (stable) return stable;

	const text = normalizeText(element.textContent || '').slice(0, 500);
	const media = Array.from(element.querySelectorAll('img, video, audio, iframe, source'))
		.map(el => el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('href') || '')
		.filter(Boolean)
		.slice(0, 8)
		.join('|');

	return `${element.tagName.toLowerCase()}:${text}:${media}`;
}

function contentScore(element: Element): number {
	const textLength = normalizeText(element.textContent || '').length;
	const links = element.querySelectorAll('a[href]').length;
	return textLength + mediaCount(element) * 200 + links * 20 + element.outerHTML.length / 100;
}

function copyLazyAttribute(element: Element, target: string, sources: string[]) {
	if (element.getAttribute(target)) return;
	for (const source of sources) {
		const value = element.getAttribute(source);
		if (value) {
			element.setAttribute(target, value);
			return;
		}
	}
}

function materializeLazyMedia(root: Element) {
	const media = [root, ...Array.from(root.querySelectorAll('img, source, video, audio, iframe'))];
	for (const element of media) {
		copyLazyAttribute(element, 'src', ['data-src', 'data-original', 'data-lazy-src', 'data-url']);
		copyLazyAttribute(element, 'srcset', ['data-srcset', 'data-lazy-srcset']);
		if (element.tagName.toLowerCase() === 'img') {
			element.setAttribute('loading', 'eager');
		}
	}
}

function cloneBlock(element: Element): Element {
	const clone = element.cloneNode(true) as Element;
	materializeLazyMedia(clone);
	return clone;
}

function addCapturedBlocks(blocks: Map<string, CapturedBlock>, elements: Element[]) {
	for (const element of elements) {
		const key = fingerprintElement(element);
		const clone = cloneBlock(element);
		const score = contentScore(clone);
		const existing = blocks.get(key);
		if (!existing || score > existing.score) {
			blocks.set(key, { key, element: clone, score });
		}
	}
}

function copyHead(original: Document, captured: Document) {
	captured.head.textContent = '';

	const title = captured.createElement('title');
	title.textContent = original.title || '';
	captured.head.appendChild(title);

	const baseHref = original.baseURI || original.URL;
	if (baseHref) {
		const base = captured.createElement('base');
		base.href = baseHref;
		captured.head.appendChild(base);
	}

	original.head?.querySelectorAll('meta, link[rel="canonical"], link[rel~="icon"]').forEach(node => {
		captured.head.appendChild(captured.importNode(node, true));
	});
}

function buildCapturedDocument(original: Document, blocks: Map<string, CapturedBlock>): Document {
	const captured = original.implementation.createHTMLDocument(original.title || '');
	copyHead(original, captured);
	captured.body.setAttribute('data-obsidian-scroll-capture', 'true');

	const main = captured.createElement('main');
	main.setAttribute('data-obsidian-scroll-capture-content', 'true');

	for (const block of blocks.values()) {
		main.appendChild(captured.importNode(block.element, true));
	}

	captured.body.appendChild(main);
	return captured;
}

export async function captureScrollableDocument(
	doc: Document,
	options: ScrollCaptureOptions = {}
): Promise<Document> {
	const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
	const maxTimeMs = options.maxTimeMs ?? DEFAULT_MAX_TIME_MS;
	const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
	const stepRatio = options.stepRatio ?? DEFAULT_STEP_RATIO;
	const minTextLength = options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
	const now = options.now ?? Date.now;
	const getScrollState = options.getScrollState ?? (() => getDefaultScrollState(doc));
	const win = doc.defaultView;
	const scrollTo = options.scrollTo ?? ((x: number, y: number) => win?.scrollTo(x, y));
	const originalX = win?.scrollX ?? 0;
	const originalY = getScrollState().scrollY;
	const startedAt = now();
	const blocks = new Map<string, CapturedBlock>();

	try {
		await scrollTo(0, 0);
		if (settleMs > 0) await wait(settleMs);

		for (let step = 0; step < maxSteps; step++) {
			const state = getScrollState();
			addCapturedBlocks(blocks, collectVisibleBlocks(doc, minTextLength, state.viewportHeight));

			if (now() - startedAt >= maxTimeMs) break;

			const maxScrollY = Math.max(0, state.scrollHeight - state.viewportHeight);
			if (state.scrollY >= maxScrollY - 2) break;

			const scrollStep = Math.max(1, Math.floor(state.viewportHeight * stepRatio));
			const nextY = Math.min(maxScrollY, state.scrollY + scrollStep);
			if (nextY <= state.scrollY) break;

			await scrollTo(0, nextY);
			if (settleMs > 0) await wait(settleMs);
		}

		return buildCapturedDocument(doc, blocks);
	} finally {
		try {
			await scrollTo(originalX, originalY);
		} catch {
			// Restoring scroll is best-effort; clipping should still continue.
		}
	}
}

export async function prepareDocumentForClip(
	doc: Document,
	options: ScrollCaptureOptions = {}
): Promise<Document> {
	if (doc.querySelector('.obsidian-reader-active .obsidian-reader-content article')) {
		return doc;
	}

	try {
		const contentSystemDocument = await Promise.race([
			captureContentSystemDocument(doc, {
				url: doc.URL || doc.baseURI,
			}),
			wait(options.maxTimeMs ?? DEFAULT_MAX_TIME_MS).then(() => null),
		]);
		if (contentSystemDocument) return contentSystemDocument;

		const captured = await captureScrollableDocument(doc, options);
		return captured.querySelector('[data-obsidian-scroll-capture-content]')?.childElementCount
			? captured
			: doc;
	} catch (error) {
		console.warn('[Obsidian Clipper] Scroll capture failed, falling back to live document:', error);
		return doc;
	}
}
