/** What the dashboard needs from TickTick and Google. Real clients and fakes implement these. */

export interface Task {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  sortOrder: number;
}

export interface Habit {
  id: string;
  name: string;
}

export interface HabitCheckin {
  habitId: string;
  /** Local date as YYYYMMDD, the format TickTick uses for check-ins. */
  stamp: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
}

/** The read part of TickTick. Nothing here changes the account. */
export interface TaskReader {
  listOpenTasks(projectId: string): Promise<Task[]>;
  /** Stays in the read part until step 7 takes habit names from config. */
  listHabits(habitIds: string[]): Promise<Habit[]>;
  listCheckins(habitIds: string[], fromStamp: string, toStamp: string): Promise<HabitCheckin[]>;
}

/**
 * The write part of TickTick. A source that doesn't have it can't change the account:
 * its write routes answer `not_enabled`.
 */
export interface TaskWriter {
  completeTask(projectId: string, taskId: string): Promise<void>;
  createTask(projectId: string, title: string): Promise<Task>;
  moveTask(taskId: string, fromProjectId: string, toProjectId: string): Promise<void>;
}

/**
 * The write methods that are switched on. Each write route runs only when the methods it
 * needs are here, so one route can be switched on without the others.
 */
export type TaskWrites = Partial<TaskWriter>;

export interface CalendarSource {
  /** Events overlapping the local day [startIso, endIso). */
  listEvents(startIso: string, endIso: string): Promise<CalendarEvent[]>;
}

export class NotConnectedError extends Error {
  constructor(public provider: "ticktick" | "google") {
    super(`${provider}_not_connected`);
  }
}

/** A setting the call needs is missing or badly formed: the page shows "not set up yet". */
export class NotConfiguredError extends Error {
  constructor() {
    super("not_configured");
  }
}
