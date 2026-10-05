

export type BlockType = 'paragraph' | 'heading' | 'bulleted_list' | 'numbered_list' | 'quote' | 'callout' | 'image' | 'cta_group';

export type ContentFontFamilyToken = 'sans' | 'serif' | 'display' | 'mono' | 'inter' | 'source-serif' | 'ibm-plex-sans' | 'ibm-plex-mono' | 'merriweather' | 'lora';

export type ContentFontSizeToken = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '12' | '14' | '16' | '18' | '24' | '32';

export type ContentFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export type ContentTextAlign = 'left' | 'center' | 'right';

export type ContentSpacingToken = 'compact' | 'normal' | 'relaxed';

export type LegacyRichTextNode = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
};

export type RichTextLeaf = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  color?: string;
  font_family_token?: ContentFontFamilyToken;
  font_size_token?: ContentFontSizeToken;
  href?: string;
};

export type RichTextElement = {
  type: 'paragraph';
  children: RichTextLeaf[];
};

export type RichTextDocument = RichTextElement[];

export type RichTextValue = RichTextDocument | LegacyRichTextNode[] | string;

export type ContentStyle = {
  font_family_token?: ContentFontFamilyToken;
  font_size_token?: ContentFontSizeToken;
  font_weight?: ContentFontWeight;
  italic?: boolean;
  text_align?: ContentTextAlign;
  text_color_token?: string;
  spacing_token?: ContentSpacingToken;
};

export type SectionPresentation = {
  section_label?: string;
  eyebrow?: string;
  subheading?: string;
  container_width_token?: 'narrow' | 'default' | 'wide';
  background_variant_token?: 'default' | 'hero' | 'subtle' | 'accent';
  padding_token?: 'compact' | 'normal' | 'spacious';
};

export type BlockNode = {
  type: BlockType;
  text?: string;
  content?: RichTextValue;
  level?: number;
  items?: RichTextValue[];
  tone?: 'info' | 'warning' | 'success';
  url?: string;
  alt?: string;
  caption?: string;
  ctas?: Array<{ id?: string; label: string; href: string; variant?: string }>;
  style?: ContentStyle;
};

export const FONT_FAMILY_TOKENS = new Set<ContentFontFamilyToken>(['sans', 'serif', 'display', 'mono', 'inter', 'source-serif', 'ibm-plex-sans', 'ibm-plex-mono', 'merriweather', 'lora']);

export const FONT_SIZE_TOKENS = new Set<ContentFontSizeToken>(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '12', '14', '16', '18', '24', '32']);

export const FONT_WEIGHT_TOKENS = new Set<ContentFontWeight>(['regular', 'medium', 'semibold', 'bold']);

export const TEXT_ALIGN_TOKENS = new Set<ContentTextAlign>(['left', 'center', 'right']);

export const SPACING_TOKENS = new Set<ContentSpacingToken>(['compact', 'normal', 'relaxed']);

export const CONTAINER_WIDTH_TOKENS = new Set(['narrow', 'default', 'wide']);

export const BACKGROUND_VARIANT_TOKENS = new Set(['default', 'hero', 'subtle', 'accent']);

export const PADDING_TOKENS = new Set(['compact', 'normal', 'spacious']);

export function normalizeHexColor(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/;
  const longHex = /^#([0-9a-fA-F]{6})$/;
  if (shortHex.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  if (longHex.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

export function isSlateDocument(input: unknown): input is RichTextDocument {
  return Array.isArray(input) && input.every((item) => item && typeof item === 'object' && 'type' in item && 'children' in item);
}

export function normalizeRichTextLeaf(input?: Partial<RichTextLeaf> | LegacyRichTextNode | null): RichTextLeaf {
  return {
    text: String(input?.text || ''),
    bold: Boolean(input?.bold),
    italic: Boolean(input?.italic),
    strike: Boolean((input as RichTextLeaf | undefined)?.strike),
    color: normalizeHexColor((input as RichTextLeaf | undefined)?.color),
    font_family_token: FONT_FAMILY_TOKENS.has((input as RichTextLeaf | undefined)?.font_family_token as ContentFontFamilyToken)
      ? (input as RichTextLeaf).font_family_token
      : undefined,
    font_size_token: FONT_SIZE_TOKENS.has((input as RichTextLeaf | undefined)?.font_size_token as ContentFontSizeToken)
      ? (input as RichTextLeaf).font_size_token
      : undefined,
    href: input?.href ? String(input.href) : undefined,
  };
}

export function normalizeRichText(input?: RichTextValue | null): RichTextDocument {
  if (isSlateDocument(input)) {
    return input.map((node) => ({
      type: 'paragraph',
      children: Array.isArray(node.children) && node.children.length
        ? node.children.map((child) => normalizeRichTextLeaf(child))
        : [{ text: '' }],
    }));
  }
  if (Array.isArray(input)) {
    const children = (input as LegacyRichTextNode[]).map((item) => normalizeRichTextLeaf(item));
    return [{ type: 'paragraph', children: children.length ? children : [{ text: '' }] }];
  }
  return [{ type: 'paragraph', children: [{ text: String(input || '') }] }];
}

export function richTextToPlainText(input?: RichTextValue | null): string {
  return normalizeRichText(input)
    .map((node) => node.children.map((item) => item.text).join(''))
    .join('\n');
}

export function normalizeContentStyle(style?: ContentStyle | null): ContentStyle {
  return {
    font_family_token: FONT_FAMILY_TOKENS.has(style?.font_family_token as ContentFontFamilyToken) ? style?.font_family_token : 'inter',
    font_size_token: FONT_SIZE_TOKENS.has(style?.font_size_token as ContentFontSizeToken) ? style?.font_size_token : '16',
    font_weight: FONT_WEIGHT_TOKENS.has(style?.font_weight as ContentFontWeight) ? style?.font_weight : 'regular',
    italic: Boolean(style?.italic),
    text_align: TEXT_ALIGN_TOKENS.has(style?.text_align as ContentTextAlign) ? style?.text_align : 'left',
    text_color_token: normalizeHexColor(style?.text_color_token),
    spacing_token: SPACING_TOKENS.has(style?.spacing_token as ContentSpacingToken) ? style?.spacing_token : 'normal',
  };
}

export function normalizeSectionPresentation(raw: Record<string, unknown>): SectionPresentation {
  const presentation = (raw.presentation as SectionPresentation | undefined) || {};
  return {
    section_label: presentation.section_label || undefined,
    eyebrow: presentation.eyebrow || undefined,
    subheading: presentation.subheading || undefined,
    container_width_token: CONTAINER_WIDTH_TOKENS.has(String(presentation.container_width_token || 'default')) ? presentation.container_width_token : 'default',
    background_variant_token: BACKGROUND_VARIANT_TOKENS.has(String(presentation.background_variant_token || 'default')) ? presentation.background_variant_token : 'default',
    padding_token: PADDING_TOKENS.has(String(presentation.padding_token || 'normal')) ? presentation.padding_token : 'normal',
  };
}

export function normalizeBlock(block: BlockNode): BlockNode {
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'callout') {
    return {
      ...block,
      content: normalizeRichText(block.content || block.text || ''),
      style: normalizeContentStyle(block.style),
    };
  }
  if (block.type === 'bulleted_list' || block.type === 'numbered_list') {
    return {
      ...block,
      items: Array.isArray(block.items) ? block.items.map((item) => normalizeRichText(item)) : [],
      style: normalizeContentStyle(block.style),
    };
  }
  return {
    ...block,
    style: normalizeContentStyle(block.style),
  };
}

export function normalizeBlocks(blocks: BlockNode[]): BlockNode[] {
  return Array.isArray(blocks) ? blocks.map(normalizeBlock) : [];
}

export function textToDocument(text?: string | null): BlockNode[] {
  const trimmed = String(text || '').trim();
  return trimmed ? [{ type: 'paragraph', content: [{ type: 'paragraph', children: [{ text: trimmed }] }], style: normalizeContentStyle({}) }] : [];
}

export function documentToLegacyText(doc: BlockNode[]): string {
  return normalizeBlocks(doc)
    .map((block) => {
      if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'callout') return richTextToPlainText(block.content || block.text || '');
      if (block.type === 'bulleted_list' || block.type === 'numbered_list') return (block.items || []).map((item) => richTextToPlainText(item)).join('\n');
      if (block.type === 'image') return [block.alt || '', block.caption || ''].filter(Boolean).join(' ');
      if (block.type === 'cta_group') return (block.ctas || []).map((cta) => `${cta.label} ${cta.href}`).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function validateBodyDocument(value: unknown): { valid: boolean; error?: string; blocks?: BlockNode[] } {
  const doc = Array.isArray(value) ? value : [];
  for (const [index, raw] of doc.entries()) {
    const block = normalizeBlock(raw as BlockNode);
    if (!block || typeof block !== 'object') return { valid: false, error: `Invalid block at position ${index + 1}` };
    if (!['paragraph', 'heading', 'bulleted_list', 'numbered_list', 'quote', 'callout', 'image', 'cta_group'].includes(String(block.type || ''))) {
      return { valid: false, error: `Unsupported block type at position ${index + 1}` };
    }
    if (!FONT_FAMILY_TOKENS.has((block.style?.font_family_token || 'inter') as ContentFontFamilyToken)
      || !FONT_SIZE_TOKENS.has((block.style?.font_size_token || '16') as ContentFontSizeToken)
      || !FONT_WEIGHT_TOKENS.has((block.style?.font_weight || 'regular') as ContentFontWeight)
      || !TEXT_ALIGN_TOKENS.has((block.style?.text_align || 'left') as ContentTextAlign)
      || !SPACING_TOKENS.has((block.style?.spacing_token || 'normal') as ContentSpacingToken)) {
      return { valid: false, error: `Unsupported style token at block ${index + 1}` };
    }
    if (block.style?.text_color_token && !normalizeHexColor(block.style.text_color_token)) {
      return { valid: false, error: `Unsupported color value at block ${index + 1}` };
    }
    const textRuns = block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'callout'
      ? normalizeRichText(block.content || block.text || '')
      : block.type === 'bulleted_list' || block.type === 'numbered_list'
        ? (block.items || []).map((item) => normalizeRichText(item)).flat()
        : [];
    for (const node of textRuns) {
      for (const child of node.children) {
        if (child.color && !normalizeHexColor(child.color)) return { valid: false, error: `Unsupported text color at block ${index + 1}` };
        if (child.font_family_token && !FONT_FAMILY_TOKENS.has(child.font_family_token)) return { valid: false, error: `Unsupported text font at block ${index + 1}` };
        if (child.font_size_token && !FONT_SIZE_TOKENS.has(child.font_size_token)) return { valid: false, error: `Unsupported text size at block ${index + 1}` };
      }
    }
    if (['paragraph', 'heading', 'quote', 'callout'].includes(block.type) && !richTextToPlainText(block.content || block.text || '').trim()) {
      return { valid: false, error: `Block ${index + 1} requires text` };
    }
    if ((block.type === 'bulleted_list' || block.type === 'numbered_list') && (!Array.isArray(block.items) || !block.items.length || block.items.some((item) => !richTextToPlainText(item).trim()))) {
      return { valid: false, error: `List block ${index + 1} requires items` };
    }
    if (block.type === 'image' && !String(block.url || '').trim()) {
      return { valid: false, error: `Image block ${index + 1} requires a URL` };
    }
    if (block.type === 'cta_group') {
      const ctas = Array.isArray(block.ctas) ? block.ctas : [];
      if (!ctas.length || ctas.some((cta) => !String(cta.label || '').trim() || !String(cta.href || '').trim())) {
        return { valid: false, error: `CTA group block ${index + 1} requires valid CTA items` };
      }
    }
  }
  return { valid: true, blocks: normalizeBlocks(doc as BlockNode[]) };
}
