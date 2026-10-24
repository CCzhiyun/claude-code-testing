export async function buildMagicDocsUpdatePrompt(currentDoc: string, filePath: string, title: string, instructions?: string): Promise<string> {
  return [
    `Maintain the Magic Doc titled "${title}" at ${filePath}.`,
    instructions ? `Author instructions: ${instructions}` : '',
    'Use only information supported by the current conversation. Preserve the MAGIC DOC header and any author instructions.',
    'Make the smallest useful edit; remove stale claims and do not invent details.',
    '<current_document>', currentDoc, '</current_document>',
  ].filter(Boolean).join('\n\n');
}
