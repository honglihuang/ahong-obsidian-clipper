import { createMarkdownContent } from 'defuddle/full';

const MARKDOWN_TITLE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))`;
const MARKDOWN_DESTINATION = String.raw`(?:<[^>\n]+>|[^\s)\n]+)`;
const REDUNDANT_IMAGE_LINK_RE = new RegExp(
	String.raw`\[!\[([^\]\n]*)\]\((${MARKDOWN_DESTINATION})(\s+${MARKDOWN_TITLE})?\)\]\((${MARKDOWN_DESTINATION})(?:\s+${MARKDOWN_TITLE})?\)`,
	'g'
);
const IMAGE_RE = new RegExp(
	String.raw`!\[([^\]\n]*)\]\((${MARKDOWN_DESTINATION})(\s+${MARKDOWN_TITLE})?\)`,
	'g'
);

function unwrapDestination(destination: string): string {
	return destination.startsWith('<') && destination.endsWith('>')
		? destination.slice(1, -1)
		: destination;
}

function destinationsMatch(left: string, right: string): boolean {
	const normalizedLeft = unwrapDestination(left);
	const normalizedRight = unwrapDestination(right);
	try {
		return new URL(normalizedLeft).href === new URL(normalizedRight).href;
	} catch {
		return normalizedLeft === normalizedRight;
	}
}

export function normalizeMarkdownImageLinks(markdown: string): string {
	const unwrapped = markdown.replace(REDUNDANT_IMAGE_LINK_RE, (match, alt, imageDestination, imageTitle = '', linkDestination) => {
		if (!destinationsMatch(imageDestination, linkDestination)) return match;
		return `![${alt}](${imageDestination}${imageTitle})`;
	});

	return unwrapped.replace(IMAGE_RE, (match, alt, destination, title = '') => {
		if (!/^\d+$/.test(alt.trim())) return match;
		return `![image](${destination}${title})`;
	});
}

export function createClipMarkdownContent(content: string, url: string): string {
	return normalizeMarkdownImageLinks(createMarkdownContent(content, url));
}
