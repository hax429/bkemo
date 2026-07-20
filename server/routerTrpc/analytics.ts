import { z } from "zod"
import dayjs from "@shared/lib/dayjs"

import { router, authProcedure } from "../middleware"
import { prisma } from "../prisma"

export const analyticsRouter = router({
  dailyNoteCount: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/daily-note-count', summary: 'Query daily note count', protect: true, tags: ['Analytics'] } })
    .input(z.object({
      utcOffsetMinutes: z.number().min(-840).max(840).default(0),
      mode: z.enum(['rolling', 'year']).default('rolling'),
      year: z.number().int().min(1970).max(9999).optional()
    }).optional())
    .output(z.array(z.object({
      date: z.string(),
      count: z.number()
    })))
    .mutation(async function ({ ctx, input }) {
      const offset = input?.utcOffsetMinutes ?? 0
      const mode = input?.mode ?? 'rolling'
      const selectedYear = input?.year ?? dayjs().year()
      const offsetMs = offset * 60 * 1000
      const createdAt = mode === 'year'
        ? {
            gte: new Date(Date.UTC(selectedYear, 0, 1) - offsetMs),
            lt: new Date(Date.UTC(selectedYear + 1, 0, 1) - offsetMs)
          }
        : { gte: dayjs().subtract(1, 'year').startOf('day').toDate() }
      const notes = await prisma.notes.findMany({
        where: {
          accountId: parseInt(ctx.id),
          isRecycle: false,
          isArchived: false,
          parentNoteId: null,
          createdAt
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      })
      const dailyStats = new Map<string, number>()
      notes.forEach(note => {
        const date = dayjs(note.createdAt).utcOffset(offset).format('YYYY-MM-DD')
        dailyStats.set(date, (dailyStats.get(date) ?? 0) + 1)
      })

      return [...dailyStats.entries()].map(([date, count]) => ({ date, count }))
    }),

  monthlyStats: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/monthly-stats', summary: 'Query monthly statistics', protect: true, tags: ['Analytics'] } })
    .input(z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      utcOffsetMinutes: z.number().min(-840).max(840).default(0),
      period: z.enum(['month', 'year', 'all']).default('month')
    }))
    .output(z.object({
      noteCount: z.number(),
      totalWords: z.number(),
      maxDailyWords: z.number(),
      activeDays: z.number(),
      tagStats: z.array(z.object({
        tagName: z.string(),
        count: z.number()
      })).optional(),
      characterStats: z.array(z.object({
        bucket: z.enum(['under-100', '100-299', '300-499', '500-999', '1000-plus']),
        label: z.string(),
        count: z.number()
      })),
      averageCharacters: z.number(),
      maxDailyDate: z.string().nullable()
    }))
    .mutation(async function ({ ctx, input }) {
      const [year, month] = input.month.split('-').map(Number)
      const offsetMs = input.utcOffsetMinutes * 60 * 1000
      const createdAt = input.period === 'month'
        ? {
            gte: new Date(Date.UTC(year!, month! - 1, 1) - offsetMs),
            lt: new Date(Date.UTC(year!, month!, 1) - offsetMs)
          }
        : input.period === 'year'
          ? {
              gte: new Date(Date.UTC(year!, 0, 1) - offsetMs),
              lt: new Date(Date.UTC(year! + 1, 0, 1) - offsetMs)
            }
          : undefined

      const notes = await prisma.notes.findMany({
        where: {
          accountId: parseInt(ctx.id),
          isRecycle: false,
          isArchived: false,
          parentNoteId: null,
          createdAt
        },
        select: {
          content: true,
          createdAt: true,
          tags: {
            select: {
              tag: { select: { name: true } }
            }
          }
        }
      })

      const dailyCharacters = new Map<string, number>()
      const tagCounts = new Map<string, number>()
      const characterBuckets = {
        'under-100': 0,
        '100-299': 0,
        '300-499': 0,
        '500-999': 0,
        '1000-plus': 0
      }
      let totalWords = 0

      notes.forEach(note => {
        // Count Unicode code points rather than UTF-16 code units so emoji and
        // non-Latin content are represented more naturally.
        const characterCount = Array.from(note.content ?? '').length
        totalWords += characterCount
        const day = dayjs(note.createdAt).utcOffset(input.utcOffsetMinutes).format('YYYY-MM-DD')
        dailyCharacters.set(day, (dailyCharacters.get(day) ?? 0) + characterCount)

        if (characterCount < 100) characterBuckets['under-100']++
        else if (characterCount < 300) characterBuckets['100-299']++
        else if (characterCount < 500) characterBuckets['300-499']++
        else if (characterCount < 1000) characterBuckets['500-999']++
        else characterBuckets['1000-plus']++

        note.tags.forEach(({ tag }) => {
          if (tag.name) tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1)
        })
      })

      const busiestDay = [...dailyCharacters.entries()].reduce<[string | null, number]>(
        (best, current) => current[1] > best[1] ? current : best,
        [null, 0]
      )
      const noteCount = notes.length
      const maxDailyWords = busiestDay[1]
      const activeDays = dailyCharacters.size

      const validTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
      const TOP_TAG_COUNT = 10
      const topTags = validTags.slice(0, TOP_TAG_COUNT)
      
      const otherTagsCount = validTags.slice(TOP_TAG_COUNT).reduce((sum, [, count]) => sum + count, 0)

      const finalTagStats = [
        ...topTags.map(([tagName, count]) => ({
          tagName,
          count
        }))
      ]

      if (otherTagsCount > 0) {
        finalTagStats.push({
          tagName: 'Others',
          count: otherTagsCount
        })
      }

      return {
        noteCount,
        totalWords,
        maxDailyWords,
        activeDays,
        tagStats: finalTagStats,
        characterStats: [
          { bucket: 'under-100' as const, label: '< 100', count: characterBuckets['under-100'] },
          { bucket: '100-299' as const, label: '100–299', count: characterBuckets['100-299'] },
          { bucket: '300-499' as const, label: '300–499', count: characterBuckets['300-499'] },
          { bucket: '500-999' as const, label: '500–999', count: characterBuckets['500-999'] },
          { bucket: '1000-plus' as const, label: '1,000+', count: characterBuckets['1000-plus'] }
        ],
        averageCharacters: noteCount > 0 ? Math.round(totalWords / noteCount) : 0,
        maxDailyDate: busiestDay[0]
      }
    })
})
