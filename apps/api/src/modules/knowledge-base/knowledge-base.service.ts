import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  and,
  asc,
  db,
  eq,
  knowledgeChunks,
  knowledgeItems,
} from '@repo/db';

export interface CreateKnowledgeItemDto {
  title: string;
  sourceType: 'faq' | 'manual' | 'txt' | 'url' | 'pdf' | 'docx' | 'csv';
  text: string;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly config: ConfigService) {}

  async findAll(orgId: string) {
    const rows = await db
      .select({
        id: knowledgeItems.id,
        orgId: knowledgeItems.orgId,
        sourceType: knowledgeItems.sourceType,
        title: knowledgeItems.title,
        storageRef: knowledgeItems.storageRef,
        status: knowledgeItems.status,
        createdAt: knowledgeItems.createdAt,
        updatedAt: knowledgeItems.updatedAt,
        chunkId: knowledgeChunks.id,
        text: knowledgeChunks.text,
      })
      .from(knowledgeItems)
      .leftJoin(
        knowledgeChunks,
        eq(knowledgeChunks.knowledgeItemId, knowledgeItems.id),
      )
      .where(eq(knowledgeItems.orgId, orgId))
      .orderBy(asc(knowledgeItems.createdAt));

    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      sourceType: row.sourceType,
      title: row.title,
      storageRef: row.storageRef,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      text: row.text ?? null,
      chunkId: row.chunkId,
    }));
  }

  async create(orgId: string, dto: CreateKnowledgeItemDto) {
    const now = new Date();
    const [item] = await db
      .insert(knowledgeItems)
      .values({
        orgId,
        sourceType: dto.sourceType,
        title: dto.title.trim(),
        status: 'ready',
        updatedAt: now,
      })
      .returning();

    if (!item) throw new Error('Failed to create knowledge item');

    const [chunk] = await db
      .insert(knowledgeChunks)
      .values({
        orgId,
        knowledgeItemId: item.id,
        text: dto.text.trim(),
      })
      .returning();

    return {
      ...item,
      text: chunk?.text ?? dto.text.trim(),
      chunkId: chunk?.id ?? null,
    };
  }

  async importFile(
    orgId: string,
    file: { originalname: string; buffer: Buffer; mimetype?: string },
  ) {
    const sourceType = sourceTypeFromFile(file.originalname, file.mimetype);
    const text = await extractTextFromFile(file, sourceType, this.config);

    if (!text.trim()) {
      throw new Error(
        `${file.originalname} did not contain readable text. If this is a scanned/image PDF, run OCR first or paste the OCR text manually.`,
      );
    }

    return this.create(orgId, {
      title: file.originalname,
      sourceType,
      text,
    });
  }

  async remove(orgId: string, id: string) {
    const [item] = await db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.orgId, orgId)))
      .limit(1);

    if (!item) throw new NotFoundException('Knowledge item not found');

    await db
      .delete(knowledgeItems)
      .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.orgId, orgId)));
  }
}

async function extractTextFromFile(
  file: { originalname: string; buffer: Buffer },
  sourceType: CreateKnowledgeItemDto['sourceType'],
  config: ConfigService,
) {
  if (sourceType === 'pdf') {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      const embeddedText = normalizeText(result.text);
      if (embeddedText.length >= 40) return embeddedText;

      const ocrText = await extractScannedPdfText(parser, config);
      return normalizeText(ocrText || embeddedText);
    } finally {
      await parser.destroy();
    }
  }

  if (['txt', 'csv', 'manual'].includes(sourceType)) {
    return normalizeText(file.buffer.toString('utf8'));
  }

  return normalizeText(file.buffer.toString('utf8'));
}

async function extractScannedPdfText(parser: PDFParse, config: ConfigService) {
  const apiKey = getEnvValue(config, 'OPENAI_API_KEY');
  if (!apiKey) return '';

  const model = getEnvValue(config, 'OPENAI_VISION_MODEL') || 'gpt-4o-mini';
  const screenshotResult = await parser.getScreenshot({
    first: 5,
    desiredWidth: 1400,
    imageDataUrl: true,
    imageBuffer: false,
  });

  const pageTexts: string[] = [];
  for (const page of screenshotResult.pages) {
    const response = await fetch(`${getEnvValue(config, 'OPENAI_BASE_URL') || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Extract all readable text from this scanned PDF page. Return only the text, preserving headings, prices, timings, phone numbers, and bullet points. Do not summarize.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: page.dataUrl },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) continue;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) pageTexts.push(text);
  }

  return pageTexts.join('\n\n');
}

function sourceTypeFromFile(
  name: string,
  mimetype?: string,
): CreateKnowledgeItemDto['sourceType'] {
  const lower = name.toLowerCase();
  if (mimetype === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return 'txt';
  }
  return 'manual';
}

function normalizeText(text: string) {
  return text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getEnvValue(config: ConfigService, key: string) {
  return readDotEnvValue(key) || config.get<string>(key)?.trim() || '';
}

function readDotEnvValue(key: string) {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return '';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = readFileSync(envPath, 'utf8').match(
    new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)\\s*$`, 'm'),
  );
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
}
