import path from 'path';
import fs from 'fs';
import { writeFile } from 'fs/promises';
import AdmZip from 'adm-zip';
import { TEMP_PATH, UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';
import { prisma } from '../prisma';
import { Context } from '../context';

export async function exportMarkdownFiles(params: {
  baseURL: string;
  startDate?: Date;
  endDate?: Date;
  ctx: Context;
  format: 'markdown' | 'csv' | 'json';
}) {
  const { baseURL, startDate, endDate, ctx, format } = params;
  const notes = await prisma.notes.findMany({
    where: {
      createdAt: {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      },
      accountId: Number(ctx.id),
    },
    select: {
      id: true,
      content: true,
      attachments: true,
      createdAt: true,
    },
  });
  if (notes.length === 0) {
    throw new Error('No notes found');
  }
  const exportDir = path.join(TEMP_PATH, 'exports');
  const attachmentsDir = path.join(exportDir, 'files');
  const zipFilePath = TEMP_PATH + `/notes_export_${Date.now()}.zip`;

  try {
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    if (!fs.existsSync(attachmentsDir)) {
      fs.mkdirSync(attachmentsDir, { recursive: true });
    }

    if (format === 'csv') {
      const csvContent = ['ID,Content,Created At'].concat(
        notes.map((note) => `${note.id},"${note.content.replace(/"/g, '""')}",${note.createdAt.toISOString()}`),
      ).join('\n');
      await writeFile(path.join(exportDir, 'notes.csv'), csvContent);
    } else if (format === 'json') {
      await writeFile(path.join(exportDir, 'notes.json'), JSON.stringify(notes, null, 2));
    } else {
      await Promise.all(notes.map(async (note) => {
        let mdContent = note.content;

        if (note.attachments?.length) {
          await Promise.all(note.attachments.map(async (attachment) => {
            try {
              const tokenParam = ctx.token ? `?token=${ctx.token}` : '';
              const response = await fetch(`${baseURL}${attachment.path}${tokenParam}`);
              const buffer = await response.arrayBuffer();
              const attachmentPath = path.join(attachmentsDir, attachment.name);
              await writeFile(attachmentPath, Buffer.from(buffer));

              const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(attachment.name);
              if (isImage) {
                mdContent += `\n![${attachment.name}](./files/${attachment.name})`;
              } else {
                mdContent += `\n[${attachment.name}](./files/${attachment.name})`;
              }
            } catch (error) {
              console.error(`Failed to download attachment: ${attachment.name}`, error);
            }
          }));
        }

        const fileName = `note-${note.id}-${note.createdAt.getTime()}.md`;
        await writeFile(path.join(exportDir, fileName), mdContent);
      }));
    }

    const zip = new AdmZip();
    zip.addLocalFolder(exportDir);
    zip.writeZip(zipFilePath);

    fs.rmSync(exportDir, { recursive: true, force: true });
    return {
      success: true,
      path: zipFilePath.replace(UPLOAD_FILE_PATH, ''),
      fileCount: notes.length,
    };
  } catch (error) {
    try {
      if (fs.existsSync(exportDir)) {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
      }
    } catch { /* ignore cleanup errors */ }
    throw error;
  }
}
