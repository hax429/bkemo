import { makeAutoObservable } from "mobx"
import { Store } from './standard/base';
import { api } from "@/lib/trpc";
import { PromiseState } from "./standard/PromiseState";
import { useEffect } from "react";
import dayjs from "dayjs";

interface MonthlyStats {
  noteCount: number;
  totalWords: number;
  maxDailyWords: number;
  activeDays: number;
  averageCharacters: number;
  maxDailyDate: string | null;
  tagStats?: {
    tagName: string;
    count: number;
  }[];
  characterStats: {
    bucket: 'under-100' | '100-299' | '300-499' | '500-999' | '1000-plus';
    label: string;
    count: number;
  }[];
}

export class AnalyticsStore implements Store {
  sid = 'AnalyticsStore';
  selectedMonth: string = dayjs().format("YYYY-MM");
  selectedYear: number = dayjs().year();
  period: 'month' | 'year' | 'all' = 'month';

  constructor() {
    makeAutoObservable(this)
  }

  setSelectedMonth(month: string) {
    this.selectedMonth = month;
    this.dailyNoteCount.call();
    this.monthlyStats.call();
  }

  setPeriod(period: 'month' | 'year' | 'all') {
    this.period = period;
    this.dailyNoteCount.call();
    this.monthlyStats.call();
  }

  setSelectedYear(year: number) {
    this.selectedYear = year;
    this.dailyNoteCount.call();
    this.monthlyStats.call();
  }

  dailyNoteCount = new PromiseState({
    function: async () => {
      const data = await api.analytics.dailyNoteCount.mutate({
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        mode: this.period === 'all' ? 'rolling' : 'year',
        year: this.period === 'month' ? dayjs(this.selectedMonth).year() : this.selectedYear
      })
      return data
    }
  })

  monthlyStats = new PromiseState({
    function: async () => {
      const data = await api.analytics.monthlyStats.mutate({
        month: this.period === 'month' ? this.selectedMonth : `${this.selectedYear}-01`,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        period: this.period
      }) as MonthlyStats
      return data
    }
  })

  use() {
    useEffect(() => {
      this.dailyNoteCount.call()
      this.monthlyStats.call()
    }, [])
  }
}
