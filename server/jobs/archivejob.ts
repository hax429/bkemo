import { ARCHIVE_BLINKO_TASK_NAME } from "@shared/lib/sharedConstant";
import { prisma } from "../prisma";
import { NoteType } from "../../shared/lib/types";
import { BaseScheduleJob } from "./baseScheduleJob";
import { getGlobalConfig } from "../routerTrpc/config";

export class ArchiveJob extends BaseScheduleJob {
  protected static taskName = ARCHIVE_BLINKO_TASK_NAME;
  protected static cronSchedule = '0 0 * * *';

  protected static async RunTask() {
    try {
      const config = await getGlobalConfig({ useAdmin: true });
      const autoArchivedDays = config.autoArchivedDays ?? 30;
      const notes = await prisma.notes.findMany({
        where: {
          type: NoteType.BLINKO,
          createdAt: {
            lt: new Date(new Date().getTime() - autoArchivedDays * 24 * 60 * 60 * 1000),
          },
        },
        select: { id: true },
      });
      return await prisma.notes.updateMany({
        where: { id: { in: notes.map((note) => note.id) } },
        data: { isArchived: true },
      });
    } catch (error: any) {
      throw new Error(error);
    }
  }
}
