import { createClipMarkdownContent } from '../markdown-utils';

export const markdown = (str: string, param?: string): string => {
	const baseUrl = param || 'about:blank';
	try {
		return createClipMarkdownContent(str, baseUrl);
	} catch (error) {
		console.error('Error in createClipMarkdownContent:', error);
		return str;
	}
};
